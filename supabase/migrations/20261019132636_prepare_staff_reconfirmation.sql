-- Add the missing staff email preparation without replaying the historical full schema.
-- Manual requests may be repeated; the scheduled day-before request is unique per booking/day.
begin;
set local lock_timeout='5s';

do $$ begin
  if to_regprocedure('private.prepare_staff_email(bigint,text,text,text)') is not null then
    raise exception 'Legacy staff email function must be reviewed before this migration';
  end if;
  if to_regprocedure('private.booking_email_snapshot(public.bookings)') is null
     or to_regprocedure('private.booking_scheduled_at(text,text)') is null then
    raise exception 'Staff email prerequisites are missing';
  end if;
end $$;

create or replace function private.prepare_staff_email(booking_id bigint, template_kind text, management_url text, proposal text default '', request_source text default 'manual')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.bookings%rowtype; c public.booking_communications%rowtype; snapshot jsonb; event text; outcome text; stale_id bigint;
begin
 perform pg_advisory_xact_lock(734512);
 select * into b from public.bookings bookings where id=booking_id for update;
 if b.id is null or template_kind not in ('reminder','reconfirmation','delay','alternative','cancelled') then raise exception 'Comunicazione non disponibile' using errcode='22023'; end if;
 if request_source not in ('manual','scheduled') or (request_source='scheduled' and template_kind<>'reconfirmation') then raise exception 'Origine comunicazione non valida' using errcode='22023'; end if;
 if (template_kind='cancelled' and b.status<>'cancelled') or (template_kind<>'cancelled' and b.status<>'confirmed') then raise exception 'Stato non valido per la comunicazione' using errcode='22023'; end if;
 if template_kind in ('reminder','reconfirmation','alternative') and private.booking_scheduled_at(b.booking_date,b.booking_time)<=now() then raise exception 'Prenotazione già iniziata' using errcode='22023'; end if;
 if template_kind='reminder' and b.booking_date<>to_char((now() at time zone 'Europe/Rome')::date+1,'YYYY-MM-DD') then raise exception 'Reminder previsto il giorno precedente' using errcode='22023'; end if;
 if request_source='scheduled' and (b.booking_date<>to_char((now() at time zone 'Europe/Rome')::date+1,'YYYY-MM-DD') or b.reconfirmation_status='reconfirmed') then raise exception 'Riconferma automatica non prevista' using errcode='22023'; end if;
 if template_kind='delay' and now()<private.booking_scheduled_at(b.booking_date,b.booking_time)+interval '15 minutes' then raise exception 'Ritardo non ancora verificato' using errcode='22023'; end if;
 if template_kind='alternative' and length(btrim(proposal)) not between 1 and 300 then raise exception 'Proposta obbligatoria' using errcode='22023'; end if;
 snapshot:=private.booking_email_snapshot(b)||jsonb_build_object('management_url',management_url);
 if template_kind='alternative' then snapshot:=snapshot||jsonb_build_object('proposal',proposal);end if;
 event:=case when request_source='scheduled' then 'scheduled:reconfirmation:'||b.booking_date||':'||b.id
   else 'manual:'||template_kind||':'||b.id||':'||md5((snapshot-'management_url')::text) end;
 select * into c from public.booking_communications where event_key=event;
 if found then return to_jsonb(c); end if;
 if request_source='manual' and template_kind='reconfirmation' then event:=event||':'||gen_random_uuid()::text; end if;
 if template_kind='reconfirmation' then
  for stale_id in update public.booking_communications as queued set status='superseded',error_code='stale_management_link'
    where queued.booking_id=b.id and queued.channel='email' and queued.kind='reconfirmation' and queued.status in ('queued','failed') returning queued.id loop
   insert into public.booking_communication_logs(communication_id,status,error_code) values(stale_id,'superseded','stale_management_link');
  end loop;
 end if;
 outcome:=case when coalesce(b.email,'') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'queued' else 'skipped' end;
 insert into public.booking_communications(booking_id,channel,kind,status,snapshot,recipient,event_key,error_code)
 values(b.id,'email',template_kind,outcome,snapshot,coalesce(b.email,''),event,case when outcome='skipped' then 'invalid_email' end) returning * into c;
 insert into public.booking_communication_logs(communication_id,status,error_code) values(c.id,c.status,c.error_code);
 if template_kind in ('reminder','reconfirmation') then update public.bookings set reconfirmation_status=case when reconfirmation_status='reconfirmed' then 'reconfirmed' else 'pending' end where id=b.id;end if;
 return to_jsonb(c);
end; $$;
revoke all on function private.prepare_staff_email(bigint,text,text,text,text) from public,anon,authenticated;
grant execute on function private.prepare_staff_email(bigint,text,text,text,text) to service_role;
commit;
