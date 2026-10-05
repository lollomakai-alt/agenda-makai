-- Applicare dopo booking-requests.sql. Nessun invio o backfill durante la migrazione.
-- Le operazioni comunicazioni sono solo server-side (service_role/DB owner).
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
revoke all on public.booking_communications,public.booking_communication_logs from public,anon,authenticated,service_role;
grant select,insert,update on public.booking_communications to service_role;
grant select,insert on public.booking_communication_logs to service_role;
revoke all on sequence public.booking_communications_id_seq,public.booking_communication_logs_id_seq from public,anon,authenticated;
grant usage on sequence public.booking_communications_id_seq,public.booking_communication_logs_id_seq to service_role;
drop policy if exists admin_communications_read on public.booking_communications;
drop policy if exists admin_communication_logs_read on public.booking_communication_logs;
create index if not exists booking_communications_booking_idx on public.booking_communications(booking_id,id desc);

-- Privilegio ristretto: i trigger inseriscono la coda anche per prenotazioni pubbliche.
create or replace function private.booking_email_snapshot(b public.bookings) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('name',b.name,'booking_date',b.booking_date,
   'booking_time',b.booking_time,'party_size',b.party_size,'tables',b.tables);
$$;
create or replace function private.queue_booking_email(b public.bookings,k text,event text) returns void
language plpgsql security definer set search_path='' as $$
declare cid bigint; outcome text;
begin
 outcome:=case when b.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(b.email)<=120 then 'queued' else 'skipped' end;
 insert into public.booking_communications(booking_id,channel,kind,status,snapshot,recipient,event_key,error_code)
 values(b.id,'email',k,outcome,private.booking_email_snapshot(b),b.email,event,
 case when outcome='skipped' then 'invalid_email' end) on conflict(event_key) do nothing returning id into cid;
 if cid is not null then insert into public.booking_communication_logs(communication_id,status,error_code) values(cid,outcome,case when outcome='skipped' then 'invalid_email' end); end if;
end $$;
create or replace function private.queue_booking_lifecycle_email() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.booking_communications%rowtype; k text;
begin
 if tg_op='INSERT' then
  if coalesce(new.status,'confirmed')='confirmed' then perform private.queue_booking_email(new,'confirmation','created:'||new.id); end if;
 elsif old.status is distinct from new.status
    or private.booking_email_snapshot(old) is distinct from private.booking_email_snapshot(new)
    or old.email is distinct from new.email then
  -- La prenotazione è già bloccata dall'UPDATE: prima booking, poi comunicazioni.
  -- Mantiene accepted/unknown/sending come esiti storici, senza inventare un esito.
  for c in update public.booking_communications set status='superseded',error_code='booking_changed'
      where booking_id=new.id and channel='email' and status in ('queued','failed','skipped') returning * loop
   insert into public.booking_communication_logs(communication_id,status,error_code) values(c.id,'superseded','booking_changed');
  end loop;
  if new.status in ('confirmed','cancelled') then
   k := case when new.status='cancelled' then 'cancelled'
             when old.status is distinct from new.status then 'confirmation' else 'updated' end;
   perform private.queue_booking_email(new,k,'changed:'||new.id||':'||gen_random_uuid());
  end if;
 end if;
 return new;
end $$;
drop trigger if exists queue_booking_lifecycle_email on public.bookings;
create trigger queue_booking_lifecycle_email after insert or update on public.bookings for each row execute function private.queue_booking_lifecycle_email();
-- Le approvazioni modificano bookings tramite il trigger BEFORE già esistente.
-- Un solo trigger su bookings genera updated per data/ora/persone/tavoli.
-- Conserva le notifiche per note approvate, che non fanno parte dello snapshot email.
create or replace function private.queue_approved_request_email() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; c public.booking_communications%rowtype;
begin
 if old.status='pending' and new.status='approved' and new.request_type='note' then
  select * into b from public.bookings where id=new.booking_id for update;
  for c in update public.booking_communications set status='superseded',error_code='booking_changed'
      where booking_id=b.id and channel='email' and status in ('queued','failed','skipped') returning * loop
   insert into public.booking_communication_logs(communication_id,status,error_code) values(c.id,'superseded','booking_changed');
  end loop;
  if b.status='confirmed' then perform private.queue_booking_email(b,'updated','request:'||new.id); end if;
 end if;
 return new;
end $$;
drop trigger if exists queue_approved_request_email on public.booking_requests;
create trigger queue_approved_request_email after update on public.booking_requests
 for each row execute function private.queue_approved_request_email();

