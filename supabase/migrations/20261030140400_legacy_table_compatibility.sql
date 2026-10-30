-- Compatibilita' tavoli per prenotazioni storiche a orari non piu' vendibili.
-- I nuovi booking restano limitati a 19:00, 21:30 e 23:00 da valid_service_slot.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

CREATE OR REPLACE FUNCTION private.compatible_service_slot_at(day text, slot text, service text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare d date;
begin
  if day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
     not pg_input_is_valid(day,'date') then return null; end if;
  d:=day::date;
  -- Orari storici accettati per compatibilita' con prenotazioni gia' esistenti.
  if service='normale' and slot ~ '^(19:(00|30)|20:(00|30)|21:(00|30)|22:(00|30))$' then
    return (d::text||' '||slot)::timestamp at time zone 'Europe/Rome';
  end if;
  if service='dopocena' and slot ~ '^(22:30|23:(00|30)|00:00)$' then
    return ((d+case when slot='00:00' then 1 else 0 end)::text||' '||slot)::timestamp at time zone 'Europe/Rome';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.dinner_after_dinner_compatible(first_day text, first_time text, first_type text, second_day text, second_time text, second_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(first_day=second_day and
    ((first_type='normale' and second_type='dopocena' and
      private.compatible_service_slot_at(second_day,second_time,second_type)-private.compatible_service_slot_at(first_day,first_time,first_type)>=interval '120 minutes')
    or (second_type='normale' and first_type='dopocena' and
      private.compatible_service_slot_at(first_day,first_time,first_type)-private.compatible_service_slot_at(second_day,second_time,second_type)>=interval '120 minutes')),false)
$function$;

CREATE OR REPLACE FUNCTION private.service_capacity_for_type(day text, reference_time text, service_type text, exclude_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare people bigint; physical integer; total integer; unused integer;
begin
  total:=case when service_type='normale' then private.dinner_physical_capacity() else null end;
  if private.compatible_service_slot_at(day,reference_time,service_type) is null then
    return jsonb_build_object('total',total,'remaining',0,'verified',false);
  end if;
  select coalesce(sum(party_size),0) into people from public.bookings b
    where b.booking_date=day and coalesce(b.booking_type,'normale')=service_type
      and b.status not in ('cancelled','no_show') and (exclude_id is null or b.id<>exclude_id);
  select coalesce(sum(g.capacity),0)::integer into physical
    from public.bookings b cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) grp
    join private.online_table_groups() g on g.group_id=grp
    where b.booking_date=day and b.status not in ('cancelled','no_show')
      and (exclude_id is null or b.id<>exclude_id) and b.booking_type='normale';
  select coalesce(sum(greatest(0,unit.capacity-b.party_size)),0)::integer into unused
    from public.bookings b cross join lateral (
      select sum(g.capacity)::integer capacity
      from unnest(string_to_array(coalesce(b.tables,''),',')) grp
      join private.online_table_groups() g on g.group_id=grp
    ) unit
    where b.booking_date=day and b.status not in ('cancelled','no_show')
      and (exclude_id is null or b.id<>exclude_id) and b.booking_type='normale'
      and coalesce(b.tables,'')<>'';
  return jsonb_build_object('total',total,'occupied',case when service_type='normale' then physical else people end,
    'unused',case when service_type='normale' then unused else 0 end,
    'people_reserved',people,'people_remaining',case when service_type='normale' then greatest(0,private.dinner_physical_capacity()-people) else null end,
    'physical_occupied_units',physical,'physical_remaining',case when service_type='normale' then greatest(0,total-physical) else null end,
    'remaining',case when service_type='normale' then least(greatest(0,private.dinner_physical_capacity()-people),greatest(0,total-physical)) else null end,
    'verified',true);
end $function$;

commit;
