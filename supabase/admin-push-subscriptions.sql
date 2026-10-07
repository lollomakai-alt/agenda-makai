-- Subscription Web Push per amministratori autenticati.
begin;
set local lock_timeout = '5s';

create table if not exists public.admin_push_subscriptions (
  endpoint text primary key check (length(endpoint) between 1 and 4096 and endpoint ~ '^https://[^[:space:]]+$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth text not null check (length(auth) between 16 and 100),
  expiration_time timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_push_subscriptions_user_id_idx
  on public.admin_push_subscriptions (user_id);

alter table public.admin_push_subscriptions enable row level security;
revoke all on public.admin_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.admin_push_subscriptions to authenticated;
grant select, insert, update, delete on public.admin_push_subscriptions to service_role;

drop policy if exists admin_push_subscriptions_select on public.admin_push_subscriptions;
create policy admin_push_subscriptions_select on public.admin_push_subscriptions
  for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin'
    and user_id = (select auth.uid()));

drop policy if exists admin_push_subscriptions_insert on public.admin_push_subscriptions;
create policy admin_push_subscriptions_insert on public.admin_push_subscriptions
  for insert to authenticated
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'admin'
    and user_id = (select auth.uid()));

drop policy if exists admin_push_subscriptions_update on public.admin_push_subscriptions;
create policy admin_push_subscriptions_update on public.admin_push_subscriptions
  for update to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin'
    and user_id = (select auth.uid()))
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'admin'
    and user_id = (select auth.uid()));

drop policy if exists admin_push_subscriptions_delete on public.admin_push_subscriptions;
create policy admin_push_subscriptions_delete on public.admin_push_subscriptions
  for delete to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin'
    and user_id = (select auth.uid()));

notify pgrst, 'reload schema';
commit;
