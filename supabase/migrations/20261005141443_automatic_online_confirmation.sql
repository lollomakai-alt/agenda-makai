-- Solo conferme iniziali delle prenotazioni dal sito. Nessun invio/backfill SQL.
begin;
set local lock_timeout='5s';
create or replace function public.claim_new_online_booking_email(p_booking_id bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare bid bigint; cid bigint;
begin
 -- Stesso ordine di lock del percorso manuale: prima booking, poi comunicazione.
 select id into bid from public.bookings
 where id=p_booking_id and source='booking' and status='confirmed' for update;
 if not found then return null; end if;
 select id into cid from public.booking_communications
 where booking_id=bid and channel='email' and kind='confirmation'
   and event_key='created:'||bid and status='queued' and attempts=0;
 if not found then return null; end if;
 -- Il claim esistente ricontrolla email, snapshot e invii concorrenti.
 -- Lo stato queued/attempts=0 viene verificato sotto lock: nessun retry automatico.
 return public.claim_booking_email(cid);
end $$;
revoke all on function public.claim_new_online_booking_email(bigint) from public,anon,authenticated;
grant execute on function public.claim_new_online_booking_email(bigint) to service_role;
notify pgrst,'reload schema';
commit;
