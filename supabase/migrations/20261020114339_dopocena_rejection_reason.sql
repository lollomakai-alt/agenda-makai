-- Follow the DOPOCENA email migration. No changes to historical decisions.
begin;
set local lock_timeout='5s';
create function private.dopocena_rejection_reason() returns trigger
language plpgsql security definer set search_path='' as $$
declare reason text;
begin
 if old.status='pending' and new.status='rejected' then
  reason:=btrim(current_setting('makai.dopocena_rejection_reason',true));
  if current_setting('makai.dopocena_rejection_request',true) is distinct from new.request_id::text
   or reason is null or reason !~ '[^[:space:]]' or char_length(reason) not between 1 and 500 then
   raise exception 'Inserisci una motivazione del rifiuto (massimo 500 caratteri)' using errcode='22023';
  end if;
  if tg_when='AFTER' then
   update private.dopocena_decision_emails
    set snapshot=jsonb_set(snapshot,'{rejection_reason}',to_jsonb(reason))
    where request_id=new.request_id::text and decision='rejected' and status in ('queued','skipped');
   if not found then raise exception 'Comunicazione di rifiuto non preparata'; end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.dopocena_rejection_reason() from public,anon,authenticated,service_role;
create trigger require_dopocena_rejection_reason before update on private.online_dopocena_requests
 for each row execute function private.dopocena_rejection_reason();
-- PostgreSQL fires AFTER triggers in name order: queue_... precedes zz_....
create trigger zz_attach_dopocena_rejection_reason after update on private.online_dopocena_requests
 for each row execute function private.dopocena_rejection_reason();

create function public.admin_review_dopocena_with_reason(
 p_request_id private.online_dopocena_requests.request_id%type,p_decision text,p_reason text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.online_dopocena_requests; reason text:=btrim(coalesce(p_reason,'')); result jsonb; saved_reason text;
begin
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
  raise exception 'Accesso riservato allo staff' using errcode='42501';
 end if;
 if p_decision not in ('accepted','rejected') or p_decision is null
  or (p_decision='rejected' and (reason !~ '[^[:space:]]' or char_length(reason) not between 1 and 500))
  or (p_decision='accepted' and reason<>'') then
  raise exception 'Decisione o motivazione non valida' using errcode='22023';
 end if;
 select * into r from private.online_dopocena_requests where request_id=p_request_id for update;
 if r.request_id is null then raise exception 'Richiesta non trovata'; end if;
 if r.status<>'pending' then
  select snapshot->>'rejection_reason' into saved_reason from private.dopocena_decision_emails where request_id=r.request_id::text;
  if r.status<>p_decision or (p_decision='rejected' and saved_reason is distinct from reason) then
   raise exception 'Richiesta già gestita diversamente' using errcode='P0001';
  end if;
  return jsonb_build_object('request_id',r.request_id,'status',r.status,'booking_id',r.booking_id);
 end if;
 perform set_config('makai.dopocena_rejection_request',p_request_id::text,true);
 perform set_config('makai.dopocena_rejection_reason',reason,true);
 -- Preserve the original booking rules, capacity checks and audit trail.
 result:=public.admin_review_online_dopocena_request(p_request_id,p_decision);
 perform set_config('makai.dopocena_rejection_request','',true);
 perform set_config('makai.dopocena_rejection_reason','',true);
 return result;
end $$;
revoke all on function public.admin_review_dopocena_with_reason from public,anon,service_role;
grant execute on function public.admin_review_dopocena_with_reason to authenticated;

create or replace function public.admin_dopocena_email_outcomes() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
  raise exception 'Accesso riservato allo staff' using errcode='42501';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('request_id',request_id,'status',status,
  'rejection_reason',case when decision='rejected' then snapshot->>'rejection_reason' end))
  from private.dopocena_decision_emails),'[]'::jsonb);
end $$;
revoke all on function public.admin_dopocena_email_outcomes() from public,anon,service_role;
grant execute on function public.admin_dopocena_email_outcomes() to authenticated;
commit;
