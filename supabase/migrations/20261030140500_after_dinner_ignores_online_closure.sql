-- Il dopocena ignora la chiusura online: resta una richiesta da confermare.
-- La chiusura del locale (lunedi) continua a valere per entrambi i servizi.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

CREATE OR REPLACE FUNCTION private.online_slot_status(day text, slot text, people integer, service text, exclude_id bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare booked bigint;
begin
  if people not between 1 and 6 or private.service_slot_at(day,slot,service) is null then return 'unverified'; end if;
  if (service='normale' and exists(select 1 from public.online_booking_closures where booking_date=day::date))
     or extract(isodow from day::date)=1 then return 'closed'; end if;
  if day::date>(now() at time zone 'Europe/Rome')::date+60
     or private.service_slot_at(day,slot,service)<now()+interval '30 minutes' then return 'past'; end if;
  if service='dopocena' then return 'manual_review'; end if;
  select coalesce(sum(party_size),0) into booked from public.bookings b
    where b.booking_date=day and coalesce(b.booking_type,'normale')=service
      and b.status not in ('cancelled','no_show') and (exclude_id is null or b.id<>exclude_id);
  if booked+people>private.dinner_physical_capacity() then return 'full'; end if;
  if service='normale' and private.choose_online_dinner_unit(day,people,exclude_id) is null then return 'full'; end if;
  return 'available';
end $function$;

commit;
