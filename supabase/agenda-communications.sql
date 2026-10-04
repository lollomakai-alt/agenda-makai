-- Applicare dopo booking-requests.sql. Nessun invio durante la migrazione.
begin;
set local lock_timeout='5s';
create table if not exists public.booking_communications (
 id bigint generated always as identity primary key,
 booking_id bigint not null references public.bookings(id) on delete cascade,
 channel text not null check(channel in ('email','whatsapp')),
 kind text not null check(kind in ('confirmation','updated','cancelled')),
 status text not null check(status in ('queued','sending','accepted','failed','unknown','skipped','superseded','opened')),
 snapshot jsonb not null, recipient text not null,
 event_key text unique, attempts integer not null default 0,
 created_at timestamptz not null default now(), attempted_at timestamptz,
 provider_id text, error_code text
);
create table if not exists public.booking_communication_logs (
 id bigint generated always as identity primary key,
 communication_id bigint not null references public.booking_communications(id) on delete cascade,
 status text not null, error_code text, provider_id text, created_at timestamptz not null default now()
);
alter table public.booking_communications enable row level security;
alter table public.booking_communication_logs enable row level security;
revoke all on public.booking_communications,public.booking_communication_logs from public,anon,authenticated;
grant select on public.booking_communications,public.booking_communication_logs to authenticated;
grant all on public.booking_communications,public.booking_communication_logs to service_role;
grant usage on sequence public.booking_communications_id_seq,public.booking_communication_logs_id_seq to service_role;
drop policy if exists admin_communications_read on public.booking_communications;
create policy admin_communications_read on public.booking_communications for select to authenticated using((select auth.jwt()->'app_metadata'->>'role')='admin');
drop policy if exists admin_communication_logs_read on public.booking_communication_logs;
create policy admin_communication_logs_read on public.booking_communication_logs for select to authenticated using((select auth.jwt()->'app_metadata'->>'role')='admin');
create index if not exists booking_communications_booking_idx on public.booking_communications(booking_id,id desc);

-- Privilegio ristretto: i trigger inseriscono la coda anche per prenotazioni pubbliche.
create or replace function private.queue_booking_email(b public.bookings,k text,event text) returns void
language plpgsql security definer set search_path='' as $$
declare cid bigint; outcome text;
begin
 outcome:=case when b.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(b.email)<=120 then 'queued' else 'skipped' end;
 insert into public.booking_communications(booking_id,channel,kind,status,snapshot,recipient,event_key,error_code)
 values(b.id,'email',k,outcome,jsonb_build_object('name',b.name,'booking_date',b.booking_date,'booking_time',b.booking_time,'party_size',b.party_size),b.email,event,
 case when outcome='skipped' then 'invalid_email' end) on conflict(event_key) do nothing returning id into cid;
 if cid is not null then insert into public.booking_communication_logs(communication_id,status,error_code) values(cid,outcome,case when outcome='skipped' then 'invalid_email' end); end if;
end $$;
create or replace function private.queue_booking_lifecycle_email() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.booking_communications%rowtype;
begin
 if tg_op='INSERT' then
  if coalesce(new.status,'confirmed')='confirmed' then perform private.queue_booking_email(new,'confirmation','created:'||new.id); end if;
 elsif new.status='cancelled' and old.status is distinct from new.status then
  for c in update public.booking_communications set status='superseded' where booking_id=new.id and channel='email' and status in ('queued','failed') returning * loop
   insert into public.booking_communication_logs(communication_id,status) values(c.id,'superseded');
  end loop;
  perform private.queue_booking_email(new,'cancelled','cancelled:'||new.id||':'||gen_random_uuid());
 end if;
 return new;
