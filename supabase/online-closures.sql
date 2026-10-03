begin;
create table public.online_booking_closures (
  booking_date date primary key,
  created_at timestamptz not null default now()
);
alter table public.online_booking_closures enable row level security;
revoke all on public.online_booking_closures from public, anon, authenticated;
grant select, insert, delete on public.online_booking_closures to authenticated;
grant select on public.online_booking_closures to service_role;
create policy admin_closures on public.online_booking_closures for all to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') = 'admin')
with check ((select auth.jwt()->'app_metadata'->>'role') = 'admin');

create function private.lock_online_closure() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(734512);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.lock_online_closure() from public, anon, authenticated;
create trigger lock_online_closure before insert or delete on public.online_booking_closures
for each row execute function private.lock_online_closure();

create function private.enforce_online_closure() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.source in ('booking', 'ai') and new.status = 'confirmed' then
    if tg_op = 'UPDATE' then
      if new.booking_date is not distinct from old.booking_date
         and new.booking_time is not distinct from old.booking_time
         and new.party_size is not distinct from old.party_size
         and new.source is not distinct from old.source
         and new.status is not distinct from old.status then return new; end if;
    end if;
    perform pg_advisory_xact_lock(734512);
    if exists (select 1 from public.online_booking_closures where booking_date = new.booking_date::date) then
      raise exception 'Le prenotazioni online per questo giorno sono chiuse. Contatta il locale.';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.enforce_online_closure() from public, anon, authenticated;
create trigger enforce_online_closure before insert or update on public.bookings
for each row execute function private.enforce_online_closure();
commit;
