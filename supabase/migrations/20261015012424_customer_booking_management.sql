begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_requests') is null
     or to_regclass('public.booking_history') is null
     or to_regclass('public.booking_communications') is null
     or to_regprocedure('private.online_slot_status(text,text,integer,text,bigint)') is null
     or to_regprocedure('private.booking_scheduled_at(text,text)') is null then
    raise exception 'Schema booking v2 mancante: interrompere la migrazione';
  end if;
  if to_regclass('private.customer_management_function_backup') is null and (
    md5(pg_get_functiondef('private.process_booking_request()'::regprocedure))<>'dc6075a66c8bfd5ca863bc67c1ac58dd'
    or md5(pg_get_functiondef('public.admin_list_notifications()'::regprocedure))<>'91a3c4cad3e3d2f14a95178988e200d0') then
    raise exception 'Funzioni booking cambiate: riesaminare la migrazione';
  end if;
  if exists(select 1 from public.booking_requests where status='pending'
    group by booking_id,request_type having count(*)>1) then
    raise exception 'Richieste pendenti duplicate: risolvere prima della migrazione';
  end if;
end $$;

create table if not exists private.customer_management_function_backup (
  function_name text primary key,
  definition text not null,
  saved_at timestamptz not null default now()
);
alter table private.customer_management_function_backup enable row level security;
revoke all on private.customer_management_function_backup from public, anon, authenticated, service_role;
insert into private.customer_management_function_backup(function_name,definition)
values
  ('private.process_booking_request()',pg_get_functiondef('private.process_booking_request()'::regprocedure)),
  ('public.admin_list_notifications()',pg_get_functiondef('public.admin_list_notifications()'::regprocedure))
on conflict(function_name) do nothing;

create table if not exists private.booking_customer_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  booking_id bigint not null references public.bookings(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists booking_customer_tokens_booking_idx
  on private.booking_customer_tokens(booking_id);
create index if not exists booking_customer_tokens_expiry
  on private.booking_customer_tokens(expires_at);
alter table private.booking_customer_tokens enable row level security;
revoke all on private.booking_customer_tokens from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update on private.booking_customer_tokens to service_role;

create table if not exists private.customer_booking_operations (
  operation_id uuid primary key,
  token_hash text not null,
  booking_id bigint not null references public.bookings(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{32}$'),
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists customer_booking_operations_booking_idx
  on private.customer_booking_operations(booking_id, created_at desc);
alter table private.customer_booking_operations enable row level security;
revoke all on private.customer_booking_operations from public, anon, authenticated;
grant select, insert on private.customer_booking_operations to service_role;

alter table public.bookings add column if not exists reconfirmation_status text not null default 'not_requested';
alter table public.bookings add column if not exists reconfirmed_at timestamptz;
alter table public.booking_requests add column if not exists alternative_note text not null default '';
alter table public.booking_requests add column if not exists origin text not null default 'staff';
create table if not exists public.admin_notification_archives (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_id text not null check (length(notification_id) between 1 and 200),
  archived_at timestamptz not null default now(),
  primary key(user_id, notification_id)
);
alter table public.admin_notification_archives enable row level security;
revoke all on public.admin_notification_archives from public, anon, authenticated;
grant select, insert on public.admin_notification_archives to authenticated;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public'
      and tablename='admin_notification_archives' and policyname='admin_own_archives') then
    create policy admin_own_archives on public.admin_notification_archives
      for all to authenticated
      using (user_id=(select auth.uid()) and (select auth.jwt()->'app_metadata'->>'role')='admin')
      with check (user_id=(select auth.uid()) and (select auth.jwt()->'app_metadata'->>'role')='admin');
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='booking_requests_alternative_note_length' and conrelid='public.booking_requests'::regclass) then
    alter table public.booking_requests add constraint booking_requests_alternative_note_length check (length(alternative_note)<=300);
  end if;
  if not exists(select 1 from pg_constraint where conname='booking_requests_origin_check' and conrelid='public.booking_requests'::regclass) then
    alter table public.booking_requests add constraint booking_requests_origin_check check (origin in ('staff','customer'));
  end if;
end $$;

create or replace function private.customer_booking(p_token_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object(
    'name', b.name, 'booking_date', b.booking_date, 'booking_time', b.booking_time,
    'booking_type', b.booking_type, 'party_size', b.party_size, 'notes', b.notes,
    'status', b.status, 'reconfirmation_status', b.reconfirmation_status,
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'type', r.request_type, 'value', r.requested_value,
      'status', r.status, 'alternative', r.alternative_note
    ) order by r.created_at desc, r.id desc)
      from public.booking_requests r where r.booking_id=b.id), '[]'::jsonb)
  )
  from private.booking_customer_tokens t
  join public.bookings b on b.id=t.booking_id
  where t.token_hash=p_token_hash and t.expires_at>now() and t.revoked_at is null;
