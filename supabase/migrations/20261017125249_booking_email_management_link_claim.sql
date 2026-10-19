-- Applied to Production as 20261017125249 on 2026-10-17 with explicit user approval.
-- The booking-management token is safe metadata and must not stale a queued email.
-- Updating the claim function only: no backfill, retry or email send is performed here.
begin;
set local lock_timeout='5s';

do $$
begin
 if to_regprocedure('public.claim_booking_email(bigint)') is null then
  raise exception 'public.claim_booking_email(bigint) is required before this migration';
 end if;
end;
$$;

create or replace function public.claim_booking_email(p_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.booking_communications%rowtype; b public.bookings%rowtype; bid bigint;
begin
 -- Keep the existing lock order: booking first, then communication.
 select booking_id into bid from public.booking_communications where id=p_id;
 if not found then return null; end if;
 select * into b from public.bookings where id=bid for update;
 if not found then return null; end if;
 select * into c from public.booking_communications where id=p_id for update;
 if not found or c.channel<>'email' or c.booking_id<>bid then return null; end if;
 if c.status not in ('queued','failed') then return null; end if;
 if b.status is null or b.status not in ('confirmed','cancelled')
    or (b.status='confirmed' and c.kind not in ('confirmation','updated','reminder','reconfirmation','delay','alternative'))
    or (b.status='cancelled' and c.kind<>'cancelled')
    or (c.snapshot - array['management_url','proposal']) is distinct from private.booking_email_snapshot(b)
    or c.recipient is distinct from b.email
    or b.email is null or b.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(b.email)>120 then
  update public.booking_communications set status='superseded',error_code='stale_booking' where id=p_id;
  insert into public.booking_communication_logs(communication_id,status,error_code) values(p_id,'superseded','stale_booking');
  return null;
 end if;
 -- Do not send two versions of the same booking concurrently.
 if exists(select 1 from public.booking_communications where booking_id=bid and channel='email' and status='sending') then return null; end if;
 update public.booking_communications set status='sending',attempts=attempts+1,attempted_at=now(),error_code=null
 where id=p_id and channel='email' and (status='queued' or (status='failed' and created_at>now()-interval '23 hours')) returning * into c;
 if not found then return null; end if;
 insert into public.booking_communication_logs(communication_id,status) values(c.id,'sending');
 return to_jsonb(c);
end;
$$;

revoke all on function public.claim_booking_email(bigint) from public,anon,authenticated;
grant execute on function public.claim_booking_email(bigint) to service_role;
notify pgrst,'reload schema';
commit;
