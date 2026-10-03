begin;
alter table public.bookings add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.bookings drop constraint bookings_source_check;
update public.bookings set source = case source when 'staff' then 'agenda' when 'ai' then 'booking' else source end;
alter table public.bookings alter column source set default 'booking';
alter table public.bookings add constraint bookings_source_check check (source in ('agenda','booking'));
create index if not exists bookings_owner_source_idx on public.bookings(user_id, source);
alter table public.bookings enable row level security;
revoke all on public.bookings from anon;
grant select, insert, update, delete on public.bookings to authenticated;
create policy staff_all on public.bookings for all to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') in ('staff','admin'))
with check ((select auth.jwt()->'app_metadata'->>'role') in ('staff','admin'));
create policy booking_owner_select on public.bookings for select to authenticated
using (source='booking' and user_id=(select auth.uid()));
create policy booking_owner_insert on public.bookings for insert to authenticated
with check (source='booking' and user_id=(select auth.uid()));
create policy booking_owner_update on public.bookings for update to authenticated
using (source='booking' and user_id=(select auth.uid()))
with check (source='booking' and user_id=(select auth.uid()));
create policy booking_owner_delete on public.bookings for delete to authenticated
using (source='booking' and user_id=(select auth.uid()));
-- Internal SECURITY DEFINER trigger: explicitly validates owner/protected fields
-- and checks occupied tables across owners without disclosing their records.
create schema if not exists private;
revoke all on schema private from public;
create function private.prepare_booking() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  staff boolean := coalesce(auth.jwt()->'app_metadata'->>'role' in ('staff','admin'),false);
  customer boolean := current_setting('role',true) = 'authenticated' and not staff;
  dt timestamptz;
  assigned text;
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
        raise exception 'Campo riservato allo staff' using errcode='42501';
      end if;
      if old.status='cancelled' and new.status <> old.status then raise exception 'Prenotazione annullata'; end if;
    end if;
  end if;
  new.updated_at := now();
  if new.source='booking' and new.status='confirmed' and
    (tg_op='INSERT' or new.booking_date is distinct from old.booking_date or
     new.booking_time is distinct from old.booking_time or new.party_size is distinct from old.party_size) then
    perform pg_advisory_xact_lock(734512); -- same lock as FastAPI database.db(write=True)
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
    with seats(id,capacity) as (values ('10',3),('11',3),('12',2),('13',2),('14',2),('15',4),('16',4),('17',2),('18',4),('19',4),('20',4),('21',4),('22',2),('23',2)),
    rows(ids) as (values (array['10','11','12','13']), (array['14','15','16','17','18','19']), (array['21','22','23'])),
    combos as (
      select array[id] ids,capacity from seats
      union all
      select r.ids[a:z], sum(s.capacity)::int from rows r
      cross join lateral generate_series(1,array_length(r.ids,1)) a
      cross join lateral generate_series(a+1,array_length(r.ids,1)) z
      join seats s on s.id=any(r.ids[a:z]) group by r.ids,a,z having sum(s.capacity)<=8
    )
    select array_to_string(c.ids,',') into assigned from combos c
    where c.capacity>=new.party_size and not exists (
      select 1 from public.bookings b where b.id<>new.id and b.status='confirmed'
      and b.booking_date=new.booking_date
      and abs(extract(epoch from ((b.booking_date || ' ' || b.booking_time)::timestamp at time zone 'Europe/Rome' - dt))) < 7200
      and string_to_array(b.tables,',') && c.ids)
    order by c.capacity,array_length(c.ids,1),c.ids limit 1;
    if assigned is null then raise exception 'Non c’è posto a questo orario'; end if;
    new.tables := assigned;
  end if;
  return new;
end $$;
revoke all on function private.prepare_booking() from public,anon,authenticated;
create trigger prepare_booking before insert or update on public.bookings
for each row execute function private.prepare_booking();
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
end $$;
commit;
