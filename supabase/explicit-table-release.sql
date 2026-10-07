-- Apply after temporal-table-conflicts.sql (and manual-assignment-capacity.sql if installed).
-- Only function definitions: no booking writes, backfill, status changes or sends.
-- Existing triggers/advisory lock 734512 and grants remain in place.
begin;
set local lock_timeout = '5s';
create or replace function private.booking_intervals_overlap(left_day text, left_time text, right_day text, right_time text)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
begin
  -- Signature retained for existing callers; times never release a table.
  return left_day is null or right_day is null or left_day = right_day
    or not pg_input_is_valid(left_day,'date') or not pg_input_is_valid(right_day,'date');
end;
$$;
create or replace function private.pending_online_windows_fit(day text)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare
  row_data record;
  selected_group text;
  physical text[];
  used text[];
  groups text[];
  parties integer[];
begin
  if exists(select 1 from public.bookings b where b.booking_date=day
    and b.status not in ('cancelled','no_show')
    and private.booking_scheduled_at(b.booking_date,b.booking_time) is null) then return false; end if;
  if not exists(select 1 from public.bookings b where b.booking_date=day and b.source='booking'
    and b.status not in ('cancelled','no_show') and coalesce(btrim(b.tables),'')='') then return true; end if;
    used := array[]::text[]; groups := array[]::text[]; parties := array[]::integer[];
    for row_data in select b.* from public.bookings b where b.booking_date=day
      and b.status not in ('cancelled','no_show')
    loop
      if row_data.party_size is null or row_data.party_size < 1 then return false; end if;
      if coalesce(btrim(row_data.tables),'')='' then
        parties := parties || row_data.party_size;
      else
        foreach selected_group in array string_to_array(row_data.tables,',') loop
          selected_group := btrim(selected_group);
          if not exists(select 1 from private.online_table_groups() g where g.group_id=selected_group) then return false; end if;
          physical := string_to_array(selected_group,'+');
          if physical && used then return false; end if;
          used := used || physical; groups := groups || selected_group;
        end loop;
      end if;
    end loop;
    if not private.online_groups_compatible(groups) then return false; end if;
    select coalesce(array_agg(p order by p desc),array[]::integer[]) into parties from unnest(parties) p;
    if not private.fit_online_parties(parties,used,groups) then return false; end if;
  return true;
end;
$$;
do $upgrade$
begin
  -- Preserve whichever manual policy is already installed.
  if to_regprocedure('private.service_capacity(text,text,bigint)') is not null then
    execute $definition$
