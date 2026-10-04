-- Prenotazioni manuali ADMIN dopocena. Da applicare manualmente.
-- Non modifica la logica di creazione delle prenotazioni normali.
begin;
set local lock_timeout = '5s';

alter table public.bookings
  add column if not exists booking_type text not null default 'normale';
alter table public.bookings
  alter column booking_type set default 'normale';
alter table public.bookings
  drop constraint if exists bookings_booking_type_check;
alter table public.bookings
  add constraint bookings_booking_type_check
  check (booking_type in ('normale', 'dopocena'));

-- Adegua il controllo già esistente: normale e dopocena hanno occupazioni
-- separate. Un dopocena può quindi riutilizzare un tavolo normale della data,
-- ma non sovrapporsi a un altro dopocena sullo stesso tavolo e data.
create or replace function private.check_daily_table_conflicts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare selected_ids text[];
  selected_physical_ids text[];
  occupied_groups text[];
begin
  if tg_op = 'UPDATE' then
    if new.booking_date is not distinct from old.booking_date
       and new.tables is not distinct from old.tables
       and new.booking_type is not distinct from old.booking_type
       and new.status is not distinct from old.status then return new; end if;
  end if;
  if new.status in ('cancelled', 'no_show') then return new; end if;
  if coalesce(btrim(new.tables), '') = '' then return new; end if;
  if new.booking_date is null or new.booking_date = '' then
    raise exception 'Data obbligatoria per assegnare tavoli' using errcode = '22023';
  end if;
  select array_agg(btrim(t)) into selected_ids
    from unnest(string_to_array(new.tables, ',')) t;
  if exists (select 1 from unnest(selected_ids) t where t not in
    ('10+11','12','13+14','15+16+17','15+16','17','18+19','18','19','20+21','22','23')) then
    raise exception 'Configurazione tavolo non valida' using errcode = '22023';
  end if;
  if cardinality(selected_ids) <> (select count(distinct t) from unnest(selected_ids) t) then
    raise exception 'Lo stesso tavolo non può essere indicato due volte' using errcode = '22023';
  end if;
  select array_agg(btrim(physical_id)) into selected_physical_ids
    from unnest(selected_ids) grouped_id
    cross join lateral unnest(string_to_array(grouped_id, '+')) physical_id;
  if cardinality(selected_physical_ids) <>
     (select count(distinct t) from unnest(selected_physical_ids) t) then
    raise exception 'Lo stesso tavolo fisico non può essere indicato in gruppi diversi'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.bookings b
    cross join lateral unnest(string_to_array(coalesce(b.tables, ''), ',')) t
    cross join lateral unnest(string_to_array(btrim(t), '+')) physical_id
    where b.id <> new.id and b.booking_date = new.booking_date
      and b.booking_type = new.booking_type
      and b.status not in ('cancelled', 'no_show')
      and btrim(physical_id) = any(selected_physical_ids)
  ) then
    raise exception 'Tavolo già assegnato a un’altra prenotazione dello stesso tipo nella stessa data'
      using errcode = '23505';
  end if;
  -- I gruppi occupati devono appartenere a una delle tre configurazioni 15-19.
  select array_agg(distinct grouped_id) into occupied_groups
  from (
    select btrim(t) as grouped_id from unnest(selected_ids) t
    union all
    select btrim(t) from public.bookings b
    cross join lateral unnest(string_to_array(coalesce(b.tables, ''), ',')) t
    where b.id <> new.id and b.booking_date = new.booking_date
      and b.booking_type = new.booking_type
      and b.status not in ('cancelled', 'no_show')
  ) occupied
  where grouped_id in ('15+16+17', '15+16', '17', '18+19', '18', '19');
  if occupied_groups is not null and not (
    occupied_groups <@ array['15+16+17', '18+19']::text[]
    or occupied_groups <@ array['15+16', '17', '18+19']::text[]
    or occupied_groups <@ array['15+16', '17', '18', '19']::text[]
  ) then
    raise exception 'Configurazione dei tavoli 15-19 non valida' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.check_daily_table_conflicts() from public, anon, authenticated;

create or replace function public.admin_create_after_dinner_booking(
  p_customer_name text, p_customer_phone text, p_customer_email text,
  p_booking_date text, p_booking_time text, p_party_size integer,
  p_notes text, p_table_id text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
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
  if p_booking_time is null or p_booking_time !~ '^(22|23):(00|30)$' then
    raise exception 'Il dopocena è disponibile dalle 22:00 alle 23:30, ogni 30 minuti'
      using errcode = '22023';
  end if;
  if p_party_size is null or p_party_size not between 1 and 6 then
    raise exception 'Numero persone non valido' using errcode = '22023';
  end if;
  -- Configurazioni ammesse e relative capienze.
  select configured.capacity into selected_capacity
  from (values
    ('10+11', 3), ('12', 2), ('13+14', 2),
    ('15+16+17', 6), ('15+16', 4), ('17', 2),
    ('18+19', 4), ('18', 2), ('19', 2),
    ('20+21', 4), ('22', 2), ('23', 2)
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
end;
$$;
revoke all on function public.admin_create_after_dinner_booking(
  text, text, text, text, text, integer, text, text
) from public, anon;
grant execute on function public.admin_create_after_dinner_booking(
  text, text, text, text, text, integer, text, text
) to authenticated;
notify pgrst, 'reload schema';
commit;
