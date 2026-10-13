-- Assegnazione e modifiche manuali ADMIN senza vincoli automatici di capienza.
-- Da applicare dopo le RPC admin_update_booking/admin_assign_booking_tables e
-- dopo i trigger di conflitto fisico. Non cambia trigger o motore online.
-- 13+14 = 3 coperti; 22+23 = 4 coperti, anche per assegnazione automatica compatibile.
-- Nessuna scrittura ai dati avviene durante l'installazione.
begin;
set local lock_timeout = '5s';

create or replace function public.admin_assign_booking_tables(
  booking_id bigint, changes jsonb, expected jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
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
$$;

create or replace function public.admin_update_booking(
  booking_id bigint, changes jsonb, expected jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
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
$$;

-- Il guard sulle prenotazioni online pendenti resta attivo per i normali
-- inserimenti e aggiornamenti. Si salta soltanto durante i due RPC ADMIN
-- sopra, dopo il controllo fisico esplicito e sotto advisory lock 734512.
create or replace function private.protect_pending_online_bookings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('cancelled','no_show') then return new; end if;
  -- DOPOCENA has a separate 25-person quota in prepare_booking; the CENA
  -- pending-table planner must never veto an online DOPOCENA reservation.
  if new.booking_type = 'dopocena' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.booking_date is not distinct from old.booking_date
       and new.booking_time is not distinct from old.booking_time
       and new.party_size is not distinct from old.party_size
       and new.tables is not distinct from old.tables
       and new.booking_type is not distinct from old.booking_type
       and (new.status is not distinct from old.status or old.status not in ('cancelled','no_show')) then return new; end if;
  end if;
  if current_setting('makai.manual_admin_edit', true) = 'on'
     and coalesce(auth.jwt()->'app_metadata'->>'role','') = 'admin' then return new; end if;
  if coalesce(auth.jwt()->'app_metadata'->>'role','') = 'admin' then
    if tg_op = 'INSERT' and coalesce(btrim(new.tables),'') <> '' then return new; end if;
    if tg_op = 'UPDATE' and new.tables is distinct from old.tables then return new; end if;
  end if;
  if exists (
    select 1 from public.bookings b where b.source='booking'
      and b.status not in ('cancelled','no_show') and coalesce(btrim(b.tables),'')=''
      and private.booking_intervals_overlap(new.booking_date,new.booking_time,b.booking_date,b.booking_time)
  ) and not private.pending_online_windows_fit(new.booking_date) then
    raise exception 'Assegnazione non salvata: non resterebbe posto per le prenotazioni online già confermate senza tavolo'
      using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_pending_online_bookings() from public, anon, authenticated;

revoke all on function public.admin_assign_booking_tables(bigint,jsonb,jsonb) from public, anon;
revoke all on function public.admin_update_booking(bigint,jsonb,jsonb) from public, anon;
grant execute on function public.admin_assign_booking_tables(bigint,jsonb,jsonb) to authenticated;
grant execute on function public.admin_update_booking(bigint,jsonb,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
