-- Tre turni senza sotto orari: cena 19:00 o 21:30, dopocena 23:00.
-- Sostituisce la migrazione 20261030120000_service_shift_times.
-- Nessun backfill: le prenotazioni storiche restano invariate.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

CREATE OR REPLACE FUNCTION private.valid_service_slot(service text, slot text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce((service='normale' and slot ~ '^(19:00|21:30)$')
    or (service='dopocena' and slot ~ '^(23:00)$'),false)
$function$;

CREATE OR REPLACE FUNCTION private.service_capacity(day text, reference_time text, exclude_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.service_capacity_for_type(day,reference_time,
    case when reference_time ~ '^23:00$' then 'dopocena' else 'normale' end,exclude_id)
$function$;

CREATE OR REPLACE FUNCTION private.service_slot_at(day text, slot text, service text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare d date;
begin
  if day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
     not pg_input_is_valid(day,'date') then return null; end if;
  d:=day::date;
  if service='normale' and slot ~ '^(19:00|21:30)$' then
    return (d::text||' '||slot)::timestamp at time zone 'Europe/Rome';
  end if;
  if service='dopocena' and slot ~ '^(23:00)$' then
    return ((d+case when slot='00:00' then 1 else 0 end)::text||' '||slot)::timestamp at time zone 'Europe/Rome';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_create_after_dinner_booking(p_customer_name text, p_customer_phone text, p_customer_email text, p_booking_date text, p_booking_time text, p_party_size integer, p_notes text, p_table_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare saved public.bookings%rowtype;
  selected_capacity integer;
  selected_date date;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode = '42501';
  end if;
  if p_customer_name is null or length(btrim(p_customer_name)) not between 2 and 60 then
    raise exception 'Nome non valido' using errcode = '22023';
  end if;
  if p_customer_phone is null or p_customer_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Telefono non valido' using errcode = '22023';
  end if;
  if coalesce(p_customer_email, '') <> '' and
     (length(p_customer_email) > 120 or p_customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Email non valida' using errcode = '22023';
  end if;
  if p_booking_date is null or p_booking_date !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Data non valida' using errcode = '22023';
  end if;
  begin
    selected_date := p_booking_date::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Data non valida' using errcode = '22023';
  end;
  if to_char(selected_date, 'YYYY-MM-DD') <> p_booking_date
     or selected_date < (now() at time zone 'Europe/Rome')::date
     or selected_date > (now() at time zone 'Europe/Rome')::date + 60
     or extract(isodow from selected_date) = 1 then
    raise exception 'Data non disponibile' using errcode = '22023';
  end if;
  if p_booking_time is null or p_booking_time !~ '^23:00$' then
    raise exception 'Il dopocena è disponibile alle 23:00'
      using errcode = '22023';
  end if;
  if p_party_size is null or p_party_size not between 1 and 6 then
    raise exception 'Numero persone non valido' using errcode = '22023';
  end if;
  -- Configurazioni ammesse e relative capienze.
  select configured.capacity into selected_capacity
  from (values
    ('10+11', 3), ('12', 2), ('13+14', 3),
    ('15+16+17', 6), ('15+16', 4), ('17', 2),
    ('18+19', 4), ('18', 2), ('19', 2),
    ('20+21', 4), ('22', 2), ('23', 2), ('22+23', 4)
  ) as configured(table_id, capacity)
  where configured.table_id = p_table_id;
  if selected_capacity is null or p_party_size > selected_capacity then
    raise exception 'Tavolo non valido o capienza insufficiente' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 300 then
    raise exception 'Note troppo lunghe' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(734512);
  insert into public.bookings (
    name, phone, email, booking_date, booking_time, party_size, notes,
    tables, status, source, reminder_status, booking_type
  ) values (
    btrim(p_customer_name), p_customer_phone, lower(coalesce(p_customer_email, '')),
    p_booking_date, p_booking_time, p_party_size, coalesce(p_notes, ''),
    p_table_id, 'confirmed', 'agenda', 'skipped', 'dopocena'
  ) returning * into saved;

  return jsonb_build_object(
    'id', saved.id, 'booking_date', saved.booking_date,
    'booking_time', saved.booking_time, 'party_size', saved.party_size,
    'tables', saved.tables, 'status', saved.status,
    'source', saved.source, 'booking_type', saved.booking_type
  );
end $function$;

commit;
