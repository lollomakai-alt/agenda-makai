-- Local preparation only. No backfill: only future pending -> decided transitions.
begin;
create table private.dopocena_decision_emails (
 request_id text primary key,
 decision text not null check(decision in ('accepted','rejected')),
 booking_id bigint,
 snapshot jsonb not null,
 recipient text not null,
 status text not null check(status in ('queued','sending','accepted','failed','unknown','skipped')),
 attempted_at timestamptz,
 provider_id text,
 error_code text,
 created_at timestamptz not null default now()
);
alter table private.dopocena_decision_emails enable row level security;
revoke all on private.dopocena_decision_emails from public,anon,authenticated,service_role;

create function private.queue_dopocena_decision_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.status='pending' and new.status in ('accepted','rejected') then
  insert into private.dopocena_decision_emails(request_id,decision,booking_id,snapshot,recipient,status,error_code)
  values(new.request_id::text,new.status,new.booking_id,
   jsonb_build_object('name',new.name,'booking_date',new.booking_date,'booking_time',new.booking_time,
    'party_size',new.party_size,'tables','','booking_type','dopocena','status',new.status),coalesce(new.email,''),
   case when new.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(new.email)<=120 then 'queued' else 'skipped' end,
   case when new.email is null or new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(new.email)>120 then 'invalid_email' end)
  on conflict(request_id) do nothing;
  -- The booking INSERT already queued a generic confirmation. This decision
  -- owns its automatic email; suppress the unsent generic copy in this transaction.
  if new.status='accepted' then
   with changed as (
    update public.booking_communications set status='superseded',error_code='dopocena_decision_email'
    where booking_id=new.booking_id and event_key='created:'||new.booking_id
     and channel='email' and status in ('queued','skipped') returning id
   ) insert into public.booking_communication_logs(communication_id,status,error_code)
    select id,'superseded','dopocena_decision_email' from changed;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.queue_dopocena_decision_email() from public,anon,authenticated,service_role;
create trigger queue_dopocena_decision_email after update on private.online_dopocena_requests
for each row execute function private.queue_dopocena_decision_email();

-- Retention follows the request, including refusals without a booking.
create function private.delete_dopocena_decision_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin delete from private.dopocena_decision_emails where request_id=old.request_id::text; return old; end $$;
revoke all on function private.delete_dopocena_decision_email() from public,anon,authenticated,service_role;
create trigger delete_dopocena_decision_email after delete on private.online_dopocena_requests
for each row execute function private.delete_dopocena_decision_email();

create function public.admin_dopocena_email_outcomes() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
  raise exception 'Accesso riservato allo staff' using errcode='42501';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('request_id',request_id,'status',status))
  from private.dopocena_decision_emails),'[]'::jsonb);
end $$;
revoke all on function public.admin_dopocena_email_outcomes() from public,anon,service_role;
grant execute on function public.admin_dopocena_email_outcomes() to authenticated;

-- A single atomic claim, never reopened (even after 24h or an ambiguous result).
create function public.dopocena_email_operation(p_request_id text,p_action text,p_status text default null,p_provider_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.dopocena_decision_emails;
begin
 if p_action='claim' then
  update private.dopocena_decision_emails set status='sending',attempted_at=now()
   where request_id=p_request_id and status='queued' returning * into r;
 elsif p_action='finish' then
  if p_status not in ('accepted','failed','unknown') or p_status is null
   or (p_status='accepted' and (p_provider_id is null or length(p_provider_id) not between 1 and 256)) then
   raise exception 'Esito non valido';
  end if;
  update private.dopocena_decision_emails set status=p_status,provider_id=case when p_status='accepted' then p_provider_id end
   where request_id=p_request_id and status='sending' returning * into r;
 elsif p_action='read' then
  select * into r from private.dopocena_decision_emails where request_id=p_request_id;
 else raise exception 'Operazione non valida'; end if;
 if r.request_id is null then return null; end if;
 return to_jsonb(r);
end $$;
revoke all on function public.dopocena_email_operation(text,text,text,text) from public,anon,authenticated;
grant execute on function public.dopocena_email_operation(text,text,text,text) to service_role;
commit;
