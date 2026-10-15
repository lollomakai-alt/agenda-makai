-- Schema-only fixture read from Production on 2026-10-15; no customer data.
-- pg_get_functiondef MD5: faff59599c266226f22b9e3609470a07
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
    select 'customer_event:' || h.id::text, h.booking_id, b.booking_date,
      'customer_information'::text, 'normal'::text,
      case when h.action='customer_cancelled' then 'Cancellazione cliente: ' ||
        coalesce(h.old_data->>'booking_date','') || ' ' || coalesce(h.old_data->>'booking_time','') ||
        ' · tavolo ' || coalesce(h.old_data->>'tables','')
      else 'Modifica cliente: ' || coalesce(h.old_data::text,'{}') || ' → ' || coalesce(h.new_data::text,'{}') end,
      h.created_at
    from public.booking_history h join public.bookings b on b.id=h.booking_id
    where h.action in ('customer_changed','customer_cancelled')
      and h.created_at >= now()-interval '30 days'
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
  left join public.admin_notification_archives a
    on a.notification_id=e.id and a.user_id=auth.uid()
  where a.notification_id is null
  order by e.created_at desc, e.id;
end;
$function$
;
