-- Apply LAST, after the existing documented scripts including dinner-after-dinner-turnover.sql.
-- LOCAL PREPARATION ONLY. No backfill, booking deletion, email, cron or live writes.
begin;
set local lock_timeout='5s';
alter table public.booking_history add column if not exists actor_id uuid;
alter table public.bookings add column if not exists table_released_at timestamptz;
alter table public.bookings add column if not exists operational_frozen boolean not null default false;
alter table public.bookings add column if not exists reconfirmation_status text not null default 'not_requested'
  check (reconfirmation_status in ('not_requested','pending','reconfirmed'));
alter table public.bookings add column if not exists reconfirmed_at timestamptz;
-- The live legacy trigger still enforces a combined 25-cover daily limit for
-- online bookings. It conflicts with independent CENA/DOPOCENA capacity.
drop trigger if exists y_enforce_daily_booking_capacity_25 on public.bookings;
-- Preserve historical bookings: ownership never authorizes physical deletion.
drop policy if exists booking_owner_delete on public.bookings;
revoke delete on public.bookings from public, anon, authenticated;

create or replace function private.booking_scheduled_at(day text, booking_time text)
returns timestamptz language plpgsql stable security invoker set search_path='' as $$
begin
  if day !~ '^\d{4}-\d{2}-\d{2}$' or booking_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then return null; end if;
  return ((day::date + case when booking_time::time < time '06:00' then 1 else 0 end)::text || ' ' || booking_time)::timestamp at time zone 'Europe/Rome';
exception when invalid_datetime_format or datetime_field_overflow then return null;
end; $$;
create or replace function private.operational_day(at_time timestamptz default now())
returns text language sql stable security invoker set search_path='' as $$
  select to_char(case when (at_time at time zone 'Europe/Rome')::time <
    case when extract(isodow from (at_time at time zone 'Europe/Rome')::date-1)=6 then time '02:00' else time '01:00' end
    then (at_time at time zone 'Europe/Rome')::date-1 else (at_time at time zone 'Europe/Rome')::date end,'YYYY-MM-DD');
