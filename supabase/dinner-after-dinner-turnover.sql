-- Agenda Makai
-- Compatibilità tra CENA e DOPOCENA.
-- Non libera automaticamente i tavoli.
begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION private.dinner_after_dinner_compatible(
  first_day text,
  first_time text,
  first_type text,
  second_day text,
  second_time text,
  second_type text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  dinner_at timestamptz;
  after_dinner_at timestamptz;
BEGIN
  IF first_day IS DISTINCT FROM second_day THEN
    RETURN false;
  END IF;

  IF first_type = 'normale' AND second_type = 'dopocena' THEN
    dinner_at := private.booking_scheduled_at(first_day, first_time);
    after_dinner_at := private.booking_scheduled_at(second_day, second_time);

  ELSIF first_type = 'dopocena' AND second_type = 'normale' THEN
    dinner_at := private.booking_scheduled_at(second_day, second_time);
    after_dinner_at := private.booking_scheduled_at(first_day, first_time);

  ELSE
    RETURN false;
  END IF;

  IF dinner_at IS NULL OR after_dinner_at IS NULL THEN
    RETURN false;
  END IF;

  IF to_char(after_dinner_at AT TIME ZONE 'Europe/Rome', 'HH24:MI')
     NOT IN ('22:30', '23:00', '23:30') THEN
    RETURN false;
  END IF;

  RETURN after_dinner_at - dinner_at >= INTERVAL '150 minutes';
END;
$$;

REVOKE ALL ON FUNCTION private.dinner_after_dinner_compatible(
  text,text,text,text,text,text
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.service_capacity_for_type(
  day text,
  reference_time text,
  service_type text,
  exclude_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  start_at timestamptz := private.booking_scheduled_at(day, reference_time);
  row_data record;
  unit_capacity integer;
  unit_count integer;
  committed integer := 0;
  waste integer := 0;
  people_reserved integer := 0;
  service_total integer := 25;
  used_physical text[] := ARRAY[]::text[];
  physical_ids text[];
BEGIN
  service_total := CASE WHEN service_type = 'normale' THEN 26 ELSE 25 END;
  IF start_at IS NULL OR service_type NOT IN ('normale', 'dopocena') THEN
    RETURN jsonb_build_object('total',service_total,'occupied',0,'unused',0,'remaining',0,'verified',false);
  END IF;

  FOR row_data IN
    SELECT b.*
    FROM public.bookings b
    WHERE b.booking_date = day
      AND b.status NOT IN ('cancelled','no_show')
      AND coalesce(b.booking_type, 'normale') = service_type
      AND (exclude_id IS NULL OR b.id <> exclude_id)
    ORDER BY b.id
  LOOP
    IF row_data.party_size IS NULL OR row_data.party_size < 1 THEN
      RETURN jsonb_build_object('total',service_total,'occupied',0,'unused',0,'remaining',0,'verified',false);
    END IF;
    people_reserved := people_reserved + row_data.party_size;

    IF coalesce(btrim(row_data.tables), '') = '' THEN
      unit_capacity := row_data.party_size;
    ELSE
      SELECT count(*), coalesce(sum(g.capacity), 0)::integer
        INTO unit_count, unit_capacity
      FROM unnest(string_to_array(row_data.tables, ',')) selected(table_id)
      JOIN private.online_table_groups() g ON g.group_id = btrim(selected.table_id);

      IF unit_count <> cardinality(string_to_array(row_data.tables, ',')) THEN
        RETURN jsonb_build_object('total',service_total,'occupied',0,'unused',0,'remaining',0,'verified',false);
      END IF;

      SELECT array_agg(btrim(physical_id))
        INTO physical_ids
      FROM unnest(string_to_array(row_data.tables, ',')) selected(table_id)
      CROSS JOIN LATERAL unnest(string_to_array(btrim(selected.table_id), '+')) physical_id;

      IF unit_capacity < row_data.party_size
        OR physical_ids && used_physical
        OR cardinality(physical_ids) <>
          (SELECT count(DISTINCT id) FROM unnest(physical_ids) id) THEN
        RETURN jsonb_build_object('total',service_total,'occupied',0,'unused',0,'remaining',0,'verified',false);
      END IF;

      used_physical := used_physical || physical_ids;
      waste := waste + greatest(0, unit_capacity - row_data.party_size);
    END IF;
    committed := committed + unit_capacity;
  END LOOP;

  RETURN jsonb_build_object(
    'total',service_total,
    'occupied',committed,
    'unused',waste,
    'people_reserved',people_reserved,
    'physical_remaining',CASE WHEN service_type='normale' THEN greatest(0,service_total-committed) ELSE NULL END,
    'people_remaining',greatest(0,25-people_reserved),
    'remaining',CASE WHEN service_type='normale'
      THEN least(greatest(0,service_total-committed),greatest(0,25-people_reserved))
      ELSE greatest(0,25-people_reserved) END,
    'verified',true
  );
END;
$$;
REVOKE ALL ON FUNCTION private.service_capacity_for_type(text,text,text,bigint)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.service_capacity(
  day text,
  reference_time text,
  exclude_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  requested_type text;
  dinner_capacity jsonb;
  after_dinner_capacity jsonb;
BEGIN
  dinner_capacity := private.service_capacity_for_type(day, reference_time, 'normale', exclude_id);
  after_dinner_capacity := private.service_capacity_for_type(day, reference_time, 'dopocena', exclude_id);
  requested_type := CASE
    WHEN reference_time ~ '^(22:30|23:00|23:30)(:00)?$' THEN 'dopocena'
    ELSE 'normale'
  END;

  RETURN (CASE WHEN requested_type = 'dopocena' THEN after_dinner_capacity ELSE dinner_capacity END)
    || jsonb_build_object(
      'dinner', dinner_capacity,
      'after_dinner', after_dinner_capacity
    );
END;
$$;
REVOKE ALL ON FUNCTION private.service_capacity(text,text,bigint)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.online_day_status(
  day text,
  people integer,
  exclude_id bigint DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  row_data record;
  selected_group text;
  physical text[];
  row_physical text[];
  used text[] := ARRAY[]::text[];
  groups text[] := ARRAY[]::text[];
  parties integer[] := CASE WHEN people = 0 THEN ARRAY[]::integer[] ELSE ARRAY[people] END;
  covers integer;
  residual jsonb;
  point_time text;
BEGIN
  IF people IS NULL OR people NOT BETWEEN 0 AND 6 THEN
    RETURN 'unverified';
  END IF;
  IF people > 0 AND EXISTS (
    SELECT 1 FROM public.online_booking_closures c WHERE c.booking_date = day::date
  ) THEN
    RETURN 'closed';
  END IF;

  SELECT coalesce(sum(b.party_size), 0) INTO covers
  FROM public.bookings b
  WHERE b.booking_date = day
    AND b.status = 'confirmed'
    AND coalesce(b.booking_type, 'normale') = 'normale'
    AND (exclude_id IS NULL OR b.id <> exclude_id);
  IF covers + people > 25 THEN
    RETURN 'full';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.booking_date = day
      AND b.status NOT IN ('cancelled','no_show')
      AND coalesce(b.booking_type, 'normale') NOT IN ('normale','dopocena')
      AND (exclude_id IS NULL OR b.id <> exclude_id)
  ) THEN
    RETURN 'unverified';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings first_booking
    JOIN public.bookings second_booking ON first_booking.id < second_booking.id
    CROSS JOIN LATERAL unnest(string_to_array(coalesce(first_booking.tables, ''), ',')) AS fg(group_id)
    CROSS JOIN LATERAL unnest(string_to_array(coalesce(second_booking.tables, ''), ',')) AS sg(group_id)
    CROSS JOIN LATERAL unnest(string_to_array(btrim(fg.group_id), '+')) AS fp(physical_id)
    CROSS JOIN LATERAL unnest(string_to_array(btrim(sg.group_id), '+')) AS sp(physical_id)
    WHERE first_booking.booking_date = day
      AND second_booking.booking_date = day
      AND first_booking.status NOT IN ('cancelled','no_show')
      AND second_booking.status NOT IN ('cancelled','no_show')
      AND (exclude_id IS NULL OR (first_booking.id <> exclude_id AND second_booking.id <> exclude_id))
      AND btrim(fp.physical_id) = btrim(sp.physical_id)
      AND NOT private.dinner_after_dinner_compatible(
        first_booking.booking_date, first_booking.booking_time, first_booking.booking_type,
        second_booking.booking_date, second_booking.booking_time, second_booking.booking_type
      )
  ) THEN
    RETURN 'unverified';
  END IF;

  FOR point_time IN
    SELECT DISTINCT b.booking_time
    FROM public.bookings b
    WHERE b.booking_date = day
      AND b.status NOT IN ('cancelled','no_show')
      AND coalesce(b.booking_type, 'normale') = 'normale'
      AND (exclude_id IS NULL OR b.id <> exclude_id)
  LOOP
    residual := private.service_capacity_for_type(day, point_time, 'normale', exclude_id);
    IF NOT (residual->>'verified')::boolean THEN
      RETURN 'unverified';
    END IF;
    IF (residual->>'remaining')::integer < people THEN
      RETURN 'full';
    END IF;
  END LOOP;

  FOR row_data IN
    SELECT b.*
    FROM public.bookings b
    WHERE b.booking_date = day
      AND b.status NOT IN ('cancelled','no_show')
      AND (exclude_id IS NULL OR b.id <> exclude_id)
    ORDER BY b.id
  LOOP
    IF row_data.party_size IS NULL OR row_data.party_size < 1 THEN
      RETURN 'unverified';
    END IF;

    IF coalesce(btrim(row_data.tables), '') = '' THEN
      IF coalesce(row_data.booking_type, 'normale') = 'normale' THEN
        parties := parties || row_data.party_size;
      END IF;
      CONTINUE;
    END IF;

    row_physical := ARRAY[]::text[];
    FOREACH selected_group IN ARRAY string_to_array(row_data.tables, ',') LOOP
      selected_group := btrim(selected_group);
      IF NOT EXISTS (
        SELECT 1 FROM private.online_table_groups() g WHERE g.group_id = selected_group
      ) THEN
        RETURN 'unverified';
      END IF;
      physical := string_to_array(selected_group, '+');
      IF physical && row_physical THEN
        RETURN 'unverified';
      END IF;
      row_physical := row_physical || physical;

      IF coalesce(row_data.booking_type, 'normale') = 'normale'
        AND NOT selected_group = ANY(groups) THEN
        groups := groups || selected_group;
      END IF;

      SELECT used || coalesce(
        array_agg(id) FILTER (WHERE NOT id = ANY(used)),
        ARRAY[]::text[]
      )
      INTO used
      FROM unnest(physical) id;
    END LOOP;
  END LOOP;

  IF NOT private.online_groups_compatible(groups) THEN
    RETURN 'unverified';
  END IF;
  SELECT coalesce(array_agg(p ORDER BY p DESC), ARRAY[]::integer[])
    INTO parties
  FROM unnest(parties) p;

  RETURN CASE
    WHEN private.fit_online_parties(parties, used, groups) THEN 'available'
    ELSE 'full'
  END;
END;
$$;
REVOKE ALL ON FUNCTION private.online_day_status(text,integer,bigint)
  FROM PUBLIC, anon, authenticated, service_role;

-- Compatibilità del secondo turno: trigger dei conflitti.
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
    ('10+11','12','13+14','15+16+17','15+16','17','18+19','18','19','20+21','22+23','22','23')) then
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
      and not private.dinner_after_dinner_compatible(
        new.booking_date, new.booking_time, new.booking_type,
        b.booking_date, b.booking_time, b.booking_type
      )
      and btrim(physical_id) = any(selected_physical_ids)
  ) then
    raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa giornata' using errcode = '23505';
  end if;
  -- Mantiene la deroga ADMIN già presente nel database live.
  -- I conflitti fisici vengono comunque controllati.
  if coalesce(auth.jwt()->'app_metadata'->>'role','')='admin'
    then return new;
  end if;
  -- Gli assegnati restano in uso per la giornata, senza scadenza temporale.
    select array_agg(distinct grouped_id) into occupied_groups from (
      select btrim(t) as grouped_id from unnest(selected_ids) t
      union all
      select btrim(t) from public.bookings b
      cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) t
      where b.id <> new.id and b.status not in ('cancelled','no_show')
        and private.booking_intervals_overlap(new.booking_date,new.booking_time,b.booking_date,b.booking_time)
      and not private.dinner_after_dinner_compatible(
        new.booking_date, new.booking_time, new.booking_type,
        b.booking_date, b.booking_time, b.booking_type
      )

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

-- Keep the existing online safeguards, while applying the 25-cover ceiling
-- independently to each service.
CREATE OR REPLACE FUNCTION private.prepare_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  administrator boolean := coalesce(auth.jwt()->'app_metadata'->>'role' = 'admin',false);
  customer boolean := current_setting('role',true) = 'authenticated' AND NOT administrator;
  dt timestamptz;
  assigned text;
BEGIN
  IF new.source = 'staff' THEN new.source := 'agenda'; END IF;
  IF new.source = 'ai' THEN new.source := 'booking'; END IF;
  IF customer THEN
    IF new.source <> 'booking' OR new.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Record non autorizzato' USING errcode='42501';
    END IF;
    IF tg_op = 'INSERT' THEN
      new.status := 'confirmed'; new.tables := ''; new.reminder_status := 'skipped';
      new.reminder_attempts := 0; new.created_at := now();
      new.consenso_ricordami := false; new.consenso_data := NULL;
      new.arrived_at := NULL; new.marketing_visit_counted_at := NULL;
    ELSE
      IF (to_jsonb(new) - ARRAY['name','email','phone','booking_date','booking_time','party_size','notes','status','updated_at'])
         IS DISTINCT FROM (to_jsonb(old) - ARRAY['name','email','phone','booking_date','booking_time','party_size','notes','status','updated_at']) THEN
        RAISE EXCEPTION 'Campo riservato all’amministratore' USING errcode='42501';
      END IF;
      IF old.status = 'cancelled' AND new.status <> old.status THEN
        RAISE EXCEPTION 'Prenotazione annullata';
      END IF;
    END IF;
  END IF;
  IF tg_op = 'INSERT' AND new.source = 'booking' THEN
    IF new.privacy_accepted_at IS NULL OR new.privacy_version IS DISTINCT FROM '2026-10-04-online-v1' THEN
      RAISE EXCEPTION 'Lettura informativa privacy obbligatoria' USING errcode='22023';
    END IF;
    new.status := 'confirmed'; new.tables := ''; new.reminder_status := 'skipped';
    new.booking_type := 'normale'; new.consenso_ricordami := false; new.consenso_data := NULL;
  END IF;
  new.updated_at := now();

  IF new.status = 'confirmed' AND
    (tg_op = 'INSERT' OR old.status IS DISTINCT FROM new.status
      OR new.booking_date IS DISTINCT FROM old.booking_date
      OR new.party_size IS DISTINCT FROM old.party_size
      OR new.booking_type IS DISTINCT FROM old.booking_type) THEN
    PERFORM pg_advisory_xact_lock(734512);
    IF (SELECT coalesce(sum(b.party_size),0)
        FROM public.bookings b
        WHERE b.id <> new.id
          AND b.status = 'confirmed'
          AND b.booking_date = new.booking_date
          AND coalesce(b.booking_type, 'normale') = coalesce(new.booking_type, 'normale'))
       + new.party_size > 25 THEN
      RAISE EXCEPTION 'Limite giornaliero di 25 coperti raggiunto' USING errcode='P0001';
    END IF;
  END IF;

  IF new.source = 'booking' AND new.status = 'confirmed' AND
    (tg_op = 'INSERT' OR new.booking_date IS DISTINCT FROM old.booking_date
      OR new.booking_time IS DISTINCT FROM old.booking_time
      OR new.party_size IS DISTINCT FROM old.party_size) THEN
    PERFORM pg_advisory_xact_lock(734512);
    IF new.booking_date !~ '^\d{4}-\d{2}-\d{2}$'
      OR new.booking_time !~ '^(18|19|20|21|22):(00|30)$|^23:00$' THEN
      RAISE EXCEPTION 'Data o ora non valide';
    END IF;
    dt := (new.booking_date || ' ' || new.booking_time)::timestamp AT TIME ZONE 'Europe/Rome';
    IF extract(isodow FROM new.booking_date::date) = 1 OR dt < now() + interval '30 minutes'
      OR new.booking_date::date > (now() AT TIME ZONE 'Europe/Rome')::date + 60
      OR new.party_size NOT BETWEEN 1 AND 6 THEN
      RAISE EXCEPTION 'Data o coperti non disponibili';
    END IF;
    IF length(btrim(new.name)) NOT BETWEEN 2 AND 60 OR length(new.notes) > 300
      OR new.phone !~ '^\+[1-9][0-9]{7,14}$' OR length(new.email) > 120 THEN
      RAISE EXCEPTION 'Contatti non validi';
    END IF;
    IF (SELECT count(*) FROM public.bookings b
        WHERE b.id <> new.id AND b.status = 'confirmed'
          AND regexp_replace(b.phone,'[^0-9]','','g') = regexp_replace(new.phone,'[^0-9]','','g')
          AND (b.booking_date || ' ' || b.booking_time)::timestamp AT TIME ZONE 'Europe/Rome' > now()) >= 2 THEN
      RAISE EXCEPTION 'Limite prenotazioni per telefono raggiunto';
    END IF;
    IF private.online_day_status(new.booking_date,new.party_size,new.id) <> 'available' THEN
      RAISE EXCEPTION 'Disponibilità cambiata: aggiorna il calendario o contatta il locale' USING errcode='P0001';
    END IF;
    IF tg_op = 'INSERT' AND coalesce(new.booking_type,'normale') = 'normale' THEN
      assigned := private.choose_online_dinner_table(new.booking_date,new.party_size,new.id);
      IF assigned IS NULL THEN
        RAISE EXCEPTION 'Disponibilità cambiata: aggiorna il calendario o contatta il locale' USING errcode='P0001';
      END IF;
      new.tables := assigned;
    END IF;
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION private.prepare_booking() FROM PUBLIC, anon, authenticated;

notify pgrst,'reload schema';
commit;
