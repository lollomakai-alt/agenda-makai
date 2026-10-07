-- Applicare dopo online-booking.sql, pending-online-capacity.sql,
-- temporal-table-conflicts.sql e manual-table-assignment.sql.
-- Assegnazione manuale: unità del catalogo operativo, capienza sufficiente,
-- conflitti fisici/temporali invariati. Configurazioni e pendenti sono consigli.
-- Nessuna modifica ai record o al layout della piantina.
begin;
set local lock_timeout = '5s';

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
  selected_party_size integer;
  selected_count integer;
  selected_capacity integer;
  availability_change boolean;
  date_value date;
  selected_date date;
  selected_time text;
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
    if (changes->>'party_size')::numeric > 6 then
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
  if coalesce(previous_booking.status,'confirmed') not in ('confirmed','arrived') then
    raise exception 'Prenotazione non assegnabile' using errcode = '22023';
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
  selected_party_size := case when changes ? 'party_size' then (changes->>'party_size')::integer else previous_booking.party_size end;
  selected_date := case when changes ? 'booking_date' then (changes->>'booking_date')::date else previous_booking.booking_date::date end;
  selected_time := left(case when changes ? 'booking_time' then changes->>'booking_time' else previous_booking.booking_time::text end, 5);
  if availability_change and (
    selected_date < (now() at time zone 'Europe/Rome')::date
    or selected_date > (now() at time zone 'Europe/Rome')::date + 60
    or extract(isodow from selected_date) = 1
  ) then
    raise exception 'Data non disponibile' using errcode = '22023';
  end if;
  if availability_change and (
    (previous_booking.booking_type = 'dopocena' and selected_time !~ '^(22|23):(00|30)$')
    or (coalesce(previous_booking.booking_type, 'normale') <> 'dopocena'
      and selected_time !~ '^(18|19|20|21|22):(00|30)$|^23:00$')
  ) then
    raise exception 'Orario non disponibile' using errcode = '22023';
  end if;
  if availability_change and selected_tables <> '' then
    select count(*), coalesce(sum(configured.capacity), 0)::integer
      into selected_count, selected_capacity
    from unnest(string_to_array(selected_tables, ',')) selected(table_id)
    join (values
      ('10+11', 3), ('12', 2), ('13+14', 2),
      ('15+16+17', 6), ('15+16', 4), ('17', 2),
      ('18+19', 4), ('18', 2), ('19', 2),
      ('20+21', 4), ('22', 2), ('23', 2)
    ) configured(table_id, capacity) on configured.table_id = selected.table_id;
    if selected_count <> cardinality(string_to_array(selected_tables, ',')) then
      raise exception 'Assegnazione tavoli non configurata' using errcode = '22023';
    end if;
    if selected_party_size > selected_capacity then
      raise exception 'Capienza insufficiente per i coperti indicati' using errcode = '22023';
    end if;
  end if;

  update public.bookings as b set
    booking_date = case when changes ? 'booking_date' then changes->>'booking_date' else b.booking_date end,
    booking_time = case when changes ? 'booking_time' then changes->>'booking_time' else b.booking_time end,
    party_size = case when changes ? 'party_size' then (changes->>'party_size')::integer else b.party_size end,
    tables = selected_tables,
    notes = case when changes ? 'notes' then changes->>'notes' else b.notes end
  where b.id = booking_id returning b.* into saved_booking;

  -- I trigger preesistenti restano attivi. Non accetta una loro riassegnazione
  -- silenziosa: in questo caso l'intera modifica (e il suo evento) è annullata.
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

create or replace function private.protect_pending_online_bookings()
      returns trigger language plpgsql security definer set search_path = '' as $$
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
        -- Assegnazione manuale ADMIN: la tutela dei pendenti è una raccomandazione.
        if coalesce(auth.jwt()->'app_metadata'->>'role','')='admin' then
          if tg_op='INSERT' and coalesce(btrim(new.tables),'')<>'' then return new; end if;
          if tg_op='UPDATE' and new.tables is distinct from old.tables then return new; end if;
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
      $$;
revoke all on function private.check_daily_table_conflicts(), private.protect_pending_online_bookings() from public,anon,authenticated;
revoke all on function public.admin_assign_booking_tables(bigint,jsonb,jsonb) from public,anon;
grant execute on function public.admin_assign_booking_tables(bigint,jsonb,jsonb) to authenticated;

