-- Flusso Sito -> Agenda. Applicare sul DB condiviso dopo gli SQL Agenda
-- booking-history, booking-edit, table-conflicts, after-dinner-bookings,
-- admin-activity-log, admin-notifications e manual-table-assignment.
-- Non aggiorna prenotazioni esistenti e non invia comunicazioni.
begin;
set local lock_timeout = '5s';
alter table public.bookings add column if not exists privacy_accepted_at timestamptz;
alter table public.bookings add column if not exists privacy_version text;
create table if not exists private.online_booking_receipts (
  request_id uuid primary key,
  booking_id bigint not null references public.bookings(id) on delete cascade,
  fingerprint text not null,
  created_at timestamptz not null default now()
);
alter table private.online_booking_receipts enable row level security;
revoke all on private.online_booking_receipts from public, anon, authenticated, service_role;

-- Stessi gruppi di src/config/tableAssignments.js. Test di parità obbligatorio.
create or replace function private.online_table_groups()
returns table(group_id text, capacity integer)
language sql immutable security invoker set search_path = '' as $$
  values ('10+11',3),('12',2),('13+14',2),('15+16+17',6),('15+16',4),('17',2),
         ('18+19',4),('18',2),('19',2),('20+21',4),('22',2),('23',2);
$$;
create or replace function private.online_groups_compatible(groups text[])
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(array_agg(g) filter(where g in ('15+16+17','15+16','17','18+19','18','19')),array[]::text[]) <@ array['15+16+17','18+19']
      or coalesce(array_agg(g) filter(where g in ('15+16+17','15+16','17','18+19','18','19')),array[]::text[]) <@ array['15+16','17','18+19']
      or coalesce(array_agg(g) filter(where g in ('15+16+17','15+16','17','18+19','18','19')),array[]::text[]) <@ array['15+16','17','18','19']
  from unnest(groups) g;
$$;
-- Ricerca in memoria, senza riassegnare o salvare tavoli: tutti i gruppi ancora
-- senza tavolo devono poter entrare, anche se arrivano a orari diversi.
create or replace function private.fit_online_parties(parties integer[], used text[], groups text[], minimum_group text default '')
returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare option record; physical text[];
begin
  if cardinality(parties) = 0 then return true; end if;
  if cardinality(parties) > 10 then return false; end if;
  for option in select * from private.online_table_groups() where capacity >= parties[1] and group_id > minimum_group
      order by capacity, cardinality(string_to_array(group_id,'+')), group_id loop
    physical := string_to_array(option.group_id,'+');
    if not physical && used and private.online_groups_compatible(groups || option.group_id) then
      if private.fit_online_parties(parties[2:cardinality(parties)],used || physical,groups || option.group_id,case when parties[2]=parties[1] then option.group_id else '' end) then return true; end if;
    end if;
  end loop;
  return false;
end;
$$;
create or replace function private.online_day_status(day text, people integer, exclude_id bigint default null)
returns text language plpgsql stable security invoker set search_path = '' as $$
declare row_data record; selected_group text; physical text[];
  used text[] := array[]::text[]; groups text[] := array[]::text[];
  parties integer[] := array[people]; covers integer;
begin
  if people is null or people not between 1 and 6 then return 'unverified'; end if;
  if exists(select 1 from public.online_booking_closures c where c.booking_date = day::date) then return 'closed'; end if;
  select coalesce(sum(b.party_size),0) into covers from public.bookings b
    where b.booking_date=day and b.status='confirmed' and (exclude_id is null or b.id<>exclude_id);
  if covers + people > 25 then return 'full'; end if;
  for row_data in select b.* from public.bookings b where b.booking_date=day
      and b.status not in ('cancelled','no_show') and coalesce(b.booking_type,'normale')='normale'
      and (exclude_id is null or b.id<>exclude_id) order by b.id loop
    if row_data.party_size is null or row_data.party_size < 1 then return 'unverified'; end if;
    if coalesce(btrim(row_data.tables),'') = '' then
      parties := parties || row_data.party_size;
    else
      foreach selected_group in array string_to_array(row_data.tables,',') loop
        selected_group := btrim(selected_group);
        if not exists(select 1 from private.online_table_groups() g where g.group_id=selected_group) then return 'unverified'; end if;
        physical := string_to_array(selected_group,'+');
        if physical && used then return 'unverified'; end if;
        used := used || physical; groups := groups || selected_group;
      end loop;
    end if;
  end loop;
  if not private.online_groups_compatible(groups) then return 'unverified'; end if;
  select array_agg(p order by p desc) into parties from unnest(parties) p;
  return case when private.fit_online_parties(parties,used,groups) then 'available' else 'full' end;
end;
$$;
revoke all on function private.online_table_groups(), private.online_groups_compatible(text[]),
  private.fit_online_parties(integer[],text[],text[],text), private.online_day_status(text,integer,bigint)
  from public, anon, authenticated, service_role;

create or replace function private.prepare_booking() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  administrator boolean := coalesce(auth.jwt()->'app_metadata'->>'role' = 'admin',false);
  customer boolean := current_setting('role',true) = 'authenticated' and not administrator;
  dt timestamptz;