create or replace function private.check_daily_table_conflicts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  selected_ids text[];
  selected_physical_ids text[];
  occupied_groups text[];
  start_at timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.booking_date is not distinct from old.booking_date
       and new.booking_time is not distinct from old.booking_time
       and new.tables is not distinct from old.tables
       and new.booking_type is not distinct from old.booking_type
       and new.status is not distinct from old.status then return new; end if;
  end if;
  if new.status in ('cancelled', 'no_show') then return new; end if;
  if coalesce(btrim(new.tables), '') = '' then return new; end if;
  start_at := private.booking_scheduled_at(new.booking_date, new.booking_time);
  if start_at is null then
    raise exception 'Data e ora valide obbligatorie per assegnare tavoli' using errcode = '22023';
  end if;
  select array_agg(btrim(t)) into selected_ids from unnest(string_to_array(new.tables, ',')) t;
  if exists (select 1 from unnest(selected_ids) t where t not in
    ('10+11','12','13+14','15+16+17','15+16','17','18+19','18','19','20+21','22','23')) then
    raise exception 'Configurazione tavolo non valida' using errcode = '22023';
  end if;
  if cardinality(selected_ids) <> (select count(distinct t) from unnest(selected_ids) t) then
    raise exception 'Lo stesso tavolo non può essere indicato due volte' using errcode = '22023';
  end if;
  select array_agg(btrim(physical_id)) into selected_physical_ids
    from unnest(selected_ids) grouped_id
    cross join lateral unnest(string_to_array(grouped_id, '+')) physical_id;
  if cardinality(selected_physical_ids) <> (select count(distinct t) from unnest(selected_physical_ids) t) then
    raise exception 'Lo stesso tavolo fisico non può essere indicato in gruppi diversi' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.bookings b
    cross join lateral unnest(string_to_array(coalesce(b.tables, ''), ',')) t
    cross join lateral unnest(string_to_array(btrim(t), '+')) physical_id
    where b.id <> new.id and b.status not in ('cancelled','no_show')
      and private.booking_intervals_overlap(new.booking_date,new.booking_time,b.booking_date,b.booking_time)
      and btrim(physical_id) = any(selected_physical_ids)
  ) then
    raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa giornata' using errcode = '23505';
  end if;
  -- Lo staff può scegliere qualsiasi unità libera: la configurazione è un consiglio.
  if coalesce(auth.jwt()->'app_metadata'->>'role','')='admin' then return new; end if;
  -- Gli assegnati restano in uso per la giornata, senza scadenza temporale.
    select array_agg(distinct grouped_id) into occupied_groups from (
      select btrim(t) as grouped_id from unnest(selected_ids) t
      union all
      select btrim(t) from public.bookings b
      cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) t
      where b.id <> new.id and b.status not in ('cancelled','no_show')
        and private.booking_intervals_overlap(new.booking_date,new.booking_time,b.booking_date,b.booking_time)

    ) occupied where grouped_id in ('15+16+17','15+16','17','18+19','18','19');
    if occupied_groups is not null and not (
      occupied_groups <@ array['15+16+17','18+19']::text[]
      or occupied_groups <@ array['15+16','17','18+19']::text[]
      or occupied_groups <@ array['15+16','17','18','19']::text[]
    ) then
      raise exception 'Configurazione dei tavoli 15-19 non valida' using errcode = '22023';
    end if;
  return new;
end;
$$;
$definition$;
    execute $definition$