$$;
create or replace function private.valid_service_slot(service text, slot text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(case service when 'normale' then slot ~ '^(19|20|21|22):(00|30)(:00)?$'
 when 'dopocena' then slot ~ '^(22:(3[0-9]|[4-5][0-9])|23:[0-5][0-9]|00:00)(:00)?$' else false end,false);
$$;
create or replace function private.dinner_after_dinner_compatible(first_day text, first_time text, first_type text, second_day text, second_time text, second_type text)
returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(first_day=second_day and private.valid_service_slot(first_type,first_time) and private.valid_service_slot(second_type,second_time) and
 case when first_type='normale' and second_type='dopocena' then private.booking_scheduled_at(second_day,second_time)-private.booking_scheduled_at(first_day,first_time)>=interval '120 minutes'
 when second_type='normale' and first_type='dopocena' then private.booking_scheduled_at(first_day,first_time)-private.booking_scheduled_at(second_day,second_time)>=interval '120 minutes' else false end,false);
$$;
-- Align the live legacy catalog to the confirmed physical units. This is the
-- source for both the automatic planner and manual physical validation.
create or replace function private.online_table_groups()
returns table(group_id text, capacity integer) language sql immutable security invoker set search_path='' as $$
 values ('10+11',3),('12',2),('13+14',3),('15+16+17',6),('15+16',4),('17',2),
        ('18+19',4),('18',2),('19',2),('20+21',4),('22+23',4),('22',2),('23',2);
$$;
create or replace function private.online_table_candidates(people integer)
returns table(group_id text, capacity integer, preference integer) language sql stable security invoker set search_path='' as $$
 select g.group_id,g.capacity,0 as preference from private.online_table_groups() g where g.capacity = case
 when people in (1,2) then 2 when people=3 then g.capacity when people=4 then 4 when people in (5,6) then 6 else -1 end
 and (people<>3 or g.capacity in (3,4)) order by g.capacity-people,g.group_id;
$$;
-- Maximum simultaneous CENA covers from the physical catalog, counting one
-- complete configuration of 15-19 and one arrangement of 22/23.
create or replace function private.dinner_physical_capacity()
returns integer language sql stable security invoker set search_path='' as $$
 select (select sum(capacity)::int from private.online_table_groups()
         where group_id in ('10+11','12','13+14','20+21','22','23'))
   + greatest(
       (select sum(capacity)::int from private.online_table_groups() where group_id in ('15+16+17','18+19')),
       (select sum(capacity)::int from private.online_table_groups() where group_id in ('15+16','17','18+19')),
       (select sum(capacity)::int from private.online_table_groups() where group_id in ('15+16','17','18','19'))
     );
$$;
create or replace function private.physical_ids(groups text)
returns text[] language sql immutable security invoker set search_path='' as $$
 select coalesce(array_agg(btrim(id)) filter(where btrim(id)<>''),array[]::text[]) from unnest(string_to_array(coalesce(groups,''),',')) g
 cross join lateral unnest(string_to_array(g,'+')) id;
$$;
-- Every candidate checks complete units and the three allowed 15-19 configurations.
create or replace function private.assignment_fits(candidate jsonb, assigned jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare other jsonb; groups text[]:=string_to_array(candidate->>'tables',','); ids text[]:=private.physical_ids(candidate->>'tables'); cap integer; n integer;
begin
 select count(*),sum(g.capacity) into n,cap from unnest(groups) t join private.online_table_groups() g on g.group_id=t;
 if n<>cardinality(groups) or cap<(candidate->>'party_size')::int or cardinality(ids)<>(select count(distinct t) from unnest(ids) t) then return false; end if;
 for other in select value from jsonb_array_elements(assigned) loop
  if ids && private.physical_ids(other->>'tables') and not private.dinner_after_dinner_compatible(candidate->>'booking_date',candidate->>'booking_time',candidate->>'booking_type',other->>'booking_date',other->>'booking_time',other->>'booking_type') then return false; end if;
  if other->>'booking_type'=candidate->>'booking_type' then groups:=groups||string_to_array(other->>'tables',','); end if;
 end loop;
 return private.online_groups_compatible(groups);
end; $$;
-- Branch-and-bound: minimize wasted seats, then number of moved bookings.
-- Existing assignments win exact ties, avoiding map churn. Manual assignments stay fixed.
create or replace function private.search_dinner_plan(pending jsonb, assigned jsonb, plan jsonb default '{}'::jsonb, score integer default 0, ceiling integer default 2147483647)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare row_data jsonb; option record; candidate jsonb; result jsonb; best jsonb; next_score integer;
begin
 if score>=ceiling then return null; end if;
 if jsonb_array_length(pending)=0 then return jsonb_build_object('assignments',plan,'score',score); end if;
 row_data:=pending->0;
 for option in select g.* from private.online_table_groups() g where
  (row_data->>'source'='agenda' and g.capacity >= (row_data->>'party_size')::int)
  or exists(select 1 from private.online_table_candidates((row_data->>'party_size')::int) c where c.group_id=g.group_id)
 order by capacity-(row_data->>'party_size')::int, (group_id is distinct from row_data->>'tables'),group_id loop
  candidate:=row_data||jsonb_build_object('tables',option.group_id);
  if not private.assignment_fits(candidate,assigned) then continue; end if;
  next_score:=score+(option.capacity-(row_data->>'party_size')::int)*100+case when coalesce(row_data->>'tables','')<>'' and row_data->>'tables'<>option.group_id then 1 else 0 end;
  result:=private.search_dinner_plan(pending-0,assigned||jsonb_build_array(candidate),plan||jsonb_build_object(row_data->>'id',option.group_id),next_score,ceiling);
  if result is not null then best:=result; ceiling:=(result->>'score')::int; end if;
 end loop;
 return best;
end; $$;
create or replace function private.dinner_plan(day text, incoming jsonb default null, exclude_id bigint default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare b record; row_data jsonb; fixed jsonb:='[]'; pending jsonb:='[]'; candidate jsonb; result jsonb;
begin
 for b in select * from public.bookings where booking_date=day and status not in ('cancelled','no_show') and (exclude_id is null or id<>exclude_id) order by id loop
  if b.table_released_at is not null and coalesce(b.tables,'')='' then continue; end if;
  row_data:=to_jsonb(b);
  -- Only future, unfrozen online CENA assignments may be optimized. Manual,
  -- arrived and frozen assignments stay fixed; old unassigned rows stay as-is.
  if coalesce(b.tables,'')<>'' then
   if b.booking_type='normale' and b.source='booking' and b.status='confirmed'
      and not b.operational_frozen and private.booking_scheduled_at(b.booking_date,b.booking_time)>now()
   then pending:=pending||jsonb_build_array(row_data);
   else fixed:=fixed||jsonb_build_array(row_data); end if;
  end if;
 end loop;
 if incoming is not null then
  if incoming->>'booking_type'='dopocena' then
   if coalesce(incoming->>'tables','')<>'' then fixed:=fixed||jsonb_build_array(incoming); end if;
  elsif coalesce(incoming->>'tables','')<>'' and (incoming->>'source'<>'booking' or incoming->>'status'<>'confirmed' or coalesce((incoming->>'operational_frozen')::boolean,false)) then fixed:=fixed||jsonb_build_array(incoming);
  else pending:=pending||jsonb_build_array(incoming); end if;
 end if;
 select coalesce(jsonb_agg(value order by (value->>'party_size')::int desc,value->>'id'),'[]') into pending from jsonb_array_elements(pending);
 if jsonb_array_length(pending)>12 then return null; end if;
 result:=private.search_dinner_plan(pending,fixed);
 return result;
end; $$;
create or replace function private.online_slot_status(day text, slot text, people integer, service text, exclude_id bigint default null)
returns text language plpgsql volatile security definer set search_path='' as $$
declare covers bigint;
begin
 if people not between 1 and 6 or not private.valid_service_slot(service,slot) or private.booking_scheduled_at(day,slot) is null then return 'unverified'; end if;
 if exists(select 1 from public.online_booking_closures where booking_date=day::date) then return 'closed'; end if;
 if extract(isodow from day::date)=1 then return 'closed'; end if;
 if day::date>(now() at time zone 'Europe/Rome')::date+60 or private.booking_scheduled_at(day,slot)<now()+interval '30 minutes' then return 'past'; end if;
 if service='dopocena' then
  select coalesce(sum(party_size),0) into covers from public.bookings where booking_date=day and booking_type='dopocena' and status not in ('cancelled','no_show') and (exclude_id is null or id<>exclude_id);
  return case when covers+people<=25 then 'available' else 'full' end;
 end if;
 select coalesce(sum(party_size),0) into covers from public.bookings
   where booking_date=day and coalesce(booking_type,'normale')='normale'
     and status not in ('cancelled','no_show') and (exclude_id is null or id<>exclude_id);
 if covers+people>25 then return 'full'; end if;
 return case when private.dinner_plan(day,jsonb_build_object('id',coalesce(exclude_id,0),'booking_date',day,'booking_time',slot,'party_size',people,'booking_type','normale','source','booking','status','confirmed','tables',''),exclude_id) is not null then 'available' else 'full' end;
end; $$;
create or replace function private.online_day_status(day text, people integer, exclude_id bigint default null)
returns text language plpgsql stable security invoker set search_path='' as $$
declare slot text; result text;
begin
 if people=0 then return case when private.dinner_plan(day,null,exclude_id) is not null then 'available' else 'full' end; end if;
 foreach slot in array array['19:00','19:30','20:00','20:30','21:00','21:30','22:00','22:30'] loop
  result:=private.online_slot_status(day,slot,people,'normale',exclude_id);
  if result in ('available','closed') then return result; end if;
 end loop;
 return 'full';
end; $$;
-- Atomic bulk move. Internal intermediate states never escape the transaction.
create or replace function private.apply_dinner_plan(day text, plan jsonb, excluded bigint default null)
returns void language plpgsql security definer set search_path='' as $$
declare entry record; prior_guard text:=coalesce(current_setting('makai.rebalancing',true),'');
begin
 perform pg_advisory_xact_lock(734512);
 perform set_config('makai.rebalancing','on',true);
 -- Clear changed units first, then install the verified final plan.
 update public.bookings b set tables='' where b.booking_date=day and b.source='booking' and b.status='confirmed' and not b.operational_frozen
 and private.booking_scheduled_at(b.booking_date,b.booking_time)>now() and (excluded is null or b.id<>excluded)
 and (plan->'assignments') ? b.id::text and b.tables is distinct from plan->'assignments'->>b.id::text;
 for entry in select key,value from jsonb_each_text(plan->'assignments') loop
  update public.bookings b set tables=entry.value where b.id=entry.key::bigint and b.source='booking' and b.status='confirmed' and not b.operational_frozen
  and private.booking_scheduled_at(b.booking_date,b.booking_time)>now() and (excluded is null or b.id<>excluded) and b.tables is distinct from entry.value;
 end loop;
 -- Keep unsent snapshots aligned without queuing an operational notification.
 update public.booking_communications c set snapshot=jsonb_set(c.snapshot,'{tables}',to_jsonb(b.tables))
 from public.bookings b where b.id=c.booking_id and (plan->'assignments') ? b.id::text and b.booking_date=day
 and c.status='queued' and c.attempts=0 and c.kind in ('confirmation','updated','reminder','reconfirmation');
 perform set_config('makai.rebalancing',prior_guard,true);
end; $$;
create or replace function private.prepare_booking()
returns trigger language plpgsql security definer set search_path='' as $$
declare administrator boolean:=coalesce(auth.jwt()->'app_metadata'->>'role'='admin',false); covers bigint; plan jsonb; dt timestamptz; availability_change boolean;
begin
 perform pg_advisory_xact_lock(734512);
 if current_setting('makai.rebalancing',true)='on' then new.updated_at:=now();return new; end if;
 if new.source='staff' then new.source:='agenda'; end if;
 if new.source='ai' then new.source:='booking'; end if;
 if current_setting('role',true)='authenticated' and not administrator then
  if tg_op<>'INSERT' or new.source<>'booking' or new.user_id is distinct from auth.uid() then raise exception 'Modifiche cliente soltanto tramite link sicuro' using errcode='42501'; end if;
  new.status:='confirmed'; new.tables:=''; new.operational_frozen:=false; new.reconfirmation_status:='not_requested';new.reconfirmed_at:=null;new.table_released_at:=null;
  new.consenso_ricordami:=false;new.consenso_data:=null;new.arrived_at:=null;new.marketing_visit_counted_at:=null;
 end if;
 if tg_op='UPDATE' and new.status='cancelled' and old.status in ('arrived','completed') and coalesce(old.tables,'')<>'' then
  raise exception 'Tavolo ancora occupato: liberarlo esplicitamente prima della cancellazione' using errcode='22023';
 end if;
 if tg_op='UPDATE' and old.status='arrived' and new.status='confirmed' then new.arrived_at:=null; end if;
 -- New service rules apply only to an automatic online INSERT. Existing
 -- rows and staff edits are grandfathered and never normalized on UPDATE.
 availability_change:=tg_op='INSERT' and new.source='booking';
 if availability_change and new.status not in ('cancelled','no_show') then
  if new.party_size not between 1 and 6 or new.party_size is null or not private.valid_service_slot(new.booking_type,new.booking_time) or private.booking_scheduled_at(new.booking_date,new.booking_time) is null then raise exception 'Data, orario o persone non validi' using errcode='22023'; end if;
  if new.booking_date::date < private.operational_day()::date or new.booking_date::date>(now() at time zone 'Europe/Rome')::date+60 or extract(isodow from new.booking_date::date)=1 then raise exception 'Data non disponibile' using errcode='22023'; end if;
  if new.booking_type='dopocena' then
   select coalesce(sum(party_size),0) into covers from public.bookings where id<>new.id and booking_date=new.booking_date and booking_type='dopocena' and status not in ('cancelled','no_show');
   if covers+new.party_size>25 then raise exception 'Limite DOPOCENA di 25 persone raggiunto' using errcode='P0001'; end if;
   if tg_op='INSERT' then new.tables:=''; end if;
  end if;
 end if;
 if tg_op='UPDATE' and coalesce(old.tables,'')<>'' and coalesce(new.tables,'')='' then new.table_released_at:=now(); end if;
 if coalesce(new.tables,'')<>'' then new.table_released_at:=null; end if;
 if new.source='booking' and availability_change and new.status='confirmed' then
  if tg_op='INSERT' then
   if new.privacy_accepted_at is null or new.privacy_version is distinct from '2026-10-12-online-v2' then raise exception 'Informativa privacy obbligatoria' using errcode='22023'; end if;
   new.status:='confirmed';new.tables:='';new.reminder_status:='skipped';new.reminder_attempts:=0;new.created_at:=now();
   new.consenso_ricordami:=false;new.consenso_data:=null;
  end if;
  if new.name is null or length(btrim(new.name)) not between 2 and 60 or new.phone is null or new.phone !~ '^\+[1-9][0-9]{7,14}$' or length(coalesce(new.notes,''))>300 or length(coalesce(new.email,''))>120 or (coalesce(new.email,'')<>'' and new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Contatti non validi' using errcode='22023'; end if;
  if (select count(*) from public.bookings b where b.id<>new.id and b.status in ('confirmed','arrived') and regexp_replace(b.phone,'[^0-9]','','g')=regexp_replace(new.phone,'[^0-9]','','g') and private.booking_scheduled_at(b.booking_date,b.booking_time)>now())>=2 then raise exception 'Limite prenotazioni per telefono raggiunto' using errcode='P0001'; end if;
  if private.online_slot_status(new.booking_date,new.booking_time,new.party_size,new.booking_type,new.id)<>'available' then raise exception 'Disponibilità cambiata' using errcode='P0001'; end if;
  if new.booking_type='normale' then
   plan:=private.dinner_plan(new.booking_date,to_jsonb(new)||jsonb_build_object('tables',''),new.id);
   if plan is null then raise exception 'Tavolo non disponibile' using errcode='P0001'; end if;
   -- Move eligible existing online assignments before the new row's conflict
   -- trigger runs. The advisory lock and INSERT transaction make this atomic.
   perform private.apply_dinner_plan(new.booking_date,plan,new.id);
   new.tables:=plan->'assignments'->>new.id::text;
  end if;
 end if;
 if new.status='arrived' and (tg_op='INSERT' or old.status is distinct from new.status) then
  dt:=private.booking_scheduled_at(new.booking_date,new.booking_time);
  if new.booking_type='dopocena' and (dt is null or now()<dt) then raise exception 'Arrivo DOPOCENA consentito soltanto dall’orario prenotato' using errcode='22023'; end if;
  new.arrived_at:=coalesce(new.arrived_at,now());
  if exists(select 1 from public.bookings b where b.id<>new.id and b.booking_date=new.booking_date and b.status in ('arrived','completed') and coalesce(b.tables,'')<>'' and private.physical_ids(b.tables)&&private.physical_ids(new.tables)) then raise exception 'Tavolo ancora occupato: liberarlo esplicitamente prima dell’arrivo' using errcode='23505'; end if;
 end if;
 if tg_op='UPDATE' and administrator and not availability_change and new.tables is distinct from old.tables and coalesce(new.tables,'')<>'' then new.operational_frozen:=true; end if;
 new.updated_at:=now();return new;
end; $$;
-- Final conflict check; no ADMIN exception for arbitrary physical configurations.
create or replace function private.check_daily_table_conflicts()
returns trigger language plpgsql security definer set search_path='' as $$
declare others jsonb;
begin
 if current_setting('makai.rebalancing',true)='on'
   or new.status in ('cancelled','no_show') or coalesce(new.tables,'')=''
   or (tg_op='UPDATE' and new.tables is not distinct from old.tables) then return new; end if;
 select coalesce(jsonb_agg(to_jsonb(b)),'[]') into others from public.bookings b where b.id<>new.id and b.booking_date=new.booking_date and b.status not in ('cancelled','no_show') and coalesce(b.tables,'')<>'';
 -- Staff may exceed recommended seats; the same physical/catalog checks apply.
 if not private.assignment_fits(to_jsonb(new)||case when new.source='agenda' or current_setting('makai.manual_admin_edit',true)='on'
   then jsonb_build_object('party_size',1) else '{}'::jsonb end,others) then
  raise exception 'Tavolo già assegnato o configurazione fisica non valida' using errcode='23505'; end if;
 return new;
end; $$;
create or replace function private.protect_pending_online_bookings()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('makai.rebalancing',true)='on' or current_setting('makai.manual_admin_edit',true)='on'
   or tg_op='UPDATE' or new.source<>'booking' or new.status in ('cancelled','no_show') then return new; end if;
 if private.dinner_plan(new.booking_date) is null then raise exception 'Capienza CENA o configurazione non disponibile' using errcode='P0001'; end if;
 return new;
end; $$;
create or replace function private.rebalance_booking_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare plan jsonb; target record; old_group text; group_data record; others jsonb; chosen bigint; prior_guard text;
begin
 if current_setting('makai.rebalancing',true)='on' then return new; end if;
 perform pg_advisory_xact_lock(734512);
 if current_setting('makai.manual_admin_edit',true)='on'
   and coalesce(current_setting('makai.explicit_table_release',true),'')<>'on' then return new; end if;
 -- Manual updates never optimize or move bookings. An explicit release may
 -- still hand the freed table to a compatible DOPOCENA booking below.
 if tg_op='UPDATE' and not (coalesce(old.tables,'')<>'' and coalesce(new.tables,'')='' and old.booking_date=new.booking_date) then return new; end if;
 if tg_op='INSERT' and new.source<>'booking' then return new; end if;
 -- Only explicitly cleared assignments (or cancelled/no-show) produce a handoff.
 if tg_op='UPDATE' and coalesce(old.tables,'')<>'' and (coalesce(new.tables,'')='' or (new.status in ('cancelled','no_show') and old.status not in ('cancelled','no_show'))) and old.booking_date=new.booking_date then
  for group_data in select g.* from unnest(string_to_array(old.tables,',')) t join private.online_table_groups() g on g.group_id=t order by g.capacity,g.group_id loop
   select coalesce(jsonb_agg(to_jsonb(b)),'[]') into others from public.bookings b where b.booking_date=new.booking_date and b.status not in ('cancelled','no_show') and coalesce(b.tables,'')<>'';
   chosen:=null;
   for target in select * from public.bookings b where booking_date=new.booking_date and booking_type='dopocena' and status in ('confirmed','arrived') and coalesce(tables,'')='' and exists(select 1 from private.online_table_candidates(b.party_size) c where c.group_id=group_data.group_id)
    order by group_data.capacity-party_size,private.booking_scheduled_at(booking_date,booking_time),id loop
    if private.assignment_fits(to_jsonb(target)||jsonb_build_object('tables',group_data.group_id),others) then chosen:=target.id;exit; end if;
   end loop;
   if chosen is not null then
    prior_guard:=coalesce(current_setting('makai.rebalancing',true),'');perform set_config('makai.rebalancing','on',true);
    update public.bookings set tables=group_data.group_id where id=chosen;
    perform set_config('makai.rebalancing',prior_guard,true);
    insert into public.booking_history(booking_id,action,old_data,new_data) values(chosen,'table_assigned',jsonb_build_object('tables',''),jsonb_build_object('tables',group_data.group_id));
   end if;
  end loop;
 end if;
 return new;
end; $$;
drop trigger if exists zzz_rebalance_booking_event on public.bookings;
create trigger zzz_rebalance_booking_event after insert or update on public.bookings for each row execute function private.rebalance_booking_event();
create or replace function public.admin_release_booking_table(booking_id bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.bookings%rowtype;
begin
 if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'Accesso riservato allo staff' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734512);
 update public.bookings b set status='completed',tables='' where b.id=booking_id and b.status in ('arrived','completed') returning * into saved;
 if not found then raise exception 'Prenotazione cambiata o non accessibile' using errcode='40001'; end if;
 return jsonb_build_object('booking_id',saved.id,'status',saved.status,'tables',saved.tables,'history_error',null);
end; $$;
-- Capacity CENA is derived from real units; DOPOCENA consumes people out of 25.
create or replace function private.service_capacity_for_type(day text, reference_time text, service_type text, exclude_id bigint default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare total integer; occupied bigint:=0; people_reserved bigint:=0; waste bigint:=0;
 cost integer; b record; groups text[]:=array[]::text[]; physical text[]:=array[]::text[];
 selected text[]; ids text[]; group_count integer;
begin
 if service_type not in ('normale','dopocena') then
  return jsonb_build_object('verified',false,'remaining',0);
 end if;
 total:=case when service_type='dopocena' then 25 else private.dinner_physical_capacity() end;
 for b in select * from public.bookings where booking_date=day and coalesce(booking_type,'normale')=service_type
   and status not in ('cancelled','no_show') and (exclude_id is null or id<>exclude_id) loop
  if b.party_size is null or b.party_size<1 then
   return jsonb_build_object('total',total,'remaining',0,'verified',false);
  end if;
  people_reserved:=people_reserved+b.party_size;
  if service_type='dopocena' then continue; end if;
  if coalesce(b.tables,'')='' then
   cost:=case when b.status='completed' or b.table_released_at is not null then 0 else b.party_size end;
  else
   selected:=string_to_array(b.tables,',');
   ids:=private.physical_ids(b.tables);
   select count(*),sum(g.capacity)::int into group_count,cost
     from unnest(selected) t join private.online_table_groups() g on g.group_id=t;
   if group_count<>cardinality(selected) or cardinality(ids)<>(select count(distinct id) from unnest(ids) id)
      or ids && physical then
    return jsonb_build_object('total',total,'remaining',0,'verified',false);
   end if;
   groups:=groups||selected; physical:=physical||ids;
   waste:=waste+greatest(0,cost-b.party_size);
  end if;
  occupied:=occupied+cost;
 end loop;
 if service_type='normale' and not private.online_groups_compatible(groups) then
  return jsonb_build_object('total',total,'remaining',0,'verified',false);
 end if;
 if service_type='dopocena' then occupied:=people_reserved; end if;
 return jsonb_build_object('total',total,'occupied',occupied,'people_reserved',people_reserved,
  'unused',waste,'physical_remaining',case when service_type='normale' then greatest(0,total-occupied) else null end,
  'people_remaining',greatest(0,25-people_reserved),
  'remaining',case when service_type='normale' then least(greatest(0,total-occupied),greatest(0,25-people_reserved))
    else greatest(0,total-people_reserved) end,'verified',true);
end; $$;
-- Existing no-show trigger now shares the same midnight interpretation.
create or replace function private.service_capacity(day text, reference_time text, exclude_id bigint default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.service_capacity_for_type(day,reference_time,'normale',exclude_id);
$$;
-- The legacy combined-day 25-cover trigger is removed above. The BEFORE
-- INSERT prepare_booking trigger checks DOPOCENA under advisory lock 734512.
create or replace function private.validate_manual_no_show()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status in ('arrived','cancelled','completed') or private.booking_scheduled_at(new.booking_date,new.booking_time) is null or clock_timestamp()<private.booking_scheduled_at(new.booking_date,new.booking_time)+interval '30 minutes' then raise exception 'No-show consentito solo per cliente non arrivato dopo 30 minuti' using errcode='22023'; end if;
 return new;
end; $$;
create or replace function private.queue_booking_lifecycle_email() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.booking_communications%rowtype; k text;
begin
 if current_setting('makai.rebalancing',true)='on' then return new; end if;
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


-- Random token hashes only; no public SELECT/GRANT on booking ownership tokens.
grant usage on schema private to service_role;
create table if not exists private.booking_customer_tokens (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 booking_id bigint not null references public.bookings(id) on delete cascade,
 expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
alter table private.booking_customer_tokens enable row level security;
revoke all on private.booking_customer_tokens from public,anon,authenticated;
grant select,insert,update,delete on private.booking_customer_tokens to service_role;
create index if not exists booking_customer_tokens_booking_idx on private.booking_customer_tokens(booking_id);
alter table public.booking_requests add column if not exists alternative_note text not null default '' check(length(alternative_note)<=300);
create or replace function private.customer_booking(token_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 select jsonb_build_object('name',b.name,'booking_date',b.booking_date,'booking_time',b.booking_time,'booking_type',b.booking_type,'party_size',b.party_size,'notes',b.notes,'status',b.status,'reconfirmation_status',b.reconfirmation_status,
 'requests',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'type',r.request_type,'value',r.requested_value,'status',r.status,'alternative',r.alternative_note) order by r.created_at desc),'[]') from public.booking_requests r where r.booking_id=b.id)) into result
 from private.booking_customer_tokens t join public.bookings b on b.id=t.booking_id where t.token_hash=customer_booking.token_hash and t.expires_at>now() and t.revoked_at is null;
 return result;
end; $$;
create or replace function private.customer_booking_request(token_hash text, request_type text, requested_value jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_booking_id bigint; request_id bigint; prior_guard text;
begin
 perform pg_advisory_xact_lock(734512);
 select b.id into v_booking_id from private.booking_customer_tokens t join public.bookings b on b.id=t.booking_id where t.token_hash=customer_booking_request.token_hash and t.expires_at>now() and t.revoked_at is null and b.status='confirmed' and private.booking_scheduled_at(b.booking_date,b.booking_time)>now() for update of b;
 if v_booking_id is null then raise exception 'Collegamento non valido o prenotazione non modificabile' using errcode='P0002'; end if;
 if exists(select 1 from public.booking_requests r where r.booking_id=v_booking_id and r.status='pending' and r.request_type=customer_booking_request.request_type) then raise exception 'Richiesta di questo tipo già in attesa' using errcode='40001'; end if;
 prior_guard:=coalesce(current_setting('makai.customer_request',true),'');perform set_config('makai.customer_request','on',true);
 insert into public.booking_requests(booking_id,request_type,requested_value,expected) values(v_booking_id,request_type,requested_value,'{}') returning id into request_id;
 perform set_config('makai.customer_request',prior_guard,true);
 return jsonb_build_object('ok',true,'request_id',request_id);
end; $$;
create or replace function private.reconfirm_customer_booking(token_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.bookings%rowtype;
begin
 perform pg_advisory_xact_lock(734512);
 select bookings.* into b from private.booking_customer_tokens t join public.bookings bookings on bookings.id=t.booking_id where t.token_hash=reconfirm_customer_booking.token_hash and t.expires_at>now() and t.revoked_at is null and bookings.status='confirmed' and private.booking_scheduled_at(bookings.booking_date,bookings.booking_time)>now() for update of bookings;
 if b.id is null then raise exception 'Collegamento non valido o prenotazione non riconfermabile' using errcode='P0002'; end if;
 if b.reconfirmation_status<>'reconfirmed' then
  update public.bookings set reconfirmation_status='reconfirmed',reconfirmed_at=now() where id=b.id;
  insert into public.booking_history(booking_id,action,old_data,new_data) values(b.id,'customer_reconfirmed','{}',jsonb_build_object('reconfirmation_status','reconfirmed'));
 end if;
 return jsonb_build_object('ok',true,'reconfirmation_status','reconfirmed');
end; $$;
create or replace function public.admin_propose_booking_alternative(request_id bigint, proposal text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.booking_requests%rowtype;
begin
 if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' or length(btrim(proposal)) not between 1 and 300 then raise exception 'Proposta non valida' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734512);
 update public.booking_requests r set alternative_note=btrim(proposal) where r.id=request_id and r.status='pending' returning * into saved;
 if not found then raise exception 'Richiesta già gestita' using errcode='40001'; end if;
 return to_jsonb(saved);
end; $$;
create or replace function public.admin_set_booking_frozen(booking_id bigint, frozen boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.bookings%rowtype;
begin
 if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' or frozen is null then raise exception 'Accesso riservato allo staff' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734512);
 update public.bookings bookings set operational_frozen=frozen where id=booking_id returning * into b;
 if not found then raise exception 'Prenotazione non accessibile' using errcode='P0002'; end if;
 return to_jsonb(b);
end; $$;
-- Reminder preparation is explicitly invoked by a server worker, never by a migration.
-- The existing sender/claim/log infrastructure is reused; scheduling and sending require deployment.
alter table public.booking_communications drop constraint if exists booking_communications_kind_check;
alter table public.booking_communications add constraint booking_communications_kind_check check(kind in ('confirmation','updated','cancelled','reminder','reconfirmation','delay','alternative'));
create or replace function private.prepare_booking_reminder(booking_id bigint, management_url text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.bookings%rowtype; cid bigint;
begin
 perform pg_advisory_xact_lock(734512);
 select * into b from public.bookings bookings where id=booking_id and status='confirmed' and booking_date=to_char((now() at time zone 'Europe/Rome')::date+1,'YYYY-MM-DD') for update;
 if b.id is null or b.email='' or b.email is null then return null; end if;
 insert into public.booking_communications(booking_id,channel,kind,status,snapshot,recipient,event_key)
 values(b.id,'email','reminder','queued',private.booking_email_snapshot(b)||jsonb_build_object('management_url',management_url),b.email,'reminder:'||b.id||':'||b.booking_date)
 on conflict(event_key) do nothing returning id into cid;
 if cid is null then return null; end if;
 insert into public.booking_communication_logs(communication_id,status) values(cid,'queued');
 update public.bookings set reconfirmation_status=case when reconfirmation_status='reconfirmed' then 'reconfirmed' else 'pending' end where id=b.id;
 return (select to_jsonb(c) from public.booking_communications c where id=cid);
end; $$;
revoke all on function private.customer_booking(text),private.customer_booking_request(text,text,jsonb),private.reconfirm_customer_booking(text),private.prepare_booking_reminder(bigint,text) from public,anon,authenticated;
grant execute on function private.customer_booking(text),private.customer_booking_request(text,text,jsonb),private.reconfirm_customer_booking(text),private.prepare_booking_reminder(bigint,text) to service_role;
revoke all on function public.admin_propose_booking_alternative(bigint,text),public.admin_set_booking_frozen(bigint,boolean) from public,anon;
grant execute on function public.admin_propose_booking_alternative(bigint,text),public.admin_set_booking_frozen(bigint,boolean) to authenticated;

create or replace function private.process_booking_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings%rowtype;
  field_name text;
  changes jsonb;
  day_value date;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' and not (tg_op='INSERT' and current_setting('role',true) not in ('anon','authenticated') and current_setting('makai.customer_request',true)='on') then
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
    if old.status='pending' and new.status='pending' and new.alternative_note is distinct from old.alternative_note and (to_jsonb(new)-'alternative_note')=(to_jsonb(old)-'alternative_note') then
      insert into public.booking_history(booking_id,action,old_data,new_data) values(new.booking_id,'customer_alternative_proposed','{}',jsonb_build_object('proposal',new.alternative_note,'request_id',new.id));
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
$$;


create table if not exists public.admin_notification_archives (
 user_id uuid not null default auth.uid(), notification_id text not null check(length(notification_id) between 1 and 200), archived_at timestamptz not null default now(), primary key(user_id,notification_id)
);
alter table public.admin_notification_archives enable row level security;
revoke all on public.admin_notification_archives from public,anon,authenticated;
grant select,insert on public.admin_notification_archives to authenticated;
drop policy if exists admin_archives_select on public.admin_notification_archives;
create policy admin_archives_select on public.admin_notification_archives for select to authenticated using ((select auth.jwt()->'app_metadata'->>'role')='admin' and user_id=(select auth.uid()));
drop policy if exists admin_archives_insert on public.admin_notification_archives;
create policy admin_archives_insert on public.admin_notification_archives for insert to authenticated with check ((select auth.jwt()->'app_metadata'->>'role')='admin' and user_id=(select auth.uid()));
create or replace function public.admin_list_notifications()
returns table(id text,booking_id bigint,booking_date text,kind text,priority text,message text,created_at timestamptz,read_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'Accesso riservato allo staff' using errcode='42501'; end if;
 return query with scheduled as (
  select b.*,private.booking_scheduled_at(b.booking_date,b.booking_time) scheduled_at from public.bookings b where b.status='confirmed' and b.booking_date=private.operational_day()
 ), events as (
  select 'request:'||r.id as id,b.id booking_id,b.booking_date,'customer_request'::text kind,
   case when r.request_type='cancellazione' then 'high' else 'normal' end priority,'Richiesta cliente: '||r.request_type message,r.created_at
   from public.booking_requests r join public.bookings b on b.id=r.booking_id where r.status='pending'
  union all
  select 'online:'||b.id,b.id,b.booking_date,'online_booking','normal','Nuova prenotazione online · '||case when b.booking_type='dopocena' then 'DOPOCENA' else 'CENA' end,b.created_at from public.bookings b
   where b.source='booking' and b.status in ('confirmed','arrived') and b.created_at>=(now() at time zone 'Europe/Rome')::date at time zone 'Europe/Rome'
  union all
  select 'delay:'||b.id||':'||to_char(b.scheduled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS'),b.id,b.booking_date,'delay',case when now()>=b.scheduled_at+interval '30 minutes' then 'high' else 'normal' end,'Cliente non ancora arrivato',b.scheduled_at+interval '15 minutes' from scheduled b where now()>=b.scheduled_at+interval '15 minutes'
  union all
  select 'waiting:'||b.id,b.id,b.booking_date,'waiting_table','high','DOPOCENA arrivato senza tavolo disponibile',coalesce(b.arrived_at,b.updated_at) from public.bookings b where b.booking_type='dopocena' and b.status='arrived' and coalesce(b.tables,'')='' and b.booking_date=private.operational_day()
  union all
  select 'reconfirmation:'||b.id,b.id,b.booking_date,'reconfirmation','normal','Riconferma ancora da ricevere',private.booking_scheduled_at(b.booking_date,'19:00') from public.bookings b where b.status='confirmed' and b.reconfirmation_status='pending' and b.booking_date=private.operational_day()
  union all
  select 'communication:'||c.id,b.id,b.booking_date,'communication_failed','high','Comunicazione non confermata · '||c.kind,c.created_at
  from public.booking_communications c join public.bookings b on b.id=c.booking_id
  where c.status in ('failed','unknown','bounced','complained')
    and not exists (
      select 1 from public.booking_communications resolved
      where resolved.booking_id=c.booking_id and resolved.channel=c.channel
        and resolved.kind=c.kind and resolved.recipient=c.recipient
        and resolved.status in ('accepted','delivered')
        and (resolved.created_at > c.created_at or (resolved.created_at=c.created_at and resolved.id>c.id))
        and resolved.snapshot->>'name'=c.snapshot->>'name'
        and resolved.snapshot->>'booking_date'=c.snapshot->>'booking_date'
        and resolved.snapshot->>'booking_time'=c.snapshot->>'booking_time'
        and resolved.snapshot->>'party_size'=c.snapshot->>'party_size'
        and resolved.snapshot->>'tables'=c.snapshot->>'tables'
    )
 ) select e.id,e.booking_id,e.booking_date,e.kind,e.priority,e.message,e.created_at,r.read_at from events e
 left join public.admin_notification_reads r on r.notification_id=e.id and r.user_id=auth.uid()
 where not exists(select 1 from public.admin_notification_archives a where a.notification_id=e.id and a.user_id=auth.uid())
 order by e.created_at desc,e.id;
end; $$;
create or replace function public.admin_archive_notification(notification_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved_at timestamptz;
begin
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'Accesso riservato allo staff' using errcode='42501'; end if;
 if not exists(select 1 from public.admin_list_notifications() n where n.id=notification_id) then raise exception 'Notifica risolta: aggiorna' using errcode='P0002'; end if;
 insert into public.admin_notification_archives(user_id,notification_id) values(auth.uid(),notification_id) on conflict do nothing;
 select a.archived_at into saved_at from public.admin_notification_archives a where a.user_id=auth.uid() and a.notification_id=admin_archive_notification.notification_id;
 return jsonb_build_object('id',notification_id,'archived_at',saved_at);
end; $$;
revoke all on function public.admin_list_notifications(),public.admin_archive_notification(text) from public,anon;
grant execute on function public.admin_list_notifications(),public.admin_archive_notification(text) to authenticated;

create or replace function private.record_admin_booking_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  previous_values jsonb;
  current_values jsonb;
  previous_changes jsonb := '{}'::jsonb;
  current_changes jsonb := '{}'::jsonb;
  field_name text;
begin
  if current_setting('makai.rebalancing',true)='on' then return new; end if;
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.booking_history (booking_id, action, old_data, new_data, actor_id)
      values (new.id, 'booking_created', '{}'::jsonb,
        jsonb_build_object('booking_date', new.booking_date, 'booking_time', new.booking_time,
          'party_size', new.party_size, 'tables', new.tables, 'status', new.status,
          'booking_type', new.booking_type), auth.uid());
    return new;
  end if;

  previous_values := jsonb_build_object(
    'status', old.status, 'booking_date', old.booking_date,
    'booking_time', old.booking_time, 'party_size', old.party_size,
    'tables', old.tables, 'notes', old.notes
  );
  current_values := jsonb_build_object(
    'status', new.status, 'booking_date', new.booking_date,
    'booking_time', new.booking_time, 'party_size', new.party_size,
    'tables', new.tables, 'notes', new.notes
  );
  foreach field_name in array array[
    'status', 'booking_date', 'booking_time', 'party_size', 'tables', 'notes'
  ] loop
    if previous_values->field_name is distinct from current_values->field_name then
      previous_changes := previous_changes || jsonb_build_object(field_name, previous_values->field_name);
      current_changes := current_changes || jsonb_build_object(field_name, current_values->field_name);
    end if;
  end loop;
  if previous_changes = '{}'::jsonb then return new; end if;

  insert into public.booking_history (booking_id, action, old_data, new_data, actor_id)
    values (new.id,
      case when previous_changes = jsonb_build_object('status', previous_values->'status')
        then 'status_changed' else 'booking_updated' end,
      previous_changes, current_changes, auth.uid());
  return new;
end;
$$;


create or replace function public.admin_restore_released_table(booking_id bigint, previous_tables text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.bookings%rowtype;
begin
 if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'Accesso riservato allo staff' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734512);
 select * into b from public.bookings bookings where id=booking_id and status='completed' and tables='' for update;
 if b.id is null then raise exception 'Prenotazione cambiata: impossibile annullare' using errcode='40001'; end if;
 if exists(select 1 from public.bookings other where other.id<>booking_id and other.booking_date=b.booking_date and other.status not in ('cancelled','no_show') and string_to_array(replace(other.tables,'+',','),',') && string_to_array(replace(previous_tables,'+',','),',')) then raise exception 'Tavolo già riassegnato: impossibile annullare la liberazione' using errcode='23505'; end if;
 update public.bookings bookings set status='arrived',tables=previous_tables where id=booking_id returning * into b;
 return jsonb_build_object('booking_id',b.id,'status',b.status,'tables',b.tables,'history_error',null);
end; $$;
revoke all on function public.admin_restore_released_table(bigint,text) from public,anon;
grant execute on function public.admin_restore_released_table(bigint,text) to authenticated;

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
    or (b.status='confirmed' and c.kind not in ('confirmation','updated','reminder','reconfirmation','delay','alternative'))
    or (b.status='cancelled' and c.kind<>'cancelled')
    or (c.snapshot - array['management_url','proposal']) is distinct from private.booking_email_snapshot(b)
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

create or replace function private.queue_booking_email(b public.bookings,k text,event text) returns void
language plpgsql security definer set search_path='' as $$
declare cid bigint; outcome text;
begin
 outcome:=case when b.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(b.email)<=120 then 'queued' else 'skipped' end;
 insert into public.booking_communications(booking_id,channel,kind,status,snapshot,recipient,event_key,error_code)
 values(b.id,'email',k,outcome,private.booking_email_snapshot(b),coalesce(b.email,''),event,
 case when outcome='skipped' then 'invalid_email' end) on conflict(event_key) do nothing returning id into cid;
 if cid is not null then insert into public.booking_communication_logs(communication_id,status,error_code) values(cid,outcome,case when outcome='skipped' then 'invalid_email' end); end if;
end $$;

create or replace function public.admin_update_booking(
  booking_id bigint, changes jsonb, expected jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  previous_booking public.bookings%rowtype;
  saved_booking public.bookings%rowtype;
  previous_values jsonb;
  key_name text;
  selected_tables text;
  availability_change boolean;
  date_value date;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode = '42501';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb then
    raise exception 'Nessuna modifica da salvare' using errcode = '22023';
  end if;
  if expected is null or jsonb_typeof(expected) <> 'object' then
    raise exception 'Dati originali mancanti: aggiorna la pagina' using errcode = '22023';
  end if;
  for key_name in select jsonb_object_keys(changes) loop
    if key_name not in ('booking_date', 'booking_time', 'party_size', 'tables', 'notes') then
      raise exception 'Campo non modificabile' using errcode = '22023';
    end if;
    if changes->key_name = 'null'::jsonb then
      raise exception 'Valore non valido' using errcode = '22023';
    end if;
    if key_name <> 'party_size' and jsonb_typeof(changes->key_name) <> 'string' then
      raise exception 'Tipo di valore non valido' using errcode = '22023';
    end if;
  end loop;

  if changes ? 'booking_date' then
    if changes->>'booking_date' !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Data non valida' using errcode = '22023';
    end if;
    date_value := (changes->>'booking_date')::date;
    if to_char(date_value, 'YYYY-MM-DD') <> changes->>'booking_date' then
      raise exception 'Data non valida' using errcode = '22023';
    end if;
  end if;
  if changes ? 'booking_time' and changes->>'booking_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Orario non valido' using errcode = '22023';
  end if;
  if changes ? 'party_size' then
    if jsonb_typeof(changes->'party_size') <> 'number'
       or changes->>'party_size' !~ '^[1-9][0-9]{0,9}$' then
      raise exception 'Numero persone non valido' using errcode = '22023';
    end if;
  end if;
  if changes ? 'tables' and (
    length(changes->>'tables') > 200 or
    (changes->>'tables' <> '' and changes->>'tables' !~ '^[1-9][0-9]*(\+[1-9][0-9]*)*(,[1-9][0-9]*(\+[1-9][0-9]*)*)*$')
  ) then
    raise exception 'Assegnazioni tavoli non valide' using errcode = '22023';
  end if;
  if changes ? 'notes' and length(changes->>'notes') > 300 then
    raise exception 'Note troppo lunghe: massimo 300 caratteri' using errcode = '22023';
  end if;

  availability_change := changes ?| array['booking_date', 'booking_time', 'party_size', 'tables'];
  if availability_change then perform pg_advisory_xact_lock(734512); end if;

  select * into previous_booking from public.bookings b where b.id = booking_id for update;
  if not found then
    raise exception 'Prenotazione non trovata o non accessibile' using errcode = 'P0002';
  end if;
  previous_values := jsonb_build_object(
    'booking_date', previous_booking.booking_date, 'booking_time', previous_booking.booking_time,
    'party_size', previous_booking.party_size, 'tables', previous_booking.tables, 'notes', previous_booking.notes
  );
  if previous_values is distinct from expected then
    raise exception 'La prenotazione è cambiata nel frattempo. Aggiorna la pagina e riapri la modifica'
      using errcode = '40001';
  end if;
  if not exists (select 1 from jsonb_each(changes) c where c.value is distinct from previous_values->c.key) then
    raise exception 'Nessuna modifica da salvare' using errcode = '22023';
  end if;

  selected_tables := case when changes ? 'tables' then changes->>'tables' else previous_booking.tables end;
  -- This ADMIN RPC preserves submitted values without CENA/DOPOCENA validation.

  perform set_config('makai.manual_admin_edit','on',true);
  update public.bookings as b set
    booking_date = case when changes ? 'booking_date' then changes->>'booking_date' else b.booking_date end,
    booking_time = case when changes ? 'booking_time' then changes->>'booking_time' else b.booking_time end,
    party_size = case when changes ? 'party_size' then (changes->>'party_size')::integer else b.party_size end,
    tables = selected_tables,
    notes = case when changes ? 'notes' then changes->>'notes' else b.notes end
  where b.id = booking_id returning b.* into saved_booking;
  perform set_config('makai.manual_admin_edit','off',true);

  -- A staff edit must not trigger a silent automatic reassignment.
  if saved_booking.tables is distinct from selected_tables then
    raise exception 'Il controllo esistente richiede una diversa assegnazione tavoli. Modifica non salvata: la riassegnazione avanzata non è disponibile'
      using errcode = '22023';
  end if;
  if saved_booking.status is distinct from previous_booking.status then
    raise exception 'Modifica non salvata: lo stato deve restare invariato' using errcode = '22023';
  end if;
  return jsonb_build_object('booking', jsonb_build_object(
    'id', saved_booking.id, 'booking_date', saved_booking.booking_date,
    'booking_time', saved_booking.booking_time, 'party_size', saved_booking.party_size,
    'tables', saved_booking.tables, 'notes', saved_booking.notes, 'status', saved_booking.status
  ));
end;
$$;


-- ADMIN backend prepares explicit templates through the original communication table.
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

create or replace function public.admin_set_booking_status(
  booking_id bigint, booking_status text
)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  current_status text;
  saved_status text;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode = '42501';
  end if;
  if booking_status is null or booking_status not in (
    'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'
  ) then
    raise exception 'Stato non valido' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(734512);
  if booking_status = 'no_show' then
    select b.status into current_status from public.bookings b
      where b.id = booking_id for update;
    if not found then
      raise exception 'Prenotazione non trovata o non accessibile' using errcode = 'P0002';
    end if;
    if current_status = 'no_show' then return current_status; end if;
  end if;

  update public.bookings as b set status = booking_status
    where b.id = booking_id returning b.status into saved_status;
  if not found then
    raise exception 'Prenotazione non trovata o non accessibile' using errcode = 'P0002';
  end if;
  return saved_status;
end;
$$;

create or replace function public.admin_assign_booking_tables(
  booking_id bigint, changes jsonb, expected jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  previous_booking public.bookings%rowtype;
  saved_booking public.bookings%rowtype;
  previous_values jsonb;
  key_name text;
  selected_tables text;
  prior_explicit_release text;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode = '42501';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb then
    raise exception 'Nessuna modifica da salvare' using errcode = '22023';
  end if;
  if expected is null or jsonb_typeof(expected) <> 'object' then
    raise exception 'Dati originali mancanti: aggiorna la pagina' using errcode = '22023';
  end if;
  for key_name in select jsonb_object_keys(changes) loop
    if key_name <> 'tables' then
      raise exception 'Campo non modificabile' using errcode = '22023';
    end if;
    if changes->key_name = 'null'::jsonb then
      raise exception 'Valore non valido' using errcode = '22023';
    end if;
    if key_name <> 'party_size' and jsonb_typeof(changes->key_name) <> 'string' then
      raise exception 'Tipo di valore non valido' using errcode = '22023';
    end if;
  end loop;

  if changes ? 'tables' and (
    length(changes->>'tables') > 200 or
    (changes->>'tables' <> '' and changes->>'tables' !~ '^[1-9][0-9]*(\+[1-9][0-9]*)*(,[1-9][0-9]*(\+[1-9][0-9]*)*)*$')
  ) then
    raise exception 'Assegnazioni tavoli non valide' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(734512);

  select * into previous_booking from public.bookings b where b.id = booking_id for update;
  if not found then
    raise exception 'Prenotazione non trovata o non accessibile' using errcode = 'P0002';
  end if;
  previous_values := jsonb_build_object(
    'booking_date', previous_booking.booking_date, 'booking_time', previous_booking.booking_time,
    'party_size', previous_booking.party_size, 'tables', previous_booking.tables, 'notes', previous_booking.notes
  );
  if previous_values is distinct from expected then
    raise exception 'La prenotazione è cambiata nel frattempo. Aggiorna la pagina e riapri la modifica'
      using errcode = '40001';
  end if;
  if not exists (select 1 from jsonb_each(changes) c where c.value is distinct from previous_values->c.key) then
    raise exception 'Nessuna modifica da salvare' using errcode = '22023';
  end if;

  selected_tables := case when changes ? 'tables' then changes->>'tables' else previous_booking.tables end;
  -- This ADMIN RPC saves the selected table as entered, without capacity or
  -- occupancy checks. Only its explicit clear can trigger a DOPOCENA handoff.

  prior_explicit_release := coalesce(current_setting('makai.explicit_table_release',true),'');
  if selected_tables='' and coalesce(previous_booking.tables,'')<>'' then
    perform set_config('makai.explicit_table_release','on',true);
  end if;
  perform set_config('makai.manual_admin_edit','on',true);
  update public.bookings as b set tables = selected_tables
  where b.id = booking_id returning b.* into saved_booking;
  perform set_config('makai.manual_admin_edit','off',true);
  perform set_config('makai.explicit_table_release',prior_explicit_release,true);

  -- The chosen manual assignment is saved as entered; no optimizer runs.
  if saved_booking.tables is distinct from selected_tables then
    raise exception 'Il controllo esistente richiede una diversa assegnazione tavoli. Modifica non salvata: la riassegnazione avanzata non è disponibile'
      using errcode = '22023';
  end if;
  if saved_booking.status is distinct from previous_booking.status then
    raise exception 'Modifica non salvata: lo stato deve restare invariato' using errcode = '22023';
  end if;
  return jsonb_build_object('booking', jsonb_build_object(
    'id', saved_booking.id, 'booking_date', saved_booking.booking_date,
    'booking_time', saved_booking.booking_time, 'party_size', saved_booking.party_size,
    'tables', saved_booking.tables, 'notes', saved_booking.notes, 'status', saved_booking.status
  ));
end;
$$;


create or replace function public.admin_create_after_dinner_booking(
  p_customer_name text, p_customer_phone text, p_customer_email text,
  p_booking_date text, p_booking_time text, p_party_size integer,
  p_notes text, p_table_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.bookings%rowtype;
  selected_date date;
  selected_table text := btrim(coalesce(p_table_id, ''));
  selected_groups text[]; selected_ids text[]; covers integer;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode = '42501';
  end if;
  if p_customer_name is null or length(btrim(p_customer_name)) not between 2 and 60 then
    raise exception 'Nome non valido' using errcode = '22023';
  end if;
  if coalesce(p_customer_phone,'') <> '' and p_customer_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Telefono non valido' using errcode = '22023';
  end if;
  if coalesce(p_customer_email, '') <> '' and
     (length(p_customer_email) > 120 or p_customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Email non valida' using errcode = '22023';
  end if;
  if p_booking_date is null or p_booking_date !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Data non valida' using errcode = '22023';
  end if;
  begin
    selected_date := p_booking_date::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Data non valida' using errcode = '22023';
  end;
  if to_char(selected_date, 'YYYY-MM-DD') <> p_booking_date then
    raise exception 'Data non valida' using errcode = '22023';
  end if;
  if p_booking_time is null or p_booking_time !~ '^(22:(3[0-9]|[4-5][0-9])|23:[0-5][0-9]|00:00)$' then
    raise exception 'Orario non valido' using errcode = '22023';
  end if;
  if p_party_size is null or p_party_size not between 1 and 25 then
    raise exception 'Numero persone non valido' using errcode = '22023';
  end if;
  if selected_table <> '' and selected_table !~ '^[1-9][0-9]*(\+[1-9][0-9]*)*(,[1-9][0-9]*(\+[1-9][0-9]*)*)*$' then
    raise exception 'Assegnazione tavoli non valida' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 300 then
    raise exception 'Note troppo lunghe' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(734512);
  select coalesce(sum(b.party_size), 0) into covers
  from public.bookings b where b.booking_date=p_booking_date
    and b.booking_type='dopocena' and b.status not in ('cancelled','no_show');
  if covers + p_party_size > 25 then
    raise exception 'Limite DOPOCENA di 25 persone raggiunto' using errcode='P0001';
  end if;
  if selected_table<>'' then
    selected_groups:=string_to_array(selected_table,',');
    selected_ids:=private.physical_ids(selected_table);
    if exists(select 1 from unnest(selected_groups) t left join private.online_table_groups() g on g.group_id=t where g.group_id is null)
      or cardinality(selected_ids)<>(select count(distinct id) from unnest(selected_ids) id)
      or not private.online_groups_compatible(selected_groups) then
      raise exception 'Assegnazione tavoli non configurata o duplicata' using errcode='22023';
    end if;
    if exists(select 1 from public.bookings b where b.booking_date=p_booking_date
      and b.status not in ('cancelled','no_show') and private.physical_ids(b.tables) && selected_ids) then
      raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa giornata' using errcode='23505';
    end if;
  end if;
  insert into public.bookings (
    name, phone, email, booking_date, booking_time, party_size, notes,
    tables, status, source, reminder_status, booking_type
  ) values (
    btrim(p_customer_name), p_customer_phone, lower(coalesce(p_customer_email, '')),
    p_booking_date, p_booking_time, p_party_size, coalesce(p_notes, ''),
    selected_table, 'confirmed', 'agenda', 'skipped', 'dopocena'
  ) returning * into saved;

  return jsonb_build_object(
    'id', saved.id, 'booking_date', saved.booking_date,
    'booking_time', saved.booking_time, 'party_size', saved.party_size,
    'tables', saved.tables, 'status', saved.status,
    'source', saved.source, 'booking_type', saved.booking_type
  );
end;
$$;

-- Restrict all new privileged helpers. Public paths remain server or ADMIN only.
revoke all on function private.validate_manual_no_show() from public,anon,authenticated;
revoke all on function private.operational_day(timestamptz),private.valid_service_slot(text,text),private.dinner_physical_capacity(),private.physical_ids(text),private.assignment_fits(jsonb,jsonb),private.search_dinner_plan(jsonb,jsonb,jsonb,integer,integer),private.dinner_plan(text,jsonb,bigint),private.online_slot_status(text,text,integer,text,bigint),private.apply_dinner_plan(text,jsonb,bigint),private.rebalance_booking_event() from public,anon,authenticated;
grant execute on function private.online_slot_status(text,text,integer,text,bigint) to service_role;
revoke all on function public.admin_release_booking_table(bigint) from public,anon;
grant execute on function public.admin_release_booking_table(bigint) to authenticated;
revoke all on function public.admin_create_after_dinner_booking(text,text,text,text,text,integer,text,text) from public,anon;
grant execute on function public.admin_create_after_dinner_booking(text,text,text,text,text,integer,text,text) to authenticated;
do $$ declare t text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['bookings','booking_requests','admin_notification_reads','admin_notification_archives'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t); end if;
  end loop;
 end if;
end; $$;
revoke all on function public.claim_new_online_booking_email(bigint) from public,anon,authenticated;
grant execute on function public.claim_new_online_booking_email(bigint) to service_role;
notify pgrst,'reload schema';
commit;