begin
  if new.source='staff' then new.source := 'agenda'; end if;
  if new.source='ai' then new.source := 'booking'; end if;
  if customer then
    if new.source <> 'booking' or new.user_id is distinct from auth.uid() then
      raise exception 'Record non autorizzato' using errcode='42501';
    end if;
    if tg_op='INSERT' then
      new.status := 'confirmed'; new.tables := ''; new.reminder_status := 'skipped';
      new.reminder_attempts := 0; new.created_at := now();
      new.consenso_ricordami := false; new.consenso_data := null;
      new.arrived_at := null; new.marketing_visit_counted_at := null;
    else
      if (to_jsonb(new) - array['name','email','phone','booking_date','booking_time','party_size','notes','status','updated_at'])
         is distinct from (to_jsonb(old) - array['name','email','phone','booking_date','booking_time','party_size','notes','status','updated_at']) then
        raise exception 'Campo riservato all’amministratore' using errcode='42501';
      end if;
      if old.status='cancelled' and new.status <> old.status then raise exception 'Prenotazione annullata'; end if;
    end if;
  end if;
  if tg_op='INSERT' and new.source='booking' then
    if new.privacy_accepted_at is null or new.privacy_version is distinct from '2026-10-04-online-v1' then
      raise exception 'Lettura informativa privacy obbligatoria' using errcode='22023';
    end if;
    new.status := 'confirmed'; new.tables := ''; new.reminder_status := 'skipped';
    new.booking_type := 'normale'; new.consenso_ricordami := false; new.consenso_data := null;
  end if;
  new.updated_at := now();
  if new.status='confirmed' and
    (tg_op='INSERT' or old.status is distinct from new.status or
     new.booking_date is distinct from old.booking_date or new.party_size is distinct from old.party_size) then
    perform pg_advisory_xact_lock(734512);
    if (select coalesce(sum(b.party_size),0) from public.bookings b
        where b.id<>new.id and b.status='confirmed' and b.booking_date=new.booking_date) + new.party_size > 25 then
      raise exception 'Limite giornaliero di 25 coperti raggiunto' using errcode='P0001';
    end if;
  end if;
  if new.source='booking' and new.status='confirmed' and
    (tg_op='INSERT' or new.booking_date is distinct from old.booking_date or
     new.booking_time is distinct from old.booking_time or new.party_size is distinct from old.party_size) then
    perform pg_advisory_xact_lock(734512);
    if new.booking_date !~ '^\d{4}-\d{2}-\d{2}$' or new.booking_time !~ '^(18|19|20|21|22):(00|30)$|^23:00$' then raise exception 'Data o ora non valide'; end if;
    dt := (new.booking_date || ' ' || new.booking_time)::timestamp at time zone 'Europe/Rome';
    if extract(isodow from new.booking_date::date)=1 or dt < now()+interval '30 minutes'
       or new.booking_date::date > (now() at time zone 'Europe/Rome')::date+60
       or new.party_size not between 1 and 6 then raise exception 'Data o coperti non disponibili'; end if;
    if length(btrim(new.name)) not between 2 and 60 or length(new.notes)>300
       or new.phone !~ '^\+[1-9][0-9]{7,14}$' or length(new.email)>120 then raise exception 'Contatti non validi'; end if;
    if (select count(*) from public.bookings b where b.id<>new.id and b.status='confirmed'
         and regexp_replace(b.phone,'[^0-9]','','g')=regexp_replace(new.phone,'[^0-9]','','g')
         and (b.booking_date || ' ' || b.booking_time)::timestamp at time zone 'Europe/Rome' > now()) >= 2 then
      raise exception 'Limite prenotazioni per telefono raggiunto';
    end if;
    if private.online_day_status(new.booking_date,new.party_size,new.id) <> 'available' then
      raise exception 'Disponibilità cambiata: aggiorna il calendario o contatta il locale' using errcode='P0001';
    end if;
    -- Un tavolo viene scelto e salvato soltanto dallo staff nella mappa.
    if tg_op='INSERT' then new.tables := ''; end if;
  end if;
  return new;
end $$;

revoke all on function private.prepare_booking() from public,anon,authenticated;

-- Storico online atomico, solo dati operativi; contatti e consensi esclusi.
create or replace function private.record_online_booking_creation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source='booking' and coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    insert into public.booking_history(booking_id,action,old_data,new_data)
      values(new.id,'booking_created','{}'::jsonb,jsonb_build_object(
        'booking_date',new.booking_date,'booking_time',new.booking_time,
        'party_size',new.party_size,'tables',new.tables,'status',new.status,'booking_type',new.booking_type));
  end if;
  return new;
end;
$$;
revoke all on function private.record_online_booking_creation() from public,anon,authenticated;
drop trigger if exists record_online_booking_creation on public.bookings;
create trigger record_online_booking_creation after insert on public.bookings
  for each row execute function private.record_online_booking_creation();
notify pgrst, 'reload schema';
commit;
