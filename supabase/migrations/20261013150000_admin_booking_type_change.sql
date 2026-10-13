-- Cambio turno ADMIN su una prenotazione esistente. Richiede le funzioni di
-- supabase/complete-booking-system.sql e il catalogo tavoli corrente.
-- Non modifica il percorso di creazione online né riassegna altre prenotazioni.
begin;
set local lock_timeout = '5s';

create or replace function public.admin_change_booking_type(
  booking_id bigint, changes jsonb, expected jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
$$;

revoke all on function public.admin_change_booking_type(bigint,jsonb,jsonb) from public,anon;
grant execute on function public.admin_change_booking_type(bigint,jsonb,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