end $$;
drop trigger if exists queue_booking_lifecycle_email on public.bookings;
create trigger queue_booking_lifecycle_email after insert or update on public.bookings for each row execute function private.queue_booking_lifecycle_email();
create or replace function private.queue_approved_request_email() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; c public.booking_communications%rowtype;
begin
 if old.status='pending' and new.status='approved' and new.request_type<>'cancellazione' then
  select * into b from public.bookings where id=new.booking_id;
  for c in update public.booking_communications set status='superseded' where booking_id=b.id and channel='email' and status in ('queued','failed') returning * loop
   insert into public.booking_communication_logs(communication_id,status) values(c.id,'superseded');
  end loop;
  perform private.queue_booking_email(b,'updated','request:'||new.id);
 end if;
 return new;
end $$;
drop trigger if exists queue_approved_request_email on public.booking_requests;
create trigger queue_approved_request_email after update on public.booking_requests for each row execute function private.queue_approved_request_email();

create or replace function public.admin_prepare_booking_communication(p_booking_id bigint,p_channel text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; c public.booking_communications%rowtype; k text;
begin
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'Accesso riservato allo staff' using errcode='42501'; end if;
 if p_channel not in ('email','whatsapp') or p_channel is null then raise exception 'Canale non valido'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found then raise exception 'Prenotazione non trovata'; end if;
 k:=case when b.status='cancelled' then 'cancelled' else 'confirmation' end;
 if p_channel='email' then
  if b.status not in ('confirmed','cancelled') then raise exception 'Stato non comunicabile'; end if;
  select * into c from public.booking_communications where booking_id=b.id and channel='email' and status<>'superseded' order by id desc limit 1;
  if found then return to_jsonb(c); end if;
  perform private.queue_booking_email(b,k,'manual:'||b.id||':'||k);
  select * into c from public.booking_communications where event_key='manual:'||b.id||':'||k;
 else
  if b.phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Telefono non valido'; end if;
  select kind into k from public.booking_communications where booking_id=b.id and channel='email' order by id desc limit 1;
  k:=case when b.status='cancelled' then 'cancelled' else coalesce(k,'confirmation') end;
  insert into public.booking_communications(booking_id,channel,kind,status,snapshot,recipient)
   values(b.id,'whatsapp',k,'opened',jsonb_build_object('name',b.name,'booking_date',b.booking_date,'booking_time',b.booking_time,'party_size',b.party_size),b.phone) returning * into c;
  insert into public.booking_communication_logs(communication_id,status) values(c.id,'opened');
 end if;
 return to_jsonb(c);
end $$;
-- Solo server: claim atomico, concorrenti e retry entro finestra idempotente.
create or replace function public.claim_booking_email(p_id bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.booking_communications%rowtype;
begin
 update public.booking_communications set status='sending',attempts=attempts+1,attempted_at=now(),error_code=null
 where id=p_id and channel='email' and (status='queued' or (status='failed' and created_at>now()-interval '23 hours')) returning * into c;
 if not found then return null; end if;
 insert into public.booking_communication_logs(communication_id,status) values(c.id,'sending');
 return to_jsonb(c);
end $$;
create or replace function public.finish_booking_email(p_id bigint,p_status text,p_provider_id text,p_error_code text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in ('accepted','failed','unknown') then raise exception 'Esito non valido'; end if;
 update public.booking_communications set status=p_status,provider_id=p_provider_id,error_code=p_error_code where id=p_id and status='sending';
 if not found then raise exception 'Invio non in corso'; end if;
 insert into public.booking_communication_logs(communication_id,status,provider_id,error_code) values(p_id,p_status,p_provider_id,p_error_code);
end $$;
revoke all on function private.queue_booking_email(public.bookings,text,text),private.queue_booking_lifecycle_email(),private.queue_approved_request_email() from public,anon,authenticated;
revoke all on function public.admin_prepare_booking_communication(bigint,text) from public,anon;
grant execute on function public.admin_prepare_booking_communication(bigint,text) to authenticated;
revoke all on function public.claim_booking_email(bigint),public.finish_booking_email(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_booking_email(bigint),public.finish_booking_email(bigint,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
