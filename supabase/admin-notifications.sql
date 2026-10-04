-- Centro notifiche ADMIN. Applicare dopo booking-requests.sql.
-- Avvisi attivi derivati dai dati reali; lettura personale persistente.
begin;
set local lock_timeout = '5s';
create table if not exists public.admin_notification_reads (
  user_id uuid not null default auth.uid(),
  notification_id text not null check (length(notification_id) between 1 and 200),
  read_at timestamptz not null default now(),
  primary key (user_id, notification_id)
);
alter table public.admin_notification_reads enable row level security;
revoke all on public.admin_notification_reads from public, anon, authenticated;
grant select, insert on public.admin_notification_reads to authenticated;
drop policy if exists admin_notification_reads_select on public.admin_notification_reads;
create policy admin_notification_reads_select on public.admin_notification_reads for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin' and user_id = (select auth.uid()));
drop policy if exists admin_notification_reads_insert on public.admin_notification_reads;
create policy admin_notification_reads_insert on public.admin_notification_reads for insert to authenticated
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'admin' and user_id = (select auth.uid()));

create or replace function public.admin_list_notifications()
returns table (
  id text, booking_id bigint, booking_date text, kind text, priority text,
  message text, created_at timestamptz, read_at timestamptz
)
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'Accesso riservato allo staff' using errcode = '42501';
  end if;
  return query
  with scheduled as (
    select b.id, b.booking_date,
      case when b.booking_date ~ '^\d{4}-\d{2}-\d{2}$'
        and b.booking_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        and pg_input_is_valid(b.booking_date || ' ' || b.booking_time, 'timestamp')
        then (b.booking_date || ' ' || b.booking_time)::timestamp at time zone 'Europe/Rome'
      end as scheduled_at
    from public.bookings b
    where lower(coalesce(nullif(b.status,''),'confirmed')) = 'confirmed'
      and b.booking_date between to_char((now() at time zone 'Europe/Rome')::date-1,'YYYY-MM-DD')
                             and to_char((now() at time zone 'Europe/Rome')::date,'YYYY-MM-DD')
  ), events as (
    select 'request:' || r.id::text as id, b.id as booking_id, b.booking_date,
      'customer_request'::text as kind,
      case when r.request_type = 'cancellazione' then 'high' else 'normal' end as priority,
      'Richiesta cliente: ' || case r.request_type when 'data' then 'data' when 'ora' then 'ora'
        when 'persone' then 'persone' when 'cancellazione' then 'cancellazione' else 'note' end as message,
      r.created_at
    from public.booking_requests r join public.bookings b on b.id = r.booking_id
    where r.status = 'pending'
    union all
    select 'online:' || b.id::text, b.id, b.booking_date, 'online_booking', 'normal',
      'Nuova prenotazione online · Tavolo da assegnare', b.created_at
    from public.bookings b
    where b.source='booking' and b.status='confirmed' and coalesce(btrim(b.tables),'')=''
      and b.booking_date >= to_char((now() at time zone 'Europe/Rome')::date,'YYYY-MM-DD')
    union all
    select 'delay:' || s.id::text || ':' || to_char(s.scheduled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS'),
      s.id, s.booking_date, 'delay',
      case when now() >= s.scheduled_at + interval '30 minutes' then 'high' else 'normal' end,
      'Cliente non ancora arrivato · ' || floor(extract(epoch from (now()-s.scheduled_at))/60)::integer::text || ' min di ritardo',
      s.scheduled_at + interval '15 minutes'
    from scheduled s
    where now() >= s.scheduled_at + interval '15 minutes'
      and now() < s.scheduled_at + interval '24 hours'
  )
  select e.id, e.booking_id, e.booking_date, e.kind, e.priority, e.message, e.created_at, r.read_at
  from events e left join public.admin_notification_reads r
    on r.notification_id = e.id and r.user_id = auth.uid()
  order by (r.read_at is null) desc, (e.priority = 'high') desc, e.created_at desc, e.id;
end;
$$;

create or replace function public.admin_mark_notification_read(notification_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved_at timestamptz;
begin
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'Accesso riservato allo staff' using errcode = '42501';
  end if;
  if not exists(select 1 from public.admin_list_notifications() n where n.id = notification_id) then
    raise exception 'Notifica risolta o non accessibile: aggiorna il centro notifiche' using errcode = 'P0002';
  end if;
  insert into public.admin_notification_reads(user_id,notification_id)
    values(auth.uid(),notification_id) on conflict do nothing;
  select r.read_at into saved_at from public.admin_notification_reads r
    where r.user_id = auth.uid() and r.notification_id = admin_mark_notification_read.notification_id;
  return jsonb_build_object('id',notification_id,'read_at',saved_at);
end;
$$;
revoke all on function public.admin_list_notifications(), public.admin_mark_notification_read(text) from public, anon;
grant execute on function public.admin_list_notifications(), public.admin_mark_notification_read(text) to authenticated;
notify pgrst, 'reload schema';
commit;