create or replace function public.admin_prepare_booking_communication(p_booking_id bigint,p_channel text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; c public.booking_communications%rowtype; k text; event text;
begin
 -- EXECUTE è concesso solo a service_role: il backend verifica prima l'admin.
 if p_channel not in ('email','whatsapp') or p_channel is null then raise exception 'Canale non valido'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found then raise exception 'Prenotazione non trovata'; end if;
 if b.status is null or b.status not in ('confirmed','cancelled') then raise exception 'Stato non comunicabile'; end if;
 k:=case when b.status='cancelled' then 'cancelled' else 'confirmation' end;
 -- Bonifica solo le righe obsolete non inviate, durante la preparazione operativa.
 for c in update public.booking_communications set status='superseded',error_code='stale_booking'
     where booking_id=b.id and channel='email' and status in ('queued','failed','skipped')
       and (snapshot is distinct from private.booking_email_snapshot(b) or recipient is distinct from b.email
         or (b.status='cancelled' and kind<>'cancelled') or (b.status='confirmed' and kind='cancelled')) returning * loop
  insert into public.booking_communication_logs(communication_id,status,error_code) values(c.id,'superseded','stale_booking');
 end loop;
 if p_channel='email' then
  select * into c from public.booking_communications where booking_id=b.id and channel='email' and status<>'superseded'
    and snapshot=private.booking_email_snapshot(b) and recipient=b.email
    and ((b.status='cancelled' and kind='cancelled') or (b.status='confirmed' and kind in ('confirmation','updated')))
    order by id desc limit 1;
  if found then return to_jsonb(c); end if;
  event := 'manual:'||b.id||':'||gen_random_uuid();
  perform private.queue_booking_email(b,k,event);
  select * into c from public.booking_communications where event_key=event;
 else
  if b.phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Telefono non valido'; end if;
  select kind into k from public.booking_communications where booking_id=b.id and channel='email'
    and status<>'superseded' and snapshot=private.booking_email_snapshot(b)
    and recipient=b.email and kind in ('confirmation','updated') order by id desc limit 1;
  k:=case when b.status='cancelled' then 'cancelled' else coalesce(k,'confirmation') end;
  insert into public.booking_communications(booking_id,channel,kind,status,snapshot,recipient)
   values(b.id,'whatsapp',k,'opened',private.booking_email_snapshot(b),b.phone) returning * into c;
  insert into public.booking_communication_logs(communication_id,status) values(c.id,'opened');
 end if;
 return to_jsonb(c);
end $$;
-- Solo server: claim atomico, concorrenti e retry entro finestra idempotente.
create or replace function public.claim_booking_email(p_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.booking_communications%rowtype; b public.bookings%rowtype; bid bigint;
begin
 -- Mai bloccare una comunicazione prima della sua prenotazione: stesso ordine
 -- della preparazione e dei trigger UPDATE. Nessun nuovo advisory lock invertito.
 select booking_id into bid from public.booking_communications where id=p_id;
 if not found then return null; end if;
 select * into b from public.bookings where id=bid for update;
 if not found then return null; end if;
 select * into c from public.booking_communications where id=p_id for update;
 if not found or c.channel<>'email' or c.booking_id<>bid then return null; end if;
 if c.status not in ('queued','failed') then return null; end if;
 if b.status is null or b.status not in ('confirmed','cancelled')
    or (b.status='confirmed' and c.kind not in ('confirmation','updated'))
    or (b.status='cancelled' and c.kind<>'cancelled')
    or c.snapshot is distinct from private.booking_email_snapshot(b)
    or c.recipient is distinct from b.email
    or b.email is null or b.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(b.email)>120 then
  update public.booking_communications set status='superseded',error_code='stale_booking' where id=p_id;
  insert into public.booking_communication_logs(communication_id,status,error_code) values(p_id,'superseded','stale_booking');
  return null;
 end if;
 -- Anche due versioni diverse dello stesso booking non partono simultaneamente.
 if exists(select 1 from public.booking_communications where booking_id=bid and channel='email' and status='sending') then return null; end if;
 update public.booking_communications set status='sending',attempts=attempts+1,attempted_at=now(),error_code=null
 where id=p_id and channel='email' and (status='queued' or (status='failed' and created_at>now()-interval '23 hours')) returning * into c;
 if not found then return null; end if;
 insert into public.booking_communication_logs(communication_id,status) values(c.id,'sending');
 return to_jsonb(c);
end $$;
create or replace function public.finish_booking_email(p_id bigint,p_status text,p_provider_id text,p_error_code text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_status is null or p_status not in ('accepted','failed','unknown') then raise exception 'Esito non valido'; end if;
 update public.booking_communications set status=p_status,provider_id=p_provider_id,error_code=p_error_code where id=p_id and status='sending';
 if not found then raise exception 'Invio non in corso'; end if;
 insert into public.booking_communication_logs(communication_id,status,provider_id,error_code) values(p_id,p_status,p_provider_id,p_error_code);
end $$;
revoke all on function private.booking_email_snapshot(public.bookings),private.queue_booking_email(public.bookings,text,text),private.queue_booking_lifecycle_email(),private.queue_approved_request_email() from public,anon,authenticated,service_role;
revoke all on function public.admin_prepare_booking_communication(bigint,text) from public,anon,authenticated;
grant execute on function public.admin_prepare_booking_communication(bigint,text) to service_role;
revoke all on function public.claim_booking_email(bigint),public.finish_booking_email(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_booking_email(bigint),public.finish_booking_email(bigint,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