create or replace function private.service_capacity(day text, reference_time text, exclude_id bigint default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  start_at timestamptz := private.booking_scheduled_at(day,reference_time);
  row_data record;
  unit_capacity integer;
  unit_count integer;
  committed integer;
  waste integer;
  peak integer := 0;
  peak_waste integer := 0;
  used_physical text[];
  physical_ids text[];
begin
  if start_at is null then return jsonb_build_object('verified',false,'remaining',0); end if;
    committed:=0; waste:=0; used_physical:=array[]::text[];
    for row_data in select b.* from public.bookings b
      where b.status not in ('cancelled','no_show') and (exclude_id is null or b.id<>exclude_id)
        and private.booking_intervals_overlap(day,reference_time,b.booking_date,b.booking_time)

    loop
      if row_data.party_size is null or row_data.party_size<1 then return jsonb_build_object('verified',false,'remaining',0); end if;
      if coalesce(btrim(row_data.tables),'')='' then
        unit_capacity:=row_data.party_size;
      else
        select count(*),coalesce(sum(g.capacity),0)::integer into unit_count,unit_capacity
          from unnest(string_to_array(row_data.tables,',')) t join private.online_table_groups() g on g.group_id=btrim(t);
        if unit_count<>cardinality(string_to_array(row_data.tables,',')) then return jsonb_build_object('verified',false,'remaining',0); end if;
        select array_agg(btrim(id)) into physical_ids from unnest(string_to_array(row_data.tables,',')) t
          cross join lateral unnest(string_to_array(btrim(t),'+')) id;
        if unit_capacity<row_data.party_size or physical_ids && used_physical
          or cardinality(physical_ids)<>(select count(distinct id) from unnest(physical_ids) id) then
          return jsonb_build_object('verified',false,'remaining',0);
        end if;
        used_physical:=used_physical || physical_ids;
        waste:=waste+greatest(0,unit_capacity-row_data.party_size);
      end if;
      committed:=committed+unit_capacity;
    end loop;
    if committed>peak then peak:=committed; peak_waste:=waste; end if;
  return jsonb_build_object('total',25,'occupied',peak,'unused',peak_waste,'remaining',greatest(0,25-peak),'verified',true);
end;
$$;
$definition$;
  else
    execute $definition$
create or replace function private.check_daily_table_conflicts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  selected_ids text[];
  selected_physical_ids text[];
  occupied_groups text[];
  start_at timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.booking_date is not distinct from old.booking_date
       and new.booking_time is not distinct from old.booking_time
       and new.tables is not distinct from old.tables
       and new.booking_type is not distinct from old.booking_type
       and new.status is not distinct from old.status then return new; end if;
  end if;
  if new.status in ('cancelled', 'no_show') then return new; end if;
  if coalesce(btrim(new.tables), '') = '' then return new; end if;
  start_at := private.booking_scheduled_at(new.booking_date, new.booking_time);
  if start_at is null then
    raise exception 'Data e ora valide obbligatorie per assegnare tavoli' using errcode = '22023';
  end if;
  select array_agg(btrim(t)) into selected_ids from unnest(string_to_array(new.tables, ',')) t;
  if exists (select 1 from unnest(selected_ids) t where t not in
    ('10+11','12','13+14','15+16+17','15+16','17','18+19','18','19','20+21','22','23')) then
    raise exception 'Configurazione tavolo non valida' using errcode = '22023';
  end if;
  if cardinality(selected_ids) <> (select count(distinct t) from unnest(selected_ids) t) then
    raise exception 'Lo stesso tavolo non può essere indicato due volte' using errcode = '22023';
  end if;
  select array_agg(btrim(physical_id)) into selected_physical_ids
    from unnest(selected_ids) grouped_id
    cross join lateral unnest(string_to_array(grouped_id, '+')) physical_id;
  if cardinality(selected_physical_ids) <> (select count(distinct t) from unnest(selected_physical_ids) t) then
    raise exception 'Lo stesso tavolo fisico non può essere indicato in gruppi diversi' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.bookings b
    cross join lateral unnest(string_to_array(coalesce(b.tables, ''), ',')) t
    cross join lateral unnest(string_to_array(btrim(t), '+')) physical_id
    where b.id <> new.id and b.status not in ('cancelled','no_show')
      and private.booking_intervals_overlap(new.booking_date,new.booking_time,b.booking_date,b.booking_time)
      and btrim(physical_id) = any(selected_physical_ids)
  ) then
    raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa giornata' using errcode = '23505';
  end if;
  -- Gli assegnati restano in uso per la giornata, senza scadenza temporale.
    select array_agg(distinct grouped_id) into occupied_groups from (
      select btrim(t) as grouped_id from unnest(selected_ids) t
      union all
      select btrim(t) from public.bookings b
      cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) t
      where b.id <> new.id and b.status not in ('cancelled','no_show')
        and private.booking_intervals_overlap(new.booking_date,new.booking_time,b.booking_date,b.booking_time)

    ) occupied where grouped_id in ('15+16+17','15+16','17','18+19','18','19');
    if occupied_groups is not null and not (
      occupied_groups <@ array['15+16+17','18+19']::text[]
      or occupied_groups <@ array['15+16','17','18+19']::text[]
      or occupied_groups <@ array['15+16','17','18','19']::text[]
    ) then
      raise exception 'Configurazione dei tavoli 15-19 non valida' using errcode = '22023';
    end if;
  return new;
end;
$$;
$definition$;
  end if;
end;
$upgrade$;
revoke all on function private.booking_intervals_overlap(text,text,text,text),
  private.pending_online_windows_fit(text), private.check_daily_table_conflicts() from public,anon,authenticated;
commit;
