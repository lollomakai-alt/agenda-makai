-- Correzione mirata del trigger esistente, dopo after-dinner-bookings.sql.
-- Durata invariata: STAY_MINUTES=120 in api/config.py del backend condiviso.
-- Non modifica prenotazioni, tabelle, capacità, stati o policy RLS.
begin;
set local lock_timeout = '5s';

create or replace function private.booking_scheduled_at(day text, booking_time text)
returns timestamptz language plpgsql stable security invoker set search_path = '' as $$
begin
  if day is null or booking_time is null
     or day !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-[0-9]{2}$'
     or booking_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
     or not pg_input_is_valid(day || ' ' || booking_time, 'timestamp') then return null; end if;
  return (day || ' ' || booking_time)::timestamp at time zone 'Europe/Rome';
end;
$$;

create or replace function private.booking_intervals_overlap(left_day text, left_time text, right_day text, right_time text)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare
  a timestamptz := private.booking_scheduled_at(left_day, left_time);
  b timestamptz := private.booking_scheduled_at(right_day, right_time);
begin
  -- Intervalli [inizio,fine): a esattamente 120 minuti il tavolo è riutilizzabile.
  -- Orari legacy incerti non rendono libero un tavolo nella stessa data.
  if a is null or b is null then
    return left_day is null or right_day is null or left_day = right_day
      or not pg_input_is_valid(left_day,'date') or not pg_input_is_valid(right_day,'date');
  end if;
  return a < b + interval '120 minutes' and b < a + interval '120 minutes';
end;
$$;
revoke all on function private.booking_scheduled_at(text,text), private.booking_intervals_overlap(text,text,text,text)
  from public, anon, authenticated;

create or replace function private.check_daily_table_conflicts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  selected_ids text[];
  selected_physical_ids text[];
  occupied_groups text[];
  start_at timestamptz;
  point timestamptz;
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
    raise exception 'Tavolo già assegnato a un’altra prenotazione con intervallo sovrapposto' using errcode = '23505';
  end if;
  -- Controllare le configurazioni in ciascun istante di inizio, evitando
  -- di unire artificialmente gruppi che non sono mai occupati insieme.
  for point in
    select start_at union
    select private.booking_scheduled_at(b.booking_date,b.booking_time) from public.bookings b
    where b.id <> new.id and b.status not in ('cancelled','no_show')
      and private.booking_scheduled_at(b.booking_date,b.booking_time) > start_at
      and private.booking_scheduled_at(b.booking_date,b.booking_time) < start_at + interval '120 minutes'
  loop
    select array_agg(distinct grouped_id) into occupied_groups from (
      select btrim(t) as grouped_id from unnest(selected_ids) t
      union all
      select btrim(t) from public.bookings b
      cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) t
      where b.id <> new.id and b.status not in ('cancelled','no_show')
        and private.booking_intervals_overlap(new.booking_date,new.booking_time,b.booking_date,b.booking_time)
        and (private.booking_scheduled_at(b.booking_date,b.booking_time) is null
          or (private.booking_scheduled_at(b.booking_date,b.booking_time) <= point
            and point < private.booking_scheduled_at(b.booking_date,b.booking_time) + interval '120 minutes'))
    ) occupied where grouped_id in ('15+16+17','15+16','17','18+19','18','19');
    if occupied_groups is not null and not (
      occupied_groups <@ array['15+16+17','18+19']::text[]
      or occupied_groups <@ array['15+16','17','18+19']::text[]
      or occupied_groups <@ array['15+16','17','18','19']::text[]
    ) then
      raise exception 'Configurazione dei tavoli 15-19 non valida' using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.check_daily_table_conflicts() from public, anon, authenticated;

-- Il guard delle prenotazioni online senza tavolo deve considerare le stesse
-- finestre, riutilizzando la ricerca di capienza fit_online_parties già presente.
create or replace function private.pending_online_windows_fit(day text)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare
  point timestamptz;
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
  for point in
    select distinct private.booking_scheduled_at(b.booking_date,b.booking_time)
    from public.bookings b where b.status not in ('cancelled','no_show')
      and private.booking_scheduled_at(b.booking_date,b.booking_time) is not null
      and exists(select 1 from public.bookings d where d.booking_date=day
        and d.status not in ('cancelled','no_show')
        and private.booking_intervals_overlap(d.booking_date,d.booking_time,b.booking_date,b.booking_time))
  loop
    if not exists(select 1 from public.bookings b where b.source='booking'
      and b.status not in ('cancelled','no_show') and coalesce(btrim(b.tables),'')=''
      and private.booking_scheduled_at(b.booking_date,b.booking_time) <= point
      and point < private.booking_scheduled_at(b.booking_date,b.booking_time) + interval '120 minutes') then continue; end if;
    used := array[]::text[]; groups := array[]::text[]; parties := array[]::integer[];
    for row_data in select b.* from public.bookings b where b.status not in ('cancelled','no_show')
      and private.booking_scheduled_at(b.booking_date,b.booking_time) <= point
      and point < private.booking_scheduled_at(b.booking_date,b.booking_time) + interval '120 minutes'
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
  end loop;
  return true;
end;
$$;
revoke all on function private.pending_online_windows_fit(text) from public,anon,authenticated;

-- Installazioni che hanno già il guard: mantenerlo e allineare solo il tempo.
do $patch$
begin
  if to_regprocedure('private.protect_pending_online_bookings()') is not null then
    execute $definition$
      create or replace function private.protect_pending_online_bookings()
      returns trigger language plpgsql security definer set search_path = '' as $body$
      begin
        if new.status in ('cancelled','no_show') then return new; end if;
        if tg_op='UPDATE' then
          if new.booking_date is not distinct from old.booking_date
             and new.booking_time is not distinct from old.booking_time
             and new.party_size is not distinct from old.party_size
             and new.tables is not distinct from old.tables
             and new.booking_type is not distinct from old.booking_type
             and (new.status is not distinct from old.status or old.status not in ('cancelled','no_show')) then return new; end if;
        end if;
        -- Lock, trigger e ricerca di capienza esistenti restano invariati.
        if exists(select 1 from public.bookings b where b.source='booking'
          and b.status not in ('cancelled','no_show') and coalesce(btrim(b.tables),'')=''
          and private.booking_intervals_overlap(new.booking_date,new.booking_time,b.booking_date,b.booking_time))
          and not private.pending_online_windows_fit(new.booking_date) then
          raise exception 'Assegnazione non salvata: non resterebbe posto per le prenotazioni online già confermate senza tavolo'
            using errcode='23514';
        end if;
        return new;
      end;
      $body$;
    $definition$;
  end if;
end;
$patch$;
commit;