-- La ricerca esistente conserva priorità alla capienza più efficiente,
-- poi alla configurazione consigliata; non elimina unità fisicamente libere.
create or replace function private.fit_online_parties(parties integer[], used text[], groups text[], minimum_group text default '')
returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare option record; physical text[];
begin
  if cardinality(parties) = 0 then return true; end if;
  if cardinality(parties) > 10 then return false; end if;
  for option in select * from private.online_table_groups() where capacity >= parties[1] and group_id > minimum_group
      order by capacity, (not private.online_groups_compatible(groups || group_id)), cardinality(string_to_array(group_id,'+')), group_id loop
    physical := string_to_array(option.group_id,'+');
    if not physical && used then
      if private.fit_online_parties(parties[2:cardinality(parties)],used || physical,groups || option.group_id,case when parties[2]=parties[1] then option.group_id else '' end) then return true; end if;
    end if;
  end loop;
  return false;
end;
$$;

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
revoke all on function private.service_capacity(text,text,bigint) from public,anon,authenticated,service_role;

create or replace function private.online_day_status(day text, people integer, exclude_id bigint default null)
returns text language plpgsql stable security invoker set search_path = '' as $$
declare row_data record; selected_group text; physical text[];
  used text[] := array[]::text[]; groups text[] := array[]::text[];
  residual jsonb; point_time text;
  parties integer[] := case when people=0 then array[]::integer[] else array[people] end; covers integer;
begin
  if people is null or people not between 0 and 6 then return 'unverified'; end if;
  if people > 0 and exists(select 1 from public.online_booking_closures c where c.booking_date = day::date) then return 'closed'; end if;
  select coalesce(sum(b.party_size),0) into covers from public.bookings b
    where b.booking_date=day and b.status='confirmed' and (exclude_id is null or b.id<>exclude_id);
  if covers + people > 25 then return 'full'; end if;
  -- Il controllo pubblico giorno/persone resta prudente, ma conta unità intere.
  for point_time in select distinct b.booking_time from public.bookings b
      where b.booking_date=day and b.status not in ('cancelled','no_show')
        and (exclude_id is null or b.id<>exclude_id) loop
    residual:=private.service_capacity(day,point_time,exclude_id);
    if not (residual->>'verified')::boolean then return 'unverified'; end if;
    if (residual->>'remaining')::integer<people then return 'full'; end if;
  end loop;
  for row_data in select b.* from public.bookings b where b.booking_date=day
      and b.status not in ('cancelled','no_show') and coalesce(b.booking_type,'normale')='normale'
      and (exclude_id is null or b.id<>exclude_id) order by b.id loop
    if row_data.party_size is null or row_data.party_size < 1 then return 'unverified'; end if;
    if coalesce(btrim(row_data.tables),'') = '' then
      parties := parties || row_data.party_size;
    else
      foreach selected_group in array string_to_array(row_data.tables,',') loop
        selected_group := btrim(selected_group);
        if not exists(select 1 from private.online_table_groups() g where g.group_id=selected_group) then return 'unverified'; end if;
        physical := string_to_array(selected_group,'+');
        if exists(select 1 from public.bookings other
          where other.id<row_data.id and other.booking_date=day
            and other.status not in ('cancelled','no_show')
            and (exclude_id is null or other.id<>exclude_id)
            and private.booking_intervals_overlap(row_data.booking_date,row_data.booking_time,other.booking_date,other.booking_time)
            and exists(select 1 from unnest(string_to_array(coalesce(other.tables,''),',')) t
              cross join lateral unnest(string_to_array(btrim(t),'+')) id where btrim(id)=any(physical))) then return 'unverified'; end if;
        used := used || physical; groups := groups || selected_group;
      end loop;
    end if;
  end loop;
  -- Le configurazioni sono preferenze: i tavoli occupati restano indisponibili.
  select coalesce(array_agg(p order by p desc),array[]::integer[]) into parties from unnest(parties) p;
  return case when private.fit_online_parties(parties,used,groups) then 'available' else 'full' end;
end;
$$;
revoke all on function private.online_day_status(text,integer,bigint), private.fit_online_parties(integer[],text[],text[],text) from public,anon,authenticated,service_role;
commit;
