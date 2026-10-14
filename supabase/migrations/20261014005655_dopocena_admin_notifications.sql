-- Aggiunge le richieste DOPOCENA in attesa alla campanella ADMIN.
-- Preserva la funzione live precedente per un rollback senza perdita di prenotazioni.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if to_regclass('private.online_dopocena_requests') is null
     or to_regprocedure('public.admin_list_notifications()') is null
     or to_regprocedure('public.admin_mark_notification_read(text)') is null then
    raise exception 'Prerequisiti notifiche/DOPOCENA mancanti' using errcode='P0001';
  end if;
  if to_regclass('private.admin_dopocena_notification_backup') is not null
     or to_regprocedure('public.admin_pending_dopocena_notice_events()') is not null then
    raise exception 'Migrazione notifiche DOPOCENA già applicata' using errcode='P0001';
  end if;
  if md5(pg_get_functiondef('public.admin_list_notifications()'::regprocedure))
     <> '93a1b96de661f1f80288d81cb8b21fdf' then
    raise exception 'Funzione notifiche cambiata: riesaminare prima di applicare' using errcode='P0001';
  end if;
end $$;

create table private.admin_dopocena_notification_backup (
  id boolean primary key default true check (id),
  definition text not null,
  saved_at timestamptz not null default now()
);
alter table private.admin_dopocena_notification_backup enable row level security;
revoke all on private.admin_dopocena_notification_backup from public, anon, authenticated, service_role;
insert into private.admin_dopocena_notification_backup(id, definition)
values (true, pg_get_functiondef('public.admin_list_notifications()'::regprocedure));

create or replace function public.admin_pending_dopocena_notice_events()
returns table (
  id text, booking_id bigint, booking_date text, kind text, priority text,
  message text, created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'Accesso riservato allo staff' using errcode = '42501';
  end if;
  return query
    select 'dopocena:' || r.request_id::text, null::bigint, r.booking_date::text,
      'dopocena_request'::text, 'normal'::text,
      'Richiesta DOPOCENA · ' || r.party_size::text || ' persone alle ' || r.booking_time,
      r.created_at
    from private.online_dopocena_requests r
    where r.status = 'pending';
end;
$$;
revoke all on function public.admin_pending_dopocena_notice_events() from public, anon;
grant execute on function public.admin_pending_dopocena_notice_events() to authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_notifications()
 RETURNS TABLE(id text, booking_id bigint, booking_date text, kind text, priority text, message text, created_at timestamp with time zone, read_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    select * from public.admin_pending_dopocena_notice_events()
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
$function$;
notify pgrst, 'reload schema';
commit;
