-- Rollback migrazione 1B (Opzione C) — DB Agenda.
-- Ripristina le definizioni precedenti e rimuove gli oggetti introdotti.
-- NON applicare senza autorizzazione esplicita.
-- Eseguire in una transazione unica; verificare il risultato prima del COMMIT.

begin;

-- 1. Trigger e funzione di handoff introdotti dalla migrazione
drop trigger if exists zzz_handoff_released_cena_table on public.bookings;
drop function if exists private.handoff_released_cena_table();

-- 2. Funzioni di supporto introdotte dalla migrazione
drop function if exists private.cena_day_mode(text);
drop function if exists private.cena_slot_allowed(text,text);
drop function if exists private.valid_service_slot_for_day(text,text,text);
drop function if exists private.all_table_units();
-- Nuovo overload a 4 argomenti; la versione a 3 argomenti resta intatta.
drop function if exists private.choose_online_dinner_unit(text,integer,bigint,text);

-- 3. Ripristino delle definizioni originali
CREATE OR REPLACE FUNCTION public.admin_assign_booking_tables(booking_id bigint, changes jsonb, expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  previous_booking public.bookings%rowtype;
  saved_booking public.bookings%rowtype;
  previous_values jsonb;
  key_name text;
  selected_tables text;
  selected_groups text[];
  selected_physical_ids text[];
  manual_edit_guard text;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode = '42501';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb then
    raise exception 'Nessuna modifica da salvare' using errcode = '22023';
  end if;
  if expected is null or jsonb_typeof(expected) <> 'object' then
    raise exception 'Dati originali mancanti: aggiorna la pagina' using errcode = '22023';
  end if;
  for key_name in select jsonb_object_keys(changes) loop
    if key_name <> 'tables' then
      raise exception 'Campo non modificabile' using errcode = '22023';
    end if;
    if changes->key_name = 'null'::jsonb or jsonb_typeof(changes->key_name) <> 'string' then
      raise exception 'Valore non valido' using errcode = '22023';
    end if;
  end loop;
  if length(changes->>'tables') > 200 or
     (changes->>'tables' <> '' and changes->>'tables' !~ '^[1-9][0-9]*(\+[1-9][0-9]*)*(,[1-9][0-9]*(\+[1-9][0-9]*)*)*$') then
    raise exception 'Assegnazioni tavoli non valide' using errcode = '22023';
  end if;

  -- Tutti i writer devono rispettare questo lock prima di controllare conflitti.
  perform pg_advisory_xact_lock(734512);
  select * into previous_booking from public.bookings b where b.id = booking_id for update;
  if not found then raise exception 'Prenotazione non trovata o non accessibile' using errcode = 'P0002'; end if;
  if coalesce(previous_booking.status, 'confirmed') not in ('confirmed','arrived') then
    raise exception 'Prenotazione non assegnabile' using errcode = '22023';
  end if;
  previous_values := jsonb_build_object(
    'booking_date', previous_booking.booking_date, 'booking_time', previous_booking.booking_time,
    'party_size', previous_booking.party_size, 'tables', previous_booking.tables, 'notes', previous_booking.notes
  );
  if previous_values is distinct from expected then
    raise exception 'La prenotazione è cambiata nel frattempo. Aggiorna la pagina e riapri la modifica' using errcode = '40001';
  end if;
  if not exists (select 1 from jsonb_each(changes) c where c.value is distinct from previous_values->c.key) then
    raise exception 'Nessuna modifica da salvare' using errcode = '22023';
  end if;

  selected_tables := changes->>'tables';
  if selected_tables <> '' then
    selected_groups := string_to_array(selected_tables, ',');
    if exists (
      select 1 from unnest(selected_groups) selected(group_id)
      left join (values
        ('10+11',3),('12',2),('13+14',3),('15+16+17',6),('15+16',4),('17',2),
        ('18+19',4),('18',2),('19',2),('20+21',4),('22+23',4),('22',2),('23',2)
      ) as unit(group_id, physical_capacity) using (group_id)
      where unit.group_id is null
    ) then raise exception 'Assegnazione tavoli non configurata' using errcode = '22023'; end if;
    if cardinality(selected_groups) <> (select count(distinct g) from unnest(selected_groups) g) then
      raise exception 'Lo stesso gruppo tavoli non può essere indicato due volte' using errcode = '22023';
    end if;
    select array_agg(btrim(physical_id)) into selected_physical_ids
      from unnest(selected_groups) grouped_id
      cross join lateral unnest(string_to_array(grouped_id, '+')) physical_id;
    if cardinality(selected_physical_ids) <> (select count(distinct physical_id) from unnest(selected_physical_ids) physical_id) then
      raise exception 'Lo stesso tavolo fisico non può essere indicato in gruppi diversi' using errcode = '22023';
    end if;
    if not private.online_groups_compatible(selected_groups ||
      array(select btrim(grp) from public.bookings b
        cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) grp
        where b.id<>booking_id and b.booking_date=previous_booking.booking_date
          and b.status not in ('cancelled','no_show'))) then
      raise exception 'Configurazione fisica tavoli non disponibile' using errcode='22023';
    end if;
    -- Difesa nel RPC oltre al trigger: funziona anche con trigger ADMIN che
    -- disattivano l'ottimizzatore. Le prenotazioni completate restano occupanti.
    if exists (
      select 1 from public.bookings b
      cross join lateral unnest(string_to_array(coalesce(b.tables, ''), ',')) assigned_group
      cross join lateral unnest(string_to_array(btrim(assigned_group), '+')) physical_id
      where b.id <> booking_id and b.booking_date = previous_booking.booking_date
        and b.status not in ('cancelled','no_show')
        and btrim(physical_id) = any(selected_physical_ids)
    ) then raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa giornata' using errcode = '23505'; end if;
  end if;

  manual_edit_guard := coalesce(current_setting('makai.manual_admin_edit', true), '');
  perform set_config('makai.manual_admin_edit', 'on', true);
  update public.bookings b set tables = selected_tables
    where b.id = booking_id returning b.* into saved_booking;
  perform set_config('makai.manual_admin_edit', manual_edit_guard, true);
  if saved_booking.tables is distinct from selected_tables then
    raise exception 'Assegnazione manuale non salvata: un controllo ha modificato i tavoli' using errcode = '22023';
  end if;
  if saved_booking.status is distinct from previous_booking.status then
    raise exception 'Modifica non salvata: lo stato deve restare invariato' using errcode = '22023';
  end if;
  return jsonb_build_object('booking', jsonb_build_object(
    'id', saved_booking.id, 'booking_date', saved_booking.booking_date,
    'booking_time', saved_booking.booking_time, 'party_size', saved_booking.party_size,
    'tables', saved_booking.tables, 'notes', saved_booking.notes, 'status', saved_booking.status
  ));
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_change_booking_type(booking_id bigint, changes jsonb, expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  previous_booking public.bookings%rowtype;
  saved_booking public.bookings%rowtype;
  previous_values jsonb;
  key_name text;
  target_type text;
  target_date text;
  target_time text;
  target_party integer;
  target_notes text;
  target_tables text;
  manual_edit_guard text;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode = '42501';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' or coalesce(changes->>'booking_type','') not in ('normale','dopocena') then
    raise exception 'Turno non valido' using errcode = '22023';
  end if;
  if expected is null or jsonb_typeof(expected) <> 'object' then
    raise exception 'Dati originali mancanti: aggiorna la pagina' using errcode = '22023';
  end if;
  for key_name in select jsonb_object_keys(changes) loop
    if key_name not in ('booking_type','booking_date','booking_time','party_size','tables','notes') then
      raise exception 'Campo non modificabile' using errcode = '22023';
    end if;
    if changes->key_name = 'null'::jsonb or
      (key_name = 'party_size' and jsonb_typeof(changes->key_name) <> 'number') or
      (key_name <> 'party_size' and jsonb_typeof(changes->key_name) <> 'string') then
      raise exception 'Valore non valido' using errcode = '22023';
    end if;
  end loop;

  -- Serializza con i writer delle assegnazioni e blocca la riga da modificare.
  perform pg_advisory_xact_lock(734512);
  select * into previous_booking from public.bookings b where b.id = booking_id for update;
  if not found then raise exception 'Prenotazione non trovata o non accessibile' using errcode = 'P0002'; end if;
  if previous_booking.status <> 'confirmed' then
    raise exception 'Il cambio turno è disponibile solo per prenotazioni confermate' using errcode = '22023';
  end if;
  previous_values := jsonb_build_object(
    'booking_type', coalesce(previous_booking.booking_type,'normale'),
    'booking_date', previous_booking.booking_date,
    'booking_time', previous_booking.booking_time,
    'party_size', previous_booking.party_size,
    'tables', previous_booking.tables,
    'notes', previous_booking.notes
  );
  if previous_values is distinct from expected then
    raise exception 'La prenotazione è cambiata nel frattempo. Aggiorna la pagina e riapri la modifica' using errcode = '40001';
  end if;
  target_type := changes->>'booking_type';
  if target_type is not distinct from coalesce(previous_booking.booking_type,'normale') then
    raise exception 'Il turno è già quello selezionato' using errcode = '22023';
  end if;
  target_date := case when changes ? 'booking_date' then changes->>'booking_date' else previous_booking.booking_date end;
  target_time := case when changes ? 'booking_time' then changes->>'booking_time' else previous_booking.booking_time end;
  target_notes := case when changes ? 'notes' then changes->>'notes' else previous_booking.notes end;
  if target_date !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Data non valida' using errcode = '22023';
  end if;
  begin
    if to_char(target_date::date,'YYYY-MM-DD') <> target_date then
      raise exception 'Data non valida' using errcode = '22023';
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Data non valida' using errcode = '22023';
  end;
  if not private.valid_service_slot(target_type,target_time)
     or private.booking_scheduled_at(target_date,target_time) is null then
    raise exception 'Orario non valido per il turno selezionato' using errcode = '22023';
  end if;
  if changes ? 'party_size' and (changes->>'party_size' !~ '^[1-9][0-9]*$'
      or (changes->>'party_size')::numeric > 2147483647) then
    raise exception 'Numero persone non valido' using errcode = '22023';
  end if;
  target_party := case when changes ? 'party_size' then (changes->>'party_size')::integer else previous_booking.party_size end;
  if target_party is null or target_party < 1 then
    raise exception 'Numero persone non compatibile con il turno' using errcode = '22023';
  end if;
  if length(coalesce(target_notes,'')) > 300 then
    raise exception 'Note troppo lunghe: massimo 300 caratteri' using errcode = '22023';
  end if;

  if target_type = 'dopocena' then
    if changes ? 'tables' and changes->>'tables' <> '' then
      raise exception 'Il DOPOCENA inizia senza tavolo' using errcode = '22023';
    end if;
    target_tables := '';
  else
    target_tables := changes->>'tables';
    if target_tables is null or not exists (
      select 1 from private.online_table_groups() g where g.group_id = target_tables
    ) then
      raise exception 'Seleziona un’unità tavolo CENA valida' using errcode = '22023';
    end if;
    -- Nessun riuso implicito per orario o turno: un tavolo assegnato a
    -- un'altra prenotazione resta occupato fino alla liberazione esplicita.
    if exists (
      select 1 from public.bookings b where b.id <> booking_id and b.booking_date = target_date
        and b.status not in ('cancelled','no_show') and coalesce(b.tables,'') <> ''
        and private.physical_ids(b.tables) && private.physical_ids(target_tables)
    ) then
      raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa giornata' using errcode = '23505';
    end if;
    if not private.online_groups_compatible(array_prepend(target_tables,
      array(select group_id from public.bookings b
        cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) group_id
        where b.id <> booking_id and b.booking_date = target_date
          and b.booking_type = 'normale' and b.status not in ('cancelled','no_show'))
    )) then
      raise exception 'Configurazione fisica tavoli non disponibile' using errcode = '22023';
    end if;
  end if;

  manual_edit_guard := coalesce(current_setting('makai.manual_admin_edit',true),'');
  perform set_config('makai.manual_admin_edit','on',true);
  update public.bookings b set
    booking_type = target_type, booking_date = target_date,
    booking_time = target_time, party_size = target_party,
    tables = target_tables, notes = target_notes
  where b.id = booking_id returning b.* into saved_booking;
  if target_type = 'dopocena' and saved_booking.table_released_at is not null then
    -- Il trigger marca il rilascio del vecchio tavolo CENA. La nuova
    -- prenotazione DOPOCENA senza tavolo deve però restare nella quota 25.
    update public.bookings b set table_released_at = null
      where b.id = booking_id returning b.* into saved_booking;
  end if;
  perform set_config('makai.manual_admin_edit',manual_edit_guard,true);
  if saved_booking.booking_type is distinct from target_type or
     saved_booking.booking_date is distinct from target_date or
     saved_booking.booking_time is distinct from target_time or
     saved_booking.party_size is distinct from target_party or
     saved_booking.tables is distinct from target_tables or
     saved_booking.status is distinct from previous_booking.status then
    raise exception 'Cambio turno non salvato: un controllo ha modificato la prenotazione' using errcode = '22023';
  end if;
  return jsonb_build_object('booking',jsonb_build_object(
    'id',saved_booking.id,'booking_type',saved_booking.booking_type,
    'booking_date',saved_booking.booking_date,'booking_time',saved_booking.booking_time,
    'party_size',saved_booking.party_size,'tables',saved_booking.tables,
    'notes',saved_booking.notes,'status',saved_booking.status
  ));
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_release_booking_table(booking_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare previous public.bookings%rowtype; saved public.bookings%rowtype;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(734512);
  select * into previous from public.bookings where id=booking_id for update;
  if not found then raise exception 'Prenotazione non trovata' using errcode='P0002'; end if;
  if previous.booking_type<>'normale' or previous.status not in ('confirmed','arrived','completed')
     or coalesce(previous.tables,'')='' then
    raise exception 'Nessun tavolo CENA da liberare' using errcode='22023';
  end if;
  update public.bookings set status='completed',tables='',table_released_at=now()
    where id=booking_id returning * into saved;
  return jsonb_build_object('booking',to_jsonb(saved));
end $function$;

CREATE OR REPLACE FUNCTION public.admin_update_booking(booking_id bigint, changes jsonb, expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  previous_booking public.bookings%rowtype;
  saved_booking public.bookings%rowtype;
  previous_values jsonb;
  key_name text;
  selected_tables text;
  selected_party_size integer;
  selected_groups text[];
  selected_physical_ids text[];
  selected_date text;
  selected_time text;
  date_value date;
  manual_edit_guard text;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode = '42501';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb then
    raise exception 'Nessuna modifica da salvare' using errcode = '22023';
  end if;
  if expected is null or jsonb_typeof(expected) <> 'object' then
    raise exception 'Dati originali mancanti: aggiorna la pagina' using errcode = '22023';
  end if;
  for key_name in select jsonb_object_keys(changes) loop
    if key_name not in ('booking_date','booking_time','party_size','tables','notes') then
      raise exception 'Campo non modificabile' using errcode = '22023';
    end if;
    if changes->key_name = 'null'::jsonb then raise exception 'Valore non valido' using errcode = '22023'; end if;
    if key_name <> 'party_size' and jsonb_typeof(changes->key_name) <> 'string' then
      raise exception 'Tipo di valore non valido' using errcode = '22023';
    end if;
  end loop;
  if changes ? 'booking_date' then
    if changes->>'booking_date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data non valida' using errcode = '22023'; end if;
    begin date_value := (changes->>'booking_date')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Data non valida' using errcode = '22023';
    end;
    if to_char(date_value, 'YYYY-MM-DD') <> changes->>'booking_date' then raise exception 'Data non valida' using errcode = '22023'; end if;
  end if;
  if changes ? 'booking_time' and changes->>'booking_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Orario non valido' using errcode = '22023';
  end if;
  if changes ? 'party_size' then
    if jsonb_typeof(changes->'party_size') <> 'number'
       or changes->>'party_size' !~ '^[1-9][0-9]*$'
       or (changes->>'party_size')::numeric > 2147483647 then
      raise exception 'Numero persone non valido per il tipo intero della prenotazione' using errcode = '22023';
    end if;
  end if;
  if changes ? 'tables' and (length(changes->>'tables') > 200 or
     (changes->>'tables' <> '' and changes->>'tables' !~ '^[1-9][0-9]*(\+[1-9][0-9]*)*(,[1-9][0-9]*(\+[1-9][0-9]*)*)*$')) then
    raise exception 'Assegnazioni tavoli non valide' using errcode = '22023';
  end if;
  if changes ? 'notes' and length(changes->>'notes') > 300 then
    raise exception 'Note troppo lunghe: massimo 300 caratteri' using errcode = '22023';
  end if;

  if changes ?| array['booking_date','booking_time','party_size','tables'] then perform pg_advisory_xact_lock(734512); end if;
  select * into previous_booking from public.bookings b where b.id = booking_id for update;
  if not found then raise exception 'Prenotazione non trovata o non accessibile' using errcode = 'P0002'; end if;
  previous_values := jsonb_build_object(
    'booking_date', previous_booking.booking_date, 'booking_time', previous_booking.booking_time,
    'party_size', previous_booking.party_size, 'tables', previous_booking.tables, 'notes', previous_booking.notes
  );
  if previous_values is distinct from expected then
    raise exception 'La prenotazione è cambiata nel frattempo. Aggiorna la pagina e riapri la modifica' using errcode = '40001';
  end if;
  if not exists (select 1 from jsonb_each(changes) c where c.value is distinct from previous_values->c.key) then
    raise exception 'Nessuna modifica da salvare' using errcode = '22023';
  end if;

  selected_tables := case when changes ? 'tables' then changes->>'tables' else previous_booking.tables end;
  selected_party_size := case when changes ? 'party_size' then (changes->>'party_size')::integer else previous_booking.party_size end;
  selected_date := case when changes ? 'booking_date' then changes->>'booking_date' else previous_booking.booking_date end;
  selected_time := case when changes ? 'booking_time' then changes->>'booking_time' else previous_booking.booking_time end;
  if changes ?| array['tables','booking_date','booking_time'] and coalesce(selected_tables,'') <> '' then
    selected_groups := string_to_array(selected_tables, ',');
    if exists (
      select 1 from unnest(selected_groups) selected(group_id)
      left join (values
        ('10+11',3),('12',2),('13+14',3),('15+16+17',6),('15+16',4),('17',2),
        ('18+19',4),('18',2),('19',2),('20+21',4),('22+23',4),('22',2),('23',2)
      ) as unit(group_id, physical_capacity) using (group_id)
      where unit.group_id is null
    ) then
      raise exception 'Assegnazione tavoli non configurata' using errcode = '22023';
    end if;
    if cardinality(selected_groups) <> (select count(distinct g) from unnest(selected_groups) g) then
      raise exception 'Lo stesso gruppo tavoli non può essere indicato due volte' using errcode = '22023';
    end if;
    select array_agg(btrim(physical_id)) into selected_physical_ids from unnest(selected_groups) grouped_id
      cross join lateral unnest(string_to_array(grouped_id, '+')) physical_id;
    if cardinality(selected_physical_ids) <> (select count(distinct p) from unnest(selected_physical_ids) p) then
      raise exception 'Lo stesso tavolo fisico non può essere indicato in gruppi diversi' using errcode = '22023';
    end if;
    if not private.online_groups_compatible(selected_groups ||
      array(select btrim(grp) from public.bookings b
        cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) grp
        where b.id<>booking_id and b.booking_date=selected_date
          and b.status not in ('cancelled','no_show'))) then
      raise exception 'Configurazione fisica tavoli non disponibile' using errcode='22023';
    end if;
    if exists (
      select 1 from public.bookings b
      cross join lateral unnest(string_to_array(coalesce(b.tables, ''), ',')) assigned_group
      cross join lateral unnest(string_to_array(btrim(assigned_group), '+')) physical_id
      where b.id <> booking_id and b.booking_date = selected_date
        and b.status not in ('cancelled','no_show')
        and btrim(physical_id) = any(selected_physical_ids)
    ) then raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa giornata' using errcode = '23505'; end if;
  end if;

  manual_edit_guard := coalesce(current_setting('makai.manual_admin_edit', true), '');
  perform set_config('makai.manual_admin_edit', 'on', true);
  update public.bookings b set
    booking_date = case when changes ? 'booking_date' then changes->>'booking_date' else b.booking_date end,
    booking_time = case when changes ? 'booking_time' then changes->>'booking_time' else b.booking_time end,
    party_size = case when changes ? 'party_size' then selected_party_size else b.party_size end,
    tables = selected_tables,
    notes = case when changes ? 'notes' then changes->>'notes' else b.notes end
  where b.id = booking_id returning b.* into saved_booking;
  perform set_config('makai.manual_admin_edit', manual_edit_guard, true);
  if saved_booking.tables is distinct from selected_tables then
    raise exception 'Assegnazione manuale non salvata: un controllo ha modificato i tavoli' using errcode = '22023';
  end if;
  if saved_booking.status is distinct from previous_booking.status then
    raise exception 'Modifica non salvata: lo stato deve restare invariato' using errcode = '22023';
  end if;
  return jsonb_build_object('booking', jsonb_build_object(
    'id', saved_booking.id, 'booking_date', saved_booking.booking_date,
    'booking_time', saved_booking.booking_time, 'party_size', saved_booking.party_size,
    'tables', saved_booking.tables, 'notes', saved_booking.notes, 'status', saved_booking.status
  ));
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_daily_table_conflicts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_ids text[];
  selected_physical_ids text[];
  occupied_groups text[];
  start_at timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.booking_date is not distinct from old.booking_date
       and new.booking_time is not distinct from old.booking_time
       and new.tables is not distinct from old.tables
       and new.booking_type is not distinct from old.booking_type
       and new.status is not distinct from old.status then return new; end if;
  end if;
  if new.status in ('cancelled', 'no_show') then return new; end if;
  if coalesce(btrim(new.tables), '') = '' then return new; end if;
  start_at := private.booking_scheduled_at(new.booking_date, new.booking_time);
  if start_at is null then
    raise exception 'Data e ora valide obbligatorie per assegnare tavoli' using errcode = '22023';
  end if;
  select array_agg(btrim(t)) into selected_ids from unnest(string_to_array(new.tables, ',')) t;
  if exists (select 1 from unnest(selected_ids) t where t not in
    ('10+11','12','13+14','15+16+17','15+16','17','18+19','18','19','20+21','22','23','22+23')) then
    raise exception 'Configurazione tavolo non valida' using errcode = '22023';
  end if;
  if cardinality(selected_ids) <> (select count(distinct t) from unnest(selected_ids) t) then
    raise exception 'Lo stesso tavolo non può essere indicato due volte' using errcode = '22023';
  end if;
  select array_agg(btrim(physical_id)) into selected_physical_ids
    from unnest(selected_ids) grouped_id
    cross join lateral unnest(string_to_array(grouped_id, '+')) physical_id;
  if cardinality(selected_physical_ids) <> (select count(distinct t) from unnest(selected_physical_ids) t) then
    raise exception 'Lo stesso tavolo fisico non può essere indicato in gruppi diversi' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.bookings b
    cross join lateral unnest(string_to_array(coalesce(b.tables, ''), ',')) t
    cross join lateral unnest(string_to_array(btrim(t), '+')) physical_id
    where b.id <> new.id and b.status not in ('cancelled','no_show')
      and private.booking_intervals_overlap(new.booking_date,new.booking_time,b.booking_date,b.booking_time)
      and btrim(physical_id) = any(selected_physical_ids)
  ) then
    raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa giornata' using errcode = '23505';
  end if;
  -- Lo staff può scegliere qualsiasi unità libera: la configurazione è un consiglio.
  if coalesce(auth.jwt()->'app_metadata'->>'role','')='admin' then return new; end if;
  -- Gli assegnati restano in uso per la giornata, senza scadenza temporale.
    select array_agg(distinct grouped_id) into occupied_groups from (
      select btrim(t) as grouped_id from unnest(selected_ids) t
      union all
      select btrim(t) from public.bookings b
      cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) t
      where b.id <> new.id and b.status not in ('cancelled','no_show')
        and private.booking_intervals_overlap(new.booking_date,new.booking_time,b.booking_date,b.booking_time)

    ) occupied where grouped_id in ('15+16+17','15+16','17','18+19','18','19');
    if occupied_groups is not null and not (
      occupied_groups <@ array['15+16+17','18+19']::text[]
      or occupied_groups <@ array['15+16','17','18+19']::text[]
      or occupied_groups <@ array['15+16','17','18','19']::text[]
    ) then
      raise exception 'Configurazione dei tavoli 15-19 non valida' using errcode = '22023';
    end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_daily_booking_capacity_25()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare booked_seats bigint;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','')='admin' then return new; end if;
  if new.source is distinct from 'booking' or new.status is distinct from 'confirmed'
     or new.booking_type='dopocena' then return new; end if;
  perform pg_advisory_xact_lock(734512);
  select coalesce(sum(b.party_size),0) into booked_seats from public.bookings b
    where b.booking_date=new.booking_date and b.booking_type='normale'
      and b.status not in ('cancelled','no_show') and b.id is distinct from new.id;
  if booked_seats+new.party_size>private.dinner_physical_capacity() then
    raise exception 'Capienza fisica CENA esaurita' using errcode='23514';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.online_slot_status(day text, slot text, people integer, service text, exclude_id bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare booked bigint;
begin
  if people not between 1 and 6 or private.service_slot_at(day,slot,service) is null then return 'unverified'; end if;
  if (service='normale' and exists(select 1 from public.online_booking_closures where booking_date=day::date))
     or extract(isodow from day::date)=1 then return 'closed'; end if;
  if day::date>(now() at time zone 'Europe/Rome')::date+60
     or private.service_slot_at(day,slot,service)<now()+interval '30 minutes' then return 'past'; end if;
  if service='dopocena' then return 'manual_review'; end if;
  select coalesce(sum(party_size),0) into booked from public.bookings b
    where b.booking_date=day and coalesce(b.booking_type,'normale')=service
      and b.status not in ('cancelled','no_show') and (exclude_id is null or b.id<>exclude_id);
  if booked+people>private.dinner_physical_capacity() then return 'full'; end if;
  if service='normale' and private.choose_online_dinner_unit(day,people,exclude_id) is null then return 'full'; end if;
  return 'available';
end $function$;

CREATE OR REPLACE FUNCTION private.prepare_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare administrator boolean:=coalesce(auth.jwt()->'app_metadata'->>'role'='admin',false);
  customer boolean:=current_setting('role',true)='authenticated' and not administrator;
  availability_change boolean; assigned text; dt timestamptz;
begin
  perform pg_advisory_xact_lock(734512);
  if new.source='staff' then new.source:='agenda'; end if;
  if new.source='ai' then new.source:='booking'; end if;
  if customer then
    if new.source<>'booking' or new.user_id is distinct from auth.uid() then
      raise exception 'Record non autorizzato' using errcode='42501';
    end if;
    if tg_op='INSERT' then
      new.status:='confirmed';new.tables:='';new.reminder_status:='skipped';
      new.reminder_attempts:=0;new.created_at:=now();new.consenso_ricordami:=false;
      new.consenso_data:=null;new.arrived_at:=null;new.marketing_visit_counted_at:=null;
    else
      if (to_jsonb(new)-array['name','email','phone','booking_date','booking_time','party_size','notes','status','updated_at'])
         is distinct from
         (to_jsonb(old)-array['name','email','phone','booking_date','booking_time','party_size','notes','status','updated_at']) then
        raise exception 'Campo riservato all’amministratore' using errcode='42501';
      end if;
      if old.status='cancelled' and new.status<>old.status then raise exception 'Prenotazione annullata'; end if;
    end if;
  end if;
  if tg_op='UPDATE' and old.status='arrived' and new.status='confirmed' then new.arrived_at:=null; end if;
  if tg_op='UPDATE' and coalesce(old.tables,'')<>'' and coalesce(new.tables,'')=''
     and old.booking_type='normale' and new.status='completed' then
    new.table_released_at:=now();
  end if;
  if coalesce(new.tables,'')<>'' then new.table_released_at:=null; end if;
  new.updated_at:=now();

  availability_change:=new.source='booking' and new.status='confirmed' and not administrator
    and coalesce(current_setting('makai.manual_admin_edit',true),'')<>'on' and
    (tg_op='INSERT' or new.booking_date is distinct from old.booking_date
     or new.booking_time is distinct from old.booking_time
     or new.party_size is distinct from old.party_size
     or new.booking_type is distinct from old.booking_type);
  if not availability_change then return new; end if;
  if tg_op='INSERT' then
    if new.privacy_accepted_at is null or new.privacy_version is distinct from '2026-10-12-online-v2' then
      raise exception 'Lettura informativa privacy obbligatoria' using errcode='22023';
    end if;
    new.status:='confirmed';new.tables:='';new.reminder_status:='skipped';
    new.consenso_ricordami:=false;new.consenso_data:=null;
  end if;
  dt:=private.service_slot_at(new.booking_date,new.booking_time,new.booking_type);
  if new.party_size not between 1 and 6 or dt is null then
    raise exception 'Data, orario o coperti non disponibili' using errcode='22023';
  end if;
  if length(btrim(coalesce(new.name,''))) not between 2 and 60
     or length(coalesce(new.notes,''))>300
     or coalesce(new.phone,'') !~ '^\+[1-9][0-9]{7,14}$'
     or length(coalesce(new.email,''))>120 then
    raise exception 'Contatti non validi' using errcode='22023';
  end if;
  if (select count(*) from public.bookings b where b.id<>new.id
      and b.status in ('confirmed','arrived')
      and regexp_replace(b.phone,'[^0-9]','','g')=regexp_replace(new.phone,'[^0-9]','','g')
      and private.service_slot_at(b.booking_date,b.booking_time,coalesce(b.booking_type,'normale'))>now())>=2 then
    raise exception 'Limite prenotazioni per telefono raggiunto' using errcode='P0001';
  end if;
  if private.online_slot_status(new.booking_date,new.booking_time,new.party_size,new.booking_type,new.id)<>'available' then
    raise exception 'Disponibilità cambiata: aggiorna il calendario o contatta il locale' using errcode='P0001';
  end if;
  if new.booking_type='dopocena' then
    new.tables:='';
  else
    assigned:=private.choose_online_dinner_unit(new.booking_date,new.party_size,new.id);
    if assigned is null then raise exception 'Tavolo non disponibile' using errcode='P0001'; end if;
    new.tables:=assigned;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.queue_booking_lifecycle_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.booking_communications%rowtype; k text;
begin
  if new.booking_type='dopocena' then return new; end if;
  if tg_op='INSERT' then
    if coalesce(new.status,'confirmed')='confirmed' then perform private.queue_booking_email(new,'confirmation','created:'||new.id); end if;
  elsif old.status is distinct from new.status
     or private.booking_email_snapshot(old) is distinct from private.booking_email_snapshot(new)
     or old.email is distinct from new.email then
    for c in update public.booking_communications set status='superseded',error_code='booking_changed'
      where booking_id=new.id and channel='email' and status in ('queued','failed','skipped') returning * loop
      insert into public.booking_communication_logs(communication_id,status,error_code) values(c.id,'superseded','booking_changed');
    end loop;
    if new.status in ('confirmed','cancelled') then
      k:=case when new.status='cancelled' then 'cancelled'
              when old.status is distinct from new.status then 'confirmation' else 'updated' end;
      perform private.queue_booking_email(new,k,'changed:'||new.id||':'||gen_random_uuid());
    end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.service_capacity_for_type(day text, reference_time text, service_type text, exclude_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare people bigint; physical integer; total integer; unused integer;
begin
  total:=case when service_type='normale' then private.dinner_physical_capacity() else null end;
  if private.compatible_service_slot_at(day,reference_time,service_type) is null then
    return jsonb_build_object('total',total,'remaining',0,'verified',false);
  end if;
  select coalesce(sum(party_size),0) into people from public.bookings b
    where b.booking_date=day and coalesce(b.booking_type,'normale')=service_type
      and b.status not in ('cancelled','no_show') and (exclude_id is null or b.id<>exclude_id);
  select coalesce(sum(g.capacity),0)::integer into physical
    from public.bookings b cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) grp
    join private.online_table_groups() g on g.group_id=grp
    where b.booking_date=day and b.status not in ('cancelled','no_show')
      and (exclude_id is null or b.id<>exclude_id) and b.booking_type='normale';
  select coalesce(sum(greatest(0,unit.capacity-b.party_size)),0)::integer into unused
    from public.bookings b cross join lateral (
      select sum(g.capacity)::integer capacity
      from unnest(string_to_array(coalesce(b.tables,''),',')) grp
      join private.online_table_groups() g on g.group_id=grp
    ) unit
    where b.booking_date=day and b.status not in ('cancelled','no_show')
      and (exclude_id is null or b.id<>exclude_id) and b.booking_type='normale'
      and coalesce(b.tables,'')<>'';
  return jsonb_build_object('total',total,'occupied',case when service_type='normale' then physical else people end,
    'unused',case when service_type='normale' then unused else 0 end,
    'people_reserved',people,'people_remaining',case when service_type='normale' then greatest(0,private.dinner_physical_capacity()-people) else null end,
    'physical_occupied_units',physical,'physical_remaining',case when service_type='normale' then greatest(0,total-physical) else null end,
    'remaining',case when service_type='normale' then least(greatest(0,private.dinner_physical_capacity()-people),greatest(0,total-physical)) else null end,
    'verified',true);
end $function$;

commit;
