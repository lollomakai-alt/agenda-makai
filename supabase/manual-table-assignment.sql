-- Applicare dopo booking-edit.sql e after-dinner-bookings.sql.
-- RPC manuale ADMIN: accetta soltanto changes.tables. Trigger conflitti e storico invariati.
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
  selected_party_size integer;
  selected_count integer;
  selected_capacity integer;
  availability_change boolean;
  date_value date;
  selected_date date;
  selected_time text;
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
    if changes->key_name = 'null'::jsonb then
      raise exception 'Valore non valido' using errcode = '22023';
    end if;
    if key_name <> 'party_size' and jsonb_typeof(changes->key_name) <> 'string' then
      raise exception 'Tipo di valore non valido' using errcode = '22023';
    end if;
  end loop;

  if changes ? 'booking_date' then
    if changes->>'booking_date' !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Data non valida' using errcode = '22023';
    end if;
    date_value := (changes->>'booking_date')::date;
    if to_char(date_value, 'YYYY-MM-DD') <> changes->>'booking_date' then
      raise exception 'Data non valida' using errcode = '22023';
    end if;
  end if;
  if changes ? 'booking_time' and changes->>'booking_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Orario non valido' using errcode = '22023';
  end if;
  if changes ? 'party_size' then
    if jsonb_typeof(changes->'party_size') <> 'number'
       or changes->>'party_size' !~ '^[1-9][0-9]{0,9}$' then
      raise exception 'Numero persone non valido' using errcode = '22023';
    end if;
    if (changes->>'party_size')::numeric > 6 then
      raise exception 'Numero persone non valido' using errcode = '22023';
    end if;
  end if;
  if changes ? 'tables' and (
    length(changes->>'tables') > 200 or
    (changes->>'tables' <> '' and changes->>'tables' !~ '^[1-9][0-9]*(\+[1-9][0-9]*)*(,[1-9][0-9]*(\+[1-9][0-9]*)*)*$')
  ) then
    raise exception 'Assegnazioni tavoli non valide' using errcode = '22023';
  end if;
  if changes ? 'notes' and length(changes->>'notes') > 300 then
    raise exception 'Note troppo lunghe: massimo 300 caratteri' using errcode = '22023';
  end if;

  availability_change := changes ?| array['booking_date', 'booking_time', 'party_size', 'tables'];
  if availability_change then perform pg_advisory_xact_lock(734512); end if;

  select * into previous_booking from public.bookings b where b.id = booking_id for update;
  if not found then
    raise exception 'Prenotazione non trovata o non accessibile' using errcode = 'P0002';
  end if;
  if coalesce(previous_booking.status,'confirmed') not in ('confirmed','arrived') then
    raise exception 'Prenotazione non assegnabile' using errcode = '22023';
  end if;
  previous_values := jsonb_build_object(
    'booking_date', previous_booking.booking_date, 'booking_time', previous_booking.booking_time,
    'party_size', previous_booking.party_size, 'tables', previous_booking.tables, 'notes', previous_booking.notes
  );
  if previous_values is distinct from expected then
    raise exception 'La prenotazione è cambiata nel frattempo. Aggiorna la pagina e riapri la modifica'
      using errcode = '40001';
  end if;
  if not exists (select 1 from jsonb_each(changes) c where c.value is distinct from previous_values->c.key) then
    raise exception 'Nessuna modifica da salvare' using errcode = '22023';
  end if;

  selected_tables := case when changes ? 'tables' then changes->>'tables' else previous_booking.tables end;
  selected_party_size := case when changes ? 'party_size' then (changes->>'party_size')::integer else previous_booking.party_size end;
  selected_date := case when changes ? 'booking_date' then (changes->>'booking_date')::date else previous_booking.booking_date::date end;
  selected_time := left(case when changes ? 'booking_time' then changes->>'booking_time' else previous_booking.booking_time::text end, 5);
  if availability_change and (
    selected_date < (now() at time zone 'Europe/Rome')::date
    or selected_date > (now() at time zone 'Europe/Rome')::date + 60
    or extract(isodow from selected_date) = 1
  ) then
    raise exception 'Data non disponibile' using errcode = '22023';
  end if;
  if availability_change and (
    (previous_booking.booking_type = 'dopocena' and selected_time !~ '^(22|23):(00|30)$')
    or (coalesce(previous_booking.booking_type, 'normale') <> 'dopocena'
      and selected_time !~ '^(18|19|20|21|22):(00|30)$|^23:00$')
  ) then
    raise exception 'Orario non disponibile' using errcode = '22023';
  end if;
  if availability_change and selected_tables <> '' then
    select count(*), coalesce(sum(configured.capacity), 0)::integer
      into selected_count, selected_capacity
    from unnest(string_to_array(selected_tables, ',')) selected(table_id)
    join (values
      ('10+11', 3), ('12', 2), ('13+14', 2),
      ('15+16+17', 6), ('15+16', 4), ('17', 2),
      ('18+19', 4), ('18', 2), ('19', 2),
      ('20+21', 4), ('22', 2), ('23', 2)
    ) configured(table_id, capacity) on configured.table_id = selected.table_id;
    if selected_count <> cardinality(string_to_array(selected_tables, ',')) then
      raise exception 'Assegnazione tavoli non configurata' using errcode = '22023';
    end if;
    -- Solo assegnazione manuale staff: sovracapienza consentita.
  end if;

  update public.bookings as b set
    booking_date = case when changes ? 'booking_date' then changes->>'booking_date' else b.booking_date end,
    booking_time = case when changes ? 'booking_time' then changes->>'booking_time' else b.booking_time end,
    party_size = case when changes ? 'party_size' then (changes->>'party_size')::integer else b.party_size end,
    tables = selected_tables,
    notes = case when changes ? 'notes' then changes->>'notes' else b.notes end
  where b.id = booking_id returning b.* into saved_booking;

  -- I trigger preesistenti restano attivi. Non accetta una loro riassegnazione
  -- silenziosa: in questo caso l'intera modifica (e il suo evento) è annullata.
  if saved_booking.tables is distinct from selected_tables then
    raise exception 'Il controllo esistente richiede una diversa assegnazione tavoli. Modifica non salvata: la riassegnazione avanzata non è disponibile'
      using errcode = '22023';
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
revoke all on function public.admin_assign_booking_tables(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.admin_assign_booking_tables(bigint, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