$$;

create or replace function private.reconfirm_customer_booking(p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.bookings%rowtype;
begin
  perform pg_advisory_xact_lock(734512);
  select bookings.* into b from private.booking_customer_tokens t
    join public.bookings bookings on bookings.id=t.booking_id
    where t.token_hash=p_token_hash and t.expires_at>now() and t.revoked_at is null
      and bookings.status='confirmed'
      and private.booking_scheduled_at(bookings.booking_date,bookings.booking_time)>now()
    for update of bookings;
  if b.id is null then raise exception 'Collegamento non valido o prenotazione non riconfermabile' using errcode='P0002'; end if;
  if b.reconfirmation_status<>'reconfirmed' then
    update public.bookings set reconfirmation_status='reconfirmed', reconfirmed_at=now() where id=b.id;
    insert into public.booking_history(booking_id,action,old_data,new_data)
      values(b.id,'customer_reconfirmed',jsonb_build_object('reconfirmation_status',b.reconfirmation_status),
        jsonb_build_object('reconfirmation_status','reconfirmed'));
  end if;
  return jsonb_build_object('ok',true,'reconfirmation_status','reconfirmed');
end $$;

create unique index if not exists booking_requests_one_pending_kind
  on public.booking_requests(booking_id, request_type) where status='pending';

create or replace function private.customer_booking_request(
  p_token_hash text, p_request_type text, p_requested_value jsonb, p_operation_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  b public.bookings%rowtype;
  changed public.bookings%rowtype;
  prior private.customer_booking_operations%rowtype;
  result jsonb;
  target_day text;
  target_time text;
  target_people integer;
  target_notes text;
  availability text;
  request_id bigint;
  fingerprint text;
  prior_guard text;
begin
  if p_operation_id is null then raise exception 'Identificativo operazione mancante' using errcode='22023'; end if;
  if p_request_type not in ('data','ora','persone','note','cancellazione') then
    raise exception 'Tipo richiesta non valido' using errcode='22023';
  end if;
  fingerprint := md5(p_token_hash || ':' || p_request_type || ':' || coalesce(p_requested_value::text,'null'));
  perform pg_advisory_xact_lock(734512);
  select * into prior from private.customer_booking_operations where operation_id=p_operation_id;
  if found then
    if prior.token_hash<>p_token_hash or prior.fingerprint<>fingerprint then
      raise exception 'Identificativo operazione già utilizzato' using errcode='40001';
    end if;
    return prior.result || jsonb_build_object('replayed',true);
  end if;
  select bookings.* into b from private.booking_customer_tokens t
    join public.bookings bookings on bookings.id=t.booking_id
    where t.token_hash=p_token_hash and t.expires_at>now() and t.revoked_at is null
    for update of bookings;
  if b.id is null or b.status<>'confirmed'
     or private.booking_scheduled_at(b.booking_date,b.booking_time)<=now() then
    raise exception 'Collegamento non valido o prenotazione non modificabile' using errcode='P0002';
  end if;
  target_day := b.booking_date;
  target_time := b.booking_time;
  target_people := b.party_size;
  target_notes := b.notes;
  if p_request_type='cancellazione' then
    if p_requested_value is not null and p_requested_value<>'null'::jsonb then
      raise exception 'Cancellazione senza valore' using errcode='22023';
    end if;
    update public.bookings set status='cancelled', tables='', table_released_at=now()
      where id=b.id returning * into changed;
    insert into public.booking_history(booking_id,action,old_data,new_data)
      values(b.id,'customer_cancelled',
        jsonb_build_object('status',b.status,'tables',b.tables,'booking_date',b.booking_date,'booking_time',b.booking_time),
        jsonb_build_object('status',changed.status,'tables',changed.tables,'at',now(),'source','customer_link'));
    if b.booking_type='dopocena' then
      perform private.queue_booking_email(changed,'cancelled','customer_cancelled:'||b.id);
    end if;
    result := jsonb_build_object('ok',true,'outcome','cancelled');
  else
    if jsonb_typeof(p_requested_value)='string' then
      if p_request_type='data' then target_day := p_requested_value #>> '{}';
      elsif p_request_type='ora' then target_time := p_requested_value #>> '{}';
      elsif p_request_type='note' then target_notes := p_requested_value #>> '{}';
      end if;
    elsif p_request_type='persone' and jsonb_typeof(p_requested_value)='number'
      and p_requested_value::text ~ '^[1-6]$' then
      target_people := (p_requested_value::text)::integer;
    else
      raise exception 'Valore richiesta non valido' using errcode='22023';
    end if;
    if p_request_type='note' then
      if length(target_notes)>300 then raise exception 'Note troppo lunghe' using errcode='22023'; end if;
      if target_notes is distinct from b.notes then
        update public.bookings set notes=target_notes where id=b.id returning * into changed;
        insert into public.booking_history(booking_id,action,old_data,new_data)
          values(b.id,'customer_changed',jsonb_build_object('notes',b.notes),
            jsonb_build_object('notes',target_notes,'source','customer_link'));
        perform private.queue_booking_email(changed,'updated','customer_note:'||p_operation_id::text);
      end if;
      result := jsonb_build_object('ok',true,'outcome',case when changed.id is null then 'unchanged' else 'applied' end);
    else
      if target_people not between 1 and 6
         or private.service_slot_at(target_day,target_time,b.booking_type) is null
         or private.service_slot_at(target_day,target_time,b.booking_type)<=now()+interval '30 minutes' then
        raise exception 'Data, orario o coperti non validi' using errcode='22023';
      end if;
      if (target_day,target_time,target_people) is not distinct from
         (b.booking_date,b.booking_time,b.party_size) then
        result := jsonb_build_object('ok',true,'outcome','unchanged');
      else
        availability := private.online_slot_status(target_day,target_time,target_people,b.booking_type,b.id);
        if availability='available' and b.booking_type='normale' then
          update public.bookings set booking_date=target_day, booking_time=target_time,
            party_size=target_people where id=b.id returning * into changed;
          insert into public.booking_history(booking_id,action,old_data,new_data)
            values(b.id,'customer_changed',
              jsonb_build_object('booking_date',b.booking_date,'booking_time',b.booking_time,
                'party_size',b.party_size,'tables',b.tables),
              jsonb_build_object('booking_date',changed.booking_date,'booking_time',changed.booking_time,
                'party_size',changed.party_size,'tables',changed.tables,'source','customer_link'));
          result := jsonb_build_object('ok',true,'outcome','applied');
        else
          prior_guard := coalesce(current_setting('makai.customer_request',true),'');
          perform set_config('makai.customer_request','on',true);
          insert into public.booking_requests(booking_id,request_type,requested_value,expected,origin)
            values(b.id,p_request_type,p_requested_value,'{}','customer') returning id into request_id;
          perform set_config('makai.customer_request',prior_guard,true);
          result := jsonb_build_object('ok',true,'outcome','pending','request_id',request_id);
        end if;
      end if;
    end if;
  end if;
  insert into private.customer_booking_operations(operation_id,token_hash,booking_id,fingerprint,result)
    values(p_operation_id,p_token_hash,b.id,fingerprint,result);
  return result;
end $$;

-- Compatibility for the already deployed API until its four-argument call is released.
-- The current page promises staff approval, so this signature always creates a pending request.
create or replace function private.customer_booking_request(
  p_token_hash text, p_request_type text, p_requested_value jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.bookings%rowtype; request_id bigint; prior_guard text;
begin
  perform pg_advisory_xact_lock(734512);
  select bookings.* into b from private.booking_customer_tokens t
    join public.bookings bookings on bookings.id=t.booking_id
    where t.token_hash=p_token_hash and t.expires_at>now() and t.revoked_at is null
      and bookings.status='confirmed'
      and private.booking_scheduled_at(bookings.booking_date,bookings.booking_time)>now()
    for update of bookings;
  if b.id is null then raise exception 'Collegamento non valido o prenotazione non modificabile' using errcode='P0002'; end if;
  prior_guard := coalesce(current_setting('makai.customer_request',true),'');
  perform set_config('makai.customer_request','on',true);
  insert into public.booking_requests(booking_id,request_type,requested_value,expected,origin)
    values(b.id,p_request_type,p_requested_value,'{}','customer') returning id into request_id;
  perform set_config('makai.customer_request',prior_guard,true);
  return jsonb_build_object('ok',true,'outcome','pending','request_id',request_id);
end $$;



-- Preserve the existing staff review logic, adding the internal customer path.
CREATE OR REPLACE FUNCTION private.process_booking_request() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  b public.bookings%rowtype;
  field_name text;
  changes jsonb;
  day_value date;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin'
     and not (tg_op='INSERT' and current_user not in ('anon','authenticated')
       and current_setting('makai.customer_request',true)='on') then
    raise exception 'Accesso riservato allo staff' using errcode = '42501';
  end if;
  -- Stesso ordine di lock della logica modifica: serializza le approvazioni.
  perform pg_advisory_xact_lock(734512);
  select * into b from public.bookings where id = new.booking_id for update;
  if not found then raise exception 'Prenotazione non trovata' using errcode = 'P0002'; end if;
  if tg_op = 'INSERT' then
    if coalesce(b.status,'confirmed') <> 'confirmed' then raise exception 'Prenotazione non più modificabile'; end if;
    if new.request_type = 'cancellazione' then
      if new.requested_value is not null and new.requested_value <> 'null'::jsonb then raise exception 'Cancellazione senza valore'; end if;
      new.requested_value := null;
    elsif new.request_type = 'persone' then
      if jsonb_typeof(new.requested_value) is distinct from 'number' or new.requested_value::text !~ '^[1-6]$' then raise exception 'Numero persone non valido'; end if;
    elsif new.request_type in ('data','ora','note') then
      if jsonb_typeof(new.requested_value) is distinct from 'string' then raise exception 'Valore non valido'; end if;
      if new.request_type = 'data' then
        if new.requested_value #>> '{}' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data non valida'; end if;
        day_value := (new.requested_value #>> '{}')::date;
        if to_char(day_value,'YYYY-MM-DD') <> new.requested_value #>> '{}' then raise exception 'Data non valida'; end if;
      elsif new.request_type = 'ora' and new.requested_value #>> '{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Ora non valida';
      elsif new.request_type = 'note' and length(new.requested_value #>> '{}') > 300 then raise exception 'Note troppo lunghe'; end if;
    else raise exception 'Tipo richiesta non valido'; end if;
    new.expected := jsonb_build_object('booking_date',b.booking_date,'booking_time',b.booking_time,'party_size',b.party_size,'tables',b.tables,'notes',b.notes,'status',b.status);
    new.status := 'pending'; new.created_at := now(); new.created_by := auth.uid();
    new.reviewed_at := null; new.reviewed_by := null;
  else
    if old.status='pending' and new.status='pending'
       and new.alternative_note is distinct from old.alternative_note
       and (to_jsonb(new)-'alternative_note')=(to_jsonb(old)-'alternative_note') then
      insert into public.booking_history(booking_id,action,old_data,new_data)
        values(new.booking_id,'customer_request_alternative',
          jsonb_build_object('request_id',new.id,'alternative',old.alternative_note),
          jsonb_build_object('request_id',new.id,'alternative',new.alternative_note));
      return new;
    end if;
    if old.status <> 'pending' or new.status not in ('approved','rejected') then raise exception 'Richiesta già gestita o decisione non valida' using errcode = '40001'; end if;
    if (to_jsonb(new) - array['status','reviewed_at','reviewed_by']) is distinct from
       (to_jsonb(old) - array['status','reviewed_at','reviewed_by']) then raise exception 'Richiesta immutabile'; end if;
    if new.status = 'approved' then
      if jsonb_build_object('booking_date',b.booking_date,'booking_time',b.booking_time,'party_size',b.party_size,'tables',b.tables,'notes',b.notes,'status',b.status) is distinct from old.expected then
        raise exception 'Prenotazione cambiata: rifiuta la richiesta e registrane una aggiornata' using errcode = '40001';
      end if;
      if coalesce(b.status,'confirmed') <> 'confirmed' then raise exception 'Prenotazione non più modificabile'; end if;
      if old.origin='customer' and old.request_type in ('data','ora','persone')
         and b.booking_type='normale' then
        if private.online_slot_status(
          case when old.request_type='data' then old.requested_value #>> '{}' else b.booking_date end,
          case when old.request_type='ora' then old.requested_value #>> '{}' else b.booking_time end,
          case when old.request_type='persone' then (old.requested_value::text)::integer else b.party_size end,
          b.booking_type,b.id) <> 'available' then
          raise exception 'Disponibilità cambiata: proporre un’alternativa' using errcode='40001';
        end if;
      end if;
      if old.request_type = 'cancellazione' then
        perform public.admin_set_booking_status_with_history(old.booking_id,'cancelled');
      else
        field_name := case old.request_type when 'data' then 'booking_date' when 'ora' then 'booking_time' when 'persone' then 'party_size' when 'note' then 'notes' end;
        changes := jsonb_build_object(field_name,old.requested_value);
        perform public.admin_update_booking(old.booking_id,changes,old.expected - 'status');
      end if;
    end if;
    new.reviewed_at := now(); new.reviewed_by := auth.uid();
  end if;
  insert into public.booking_history(booking_id,action,old_data,new_data)
    values(new.booking_id, 'customer_request_' || case when tg_op = 'INSERT' then 'created' else new.status end,
      case when tg_op = 'INSERT' then '{}'::jsonb else jsonb_build_object('request_status',old.status) end,
      jsonb_build_object('request_id',new.id,'request_type',new.request_type,'requested_value',new.requested_value,
        'request_status',new.status,'actor_id',auth.uid()));
  return new;
end;
$_$;


-- Keep pending notices and add informative customer events, most recent first.
CREATE OR REPLACE FUNCTION public.admin_list_notifications() RETURNS TABLE(id text, booking_id bigint, booking_date text, kind text, priority text, message text, created_at timestamp with time zone, read_at timestamp with time zone)
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
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
$_$;

create or replace function public.admin_archive_notification(notification_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved_at timestamptz;
begin
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
    raise exception 'Accesso riservato allo staff' using errcode='42501';
  end if;
  if not exists(select 1 from public.admin_list_notifications() n where n.id=notification_id) then
    raise exception 'Notifica non accessibile' using errcode='P0002';
  end if;
  insert into public.admin_notification_archives(user_id,notification_id)
    values(auth.uid(),notification_id) on conflict do nothing;
  select archived_at into saved_at from public.admin_notification_archives a
    where a.user_id=auth.uid() and a.notification_id=admin_archive_notification.notification_id;
  return jsonb_build_object('id',notification_id,'archived_at',saved_at);
end $$;

create or replace function public.admin_propose_booking_alternative(request_id bigint, proposal text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.booking_requests%rowtype;
begin
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin'
     or length(btrim(coalesce(proposal,''))) not between 1 and 300 then
    raise exception 'Proposta non valida' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(734512);
  update public.booking_requests r set alternative_note=btrim(proposal)
    where r.id=request_id and r.status='pending' returning * into saved;
  if not found then raise exception 'Richiesta già gestita' using errcode='40001'; end if;
  return to_jsonb(saved);
end $$;

create or replace function public.admin_booking_request_alternatives(request_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
    raise exception 'Accesso riservato allo staff' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('booking_date',candidate.day_text,
    'booking_time',candidate.slot,'party_size',candidate.people)
    order by candidate.day_text,candidate.slot),'[]'::jsonb) into result
  from (
    select to_char(days.day_value,'YYYY-MM-DD') as day_text, slots.slot,
      case when r.request_type='persone' then (r.requested_value::text)::integer else b.party_size end as people
    from public.booking_requests r join public.bookings b on b.id=r.booking_id
    cross join lateral generate_series(
      case when r.request_type='data' then (r.requested_value #>> '{}')::date else b.booking_date::date end,
      case when r.request_type='data' then (r.requested_value #>> '{}')::date+7 else b.booking_date::date+7 end,
      interval '1 day') as days(day_value)
    cross join (values ('19:00'),('19:30'),('20:00'),('20:30'),('21:00'),('21:30'),('22:00'),('22:30')) slots(slot)
    where r.id=request_id and r.status='pending' and r.request_type in ('data','ora','persone')
      and b.booking_type='normale'
      and private.online_slot_status(to_char(days.day_value,'YYYY-MM-DD'),slots.slot,
        case when r.request_type='persone' then (r.requested_value::text)::integer else b.party_size end,
        b.booking_type,b.id)='available'
    order by days.day_value,slots.slot limit 10
  ) candidate;
  return result;
end $$;

revoke all on function private.customer_booking(text),
  private.customer_booking_request(text,text,jsonb),
  private.customer_booking_request(text,text,jsonb,uuid),
  private.reconfirm_customer_booking(text)
  from public, anon, authenticated;
grant execute on function private.customer_booking(text),
  private.customer_booking_request(text,text,jsonb),
  private.customer_booking_request(text,text,jsonb,uuid),
  private.reconfirm_customer_booking(text) to service_role;
revoke all on function public.admin_archive_notification(text),
  public.admin_propose_booking_alternative(bigint,text),
  public.admin_booking_request_alternatives(bigint) from public, anon;
grant execute on function public.admin_archive_notification(text),
  public.admin_propose_booking_alternative(bigint,text),
  public.admin_booking_request_alternatives(bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
