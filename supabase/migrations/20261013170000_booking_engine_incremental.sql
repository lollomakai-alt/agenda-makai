-- Booking engine incrementale per lo schema live letto il 2026-10-13.
-- NON applicare i vecchi script completi. Nessuna prenotazione viene aggiornata
-- dall'installazione. Eseguire l'intero file in una sola transazione.
-- Prima dell'applicazione: esportare schema, funzioni, trigger, ACL e disporre
-- di un punto di ripristino. Il rollback post-COMMIT è descritto in fondo.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare catalog jsonb;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version='20261013115504')
     or not exists (select 1 from supabase_migrations.schema_migrations where version='20261013141346') then
    raise exception 'Migrazioni prerequisito non presenti';
  end if;
  if to_regclass('public.bookings') is null or to_regclass('public.online_booking_closures') is null
     or to_regprocedure('private.online_table_groups()') is null
     or to_regprocedure('private.online_groups_compatible(text[])') is null
     or to_regprocedure('private.prepare_booking()') is null
     or to_regprocedure('private.check_daily_table_conflicts()') is null
     or to_regprocedure('private.enforce_daily_booking_capacity_25()') is null
     or to_regprocedure('public.admin_update_booking(bigint,jsonb,jsonb)') is null
     or to_regprocedure('public.admin_assign_booking_tables(bigint,jsonb,jsonb)') is null then
    raise exception 'Schema Makai incompleto: fermare la migrazione';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.bookings'::regclass
                 and tgname='y_enforce_daily_booking_capacity_25' and tgenabled='O')
     or not exists (select 1 from pg_trigger where tgrelid='public.bookings'::regclass
                 and tgname='z_check_daily_table_conflicts' and tgenabled='O')
     or not exists (select 1 from pg_trigger where tgrelid='public.bookings'::regclass
                 and tgname='a_lock_daily_table_assignment' and tgenabled='O') then
    raise exception 'Protezione quota/conflitti/concorrenza non attiva';
  end if;
  if lower(pg_get_functiondef('private.enforce_daily_booking_capacity_25()'::regprocedure))
       !~ 'booking_type[[:space:]]*=[[:space:]]*new.booking_type' then
    raise exception 'Guard 25 non separa i turni: fermare la migrazione';
  end if;
  if to_regprocedure('private.online_slot_status(text,text,integer,text,bigint)') is not null
     or to_regprocedure('private.online_table_candidates(integer)') is not null
     or to_regprocedure('private.service_capacity_for_type(text,text,text,bigint)') is not null
     or to_regprocedure('private.dinner_physical_capacity()') is not null
     or to_regprocedure('public.admin_change_booking_type(bigint,jsonb,jsonb)') is not null
     or to_regprocedure('public.admin_release_booking_table(bigint)') is not null then
    raise exception 'Schema già parzialmente migrato: riesaminare il diff prima di applicare';
  end if;
  select jsonb_object_agg(group_id,capacity) into catalog from private.online_table_groups();
  if catalog <> '{"10+11":3,"12":2,"13+14":3,"15+16+17":6,"15+16":4,"17":2,"18+19":4,"18":2,"19":2,"20+21":4,"22":2,"23":2,"22+23":4}'::jsonb then
    raise exception 'Catalogo live diverso: fermare la migrazione';
  end if;
end $preflight$;

-- Solo il marcatore necessario per distinguere il rilascio esplicito.
alter table public.bookings add column if not exists table_released_at timestamptz;

create or replace function private.service_slot_at(day text, slot text, service text)
returns timestamptz language plpgsql stable security invoker set search_path='' as $$
declare d date;
begin
  if day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
     not pg_input_is_valid(day,'date') then return null; end if;
  d:=day::date;
  if service='normale' and slot ~ '^(19:(00|30)|20:(00|30)|21:(00|30)|22:(00|30))$' then
    return (d::text||' '||slot)::timestamp at time zone 'Europe/Rome';
  end if;
  if service='dopocena' and slot ~ '^(22:30|23:(00|30)|00:00)$' then
    return ((d+case when slot='00:00' then 1 else 0 end)::text||' '||slot)::timestamp at time zone 'Europe/Rome';
  end if;
  return null;
end $$;

create or replace function private.valid_service_slot(service text, slot text)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce((service='normale' and slot ~ '^(19:(00|30)|20:(00|30)|21:(00|30)|22:(00|30))$')
    or (service='dopocena' and slot ~ '^(22:30|23:(00|30)|00:00)$'),false)
$$;

create or replace function private.dinner_after_dinner_compatible(first_day text, first_time text, first_type text, second_day text, second_time text, second_type text)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce(first_day=second_day and
    ((first_type='normale' and second_type='dopocena' and
      private.service_slot_at(second_day,second_time,second_type)-private.service_slot_at(first_day,first_time,first_type)>=interval '120 minutes')
    or (second_type='normale' and first_type='dopocena' and
      private.service_slot_at(first_day,first_time,first_type)-private.service_slot_at(second_day,second_time,second_type)>=interval '120 minutes')),false)
$$;

create or replace function private.online_table_candidates(people integer)
returns table(group_id text, capacity integer, preference integer)
language sql stable security invoker set search_path='' as $$
  select g.group_id,g.capacity,(g.capacity-people) from private.online_table_groups() g
  where people between 1 and 6 and
    ((people in (1,2) and g.capacity=2) or (people=3 and g.capacity in (3,4))
      or (people=4 and g.capacity=4) or (people in (5,6) and g.capacity=6))
  order by 3,g.group_id
$$;

create or replace function private.dinner_physical_capacity()
returns integer language sql stable security invoker set search_path='' as $$
  select sum(capacity)::integer from private.online_table_groups()
    where group_id in ('10+11','12','13+14','15+16+17','18+19','20+21','22+23')
$$;

create or replace function private.physical_ids(groups text)
returns text[] language sql immutable security invoker set search_path='' as $$
  select coalesce(array_agg(btrim(id)) filter(where btrim(id)<>''),array[]::text[])
  from unnest(string_to_array(coalesce(groups,''),',')) g
  cross join lateral unnest(string_to_array(g,'+')) id
$$;

-- Cerca solo unità libere. Le assegnazioni già registrate non vengono mosse.
create or replace function private.choose_online_dinner_unit(day text, people integer, excluded bigint default null)
returns text language plpgsql stable security invoker set search_path='' as $$
declare option record; used text[]; groups text[];
begin
  select coalesce(array_agg(distinct pid),array[]::text[]) into used
    from public.bookings b cross join lateral unnest(private.physical_ids(b.tables)) pid
    where b.booking_date=day and b.status not in ('cancelled','no_show')
      and (excluded is null or b.id<>excluded);
  select coalesce(array_agg(grp),array[]::text[]) into groups
    from public.bookings b cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) grp
    where b.booking_date=day and b.status not in ('cancelled','no_show')
      and (excluded is null or b.id<>excluded) and b.booking_type='normale';
  for option in select * from private.online_table_candidates(people) loop
    if not private.physical_ids(option.group_id) && used
       and private.online_groups_compatible(groups||option.group_id)
       and private.fit_online_parties(
         (select coalesce(array_agg(party_size order by party_size desc),array[]::integer[])
          from public.bookings b where b.booking_date=day and b.booking_type='normale'
            and b.source='booking' and b.status not in ('cancelled','no_show')
            and coalesce(b.tables,'')='' and (excluded is null or b.id<>excluded)),
         used||private.physical_ids(option.group_id),groups||option.group_id) then
      return option.group_id;
    end if;
  end loop;
  return null;
end $$;

create or replace function private.service_capacity_for_type(day text, reference_time text, service_type text, exclude_id bigint default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare people bigint; physical integer; total integer; unused integer;
begin
  total:=case when service_type='normale' then private.dinner_physical_capacity() else 25 end;
  if private.service_slot_at(day,reference_time,service_type) is null then
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
    'people_reserved',people,'people_remaining',greatest(0,25-people),
    'physical_occupied_units',physical,'physical_remaining',case when service_type='normale' then greatest(0,total-physical) else null end,
    'remaining',case when service_type='normale' then least(greatest(0,25-people),greatest(0,total-physical)) else greatest(0,25-people) end,
    'verified',true);
end $$;

create or replace function private.service_capacity(day text, reference_time text, exclude_id bigint default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.service_capacity_for_type(day,reference_time,
    case when reference_time ~ '^(22:30|23:(00|30)|00:00)$' then 'dopocena' else 'normale' end,exclude_id)
$$;

create or replace function private.online_slot_status(day text, slot text, people integer, service text, exclude_id bigint default null)
returns text language plpgsql volatile security definer set search_path='' as $$
declare booked bigint;
begin
  if people not between 1 and 6 or private.service_slot_at(day,slot,service) is null then return 'unverified'; end if;
  if exists(select 1 from public.online_booking_closures where booking_date=day::date)
     or extract(isodow from day::date)=1 then return 'closed'; end if;
  if day::date>(now() at time zone 'Europe/Rome')::date+60
     or private.service_slot_at(day,slot,service)<now()+interval '30 minutes' then return 'past'; end if;
  select coalesce(sum(party_size),0) into booked from public.bookings b
    where b.booking_date=day and coalesce(b.booking_type,'normale')=service
      and b.status not in ('cancelled','no_show') and (exclude_id is null or b.id<>exclude_id);
  if booked+people>25 then return 'full'; end if;
  if service='normale' and private.choose_online_dinner_unit(day,people,exclude_id) is null then return 'full'; end if;
  return 'available';
end $$;

create or replace function private.online_day_status(day text, people integer, exclude_id bigint default null)
returns text language plpgsql volatile security invoker set search_path='' as $$
declare slot text; result text; booked bigint;
begin
  if people=0 then
    select coalesce(sum(party_size),0) into booked from public.bookings b
      where b.booking_date=day and coalesce(b.booking_type,'normale')='normale'
        and b.status not in ('cancelled','no_show') and (exclude_id is null or b.id<>exclude_id);
    return case when booked>=25 or private.choose_online_dinner_unit(day,1,exclude_id) is null then 'full' else 'available' end;
  end if;
  foreach slot in array array['19:00','19:30','20:00','20:30','21:00','21:30','22:00','22:30'] loop
    result:=private.online_slot_status(day,slot,people,'normale',exclude_id);
    if result in ('available','closed') then return result; end if;
  end loop;
  return 'full';
end $$;

-- I pendenti DOPOCENA non consumano tavoli CENA. Il guard online mantiene
-- comunque il proprio controllo sotto lock sul turno interessato.
create or replace function private.protect_pending_online_bookings()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('cancelled','no_show') or new.booking_type='dopocena' then return new; end if;
  if tg_op='UPDATE' and new.booking_date is not distinct from old.booking_date
     and new.booking_time is not distinct from old.booking_time
     and new.party_size is not distinct from old.party_size
     and new.tables is not distinct from old.tables
     and new.booking_type is not distinct from old.booking_type
     and (new.status is not distinct from old.status or old.status not in ('cancelled','no_show')) then return new; end if;
  if coalesce(auth.jwt()->'app_metadata'->>'role','')='admin' then return new; end if;
  if exists(select 1 from public.bookings b where b.booking_date=new.booking_date
       and b.source='booking' and b.booking_type='normale' and b.status not in ('cancelled','no_show')
       and coalesce(b.tables,'')='') and not private.pending_online_windows_fit(new.booking_date) then
    raise exception 'Nessuna combinazione compatibile per le prenotazioni online pendenti' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function private.pending_online_windows_fit(day text)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare parties integer[]; used text[]; groups text[];
begin
  select coalesce(array_agg(party_size order by party_size desc),array[]::integer[]) into parties
    from public.bookings where booking_date=day and booking_type='normale' and source='booking'
      and status not in ('cancelled','no_show') and coalesce(tables,'')='';
  select coalesce(array_agg(distinct pid),array[]::text[]) into used
    from public.bookings b cross join lateral unnest(private.physical_ids(b.tables)) pid
    where b.booking_date=day and b.status not in ('cancelled','no_show');
  select coalesce(array_agg(grp),array[]::text[]) into groups
    from public.bookings b cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) grp
    where b.booking_date=day and b.status not in ('cancelled','no_show') and b.booking_type='normale';
  return private.fit_online_parties(parties,used,groups);
end $$;

create or replace function private.fit_online_parties(parties integer[], used text[], groups text[], minimum_group text default '')
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare option record; ids text[];
begin
  if cardinality(parties)=0 then return true; end if;
  if cardinality(parties)>10 then return false; end if;
  for option in select * from private.online_table_candidates(parties[1]) c where c.group_id>minimum_group loop
    ids:=private.physical_ids(option.group_id);
    if not ids && used and private.online_groups_compatible(groups||option.group_id) then
      if private.fit_online_parties(parties[2:cardinality(parties)],used||ids,groups||option.group_id,
          case when parties[2]=parties[1] then option.group_id else '' end) then return true; end if;
    end if;
  end loop;
  return false;
end $$;

-- La definizione live della quota per turno resta attiva. Non ripristinare
-- la versione precedente che sommava CENA e DOPOCENA.

create or replace function private.prepare_booking()
returns trigger language plpgsql security definer set search_path='' as $$
declare administrator boolean:=coalesce(auth.jwt()->'app_metadata'->>'role'='admin',false);
  customer boolean:=current_setting('role',true)='authenticated' and not administrator;
  availability_change boolean; assigned text; dt timestamptz;
begin
  perform pg_advisory_xact_lock(734512);
  if new.source='staff' then new.source:='agenda'; end if;
  if new.source='ai' then new.source:='booking'; end if;
  if customer then
    if new.source<>'booking' or new.user_id is distinct from auth.uid() then
      raise exception 'Record non autorizzato' using errcode='42501';
    end if;
    if tg_op='INSERT' then
      new.status:='confirmed';new.tables:='';new.reminder_status:='skipped';
      new.reminder_attempts:=0;new.created_at:=now();new.consenso_ricordami:=false;
      new.consenso_data:=null;new.arrived_at:=null;new.marketing_visit_counted_at:=null;
    else
      if (to_jsonb(new)-array['name','email','phone','booking_date','booking_time','party_size','notes','status','updated_at'])
         is distinct from
         (to_jsonb(old)-array['name','email','phone','booking_date','booking_time','party_size','notes','status','updated_at']) then
        raise exception 'Campo riservato all’amministratore' using errcode='42501';
      end if;
      if old.status='cancelled' and new.status<>old.status then raise exception 'Prenotazione annullata'; end if;
    end if;
  end if;
  if tg_op='UPDATE' and old.status='arrived' and new.status='confirmed' then new.arrived_at:=null; end if;
  if tg_op='UPDATE' and coalesce(old.tables,'')<>'' and coalesce(new.tables,'')=''
     and old.booking_type='normale' and new.status='completed' then
    new.table_released_at:=now();
  end if;
  if coalesce(new.tables,'')<>'' then new.table_released_at:=null; end if;
  new.updated_at:=now();

  availability_change:=new.source='booking' and new.status='confirmed' and not administrator
    and coalesce(current_setting('makai.manual_admin_edit',true),'')<>'on' and
    (tg_op='INSERT' or new.booking_date is distinct from old.booking_date
     or new.booking_time is distinct from old.booking_time
     or new.party_size is distinct from old.party_size
     or new.booking_type is distinct from old.booking_type);
  if not availability_change then return new; end if;
  if tg_op='INSERT' then
    if new.privacy_accepted_at is null or new.privacy_version is distinct from '2026-10-12-online-v2' then
      raise exception 'Lettura informativa privacy obbligatoria' using errcode='22023';
    end if;
    new.status:='confirmed';new.tables:='';new.reminder_status:='skipped';
    new.consenso_ricordami:=false;new.consenso_data:=null;
  end if;
  dt:=private.service_slot_at(new.booking_date,new.booking_time,new.booking_type);
  if new.party_size not between 1 and 6 or dt is null then
    raise exception 'Data, orario o coperti non disponibili' using errcode='22023';
  end if;
  if length(btrim(coalesce(new.name,''))) not between 2 and 60
     or length(coalesce(new.notes,''))>300
     or coalesce(new.phone,'') !~ '^\+[1-9][0-9]{7,14}$'
     or length(coalesce(new.email,''))>120 then
    raise exception 'Contatti non validi' using errcode='22023';
  end if;
  if (select count(*) from public.bookings b where b.id<>new.id
      and b.status in ('confirmed','arrived')
      and regexp_replace(b.phone,'[^0-9]','','g')=regexp_replace(new.phone,'[^0-9]','','g')
      and private.service_slot_at(b.booking_date,b.booking_time,coalesce(b.booking_type,'normale'))>now())>=2 then
    raise exception 'Limite prenotazioni per telefono raggiunto' using errcode='P0001';
  end if;
  if private.online_slot_status(new.booking_date,new.booking_time,new.party_size,new.booking_type,new.id)<>'available' then
    raise exception 'Disponibilità cambiata: aggiorna il calendario o contatta il locale' using errcode='P0001';
  end if;
  if new.booking_type='dopocena' then
    new.tables:='';
  else
    assigned:=private.choose_online_dinner_unit(new.booking_date,new.party_size,new.id);
    if assigned is null then raise exception 'Tavolo non disponibile' using errcode='P0001'; end if;
    new.tables:=assigned;
  end if;
  return new;
end $$;

-- Il solo passaggio a completed non libera il tavolo: lo fa la RPC, svuotando
-- tables. Il trigger assegna una DOPOCENA in attesa solo dopo tale rilascio.
create or replace function public.admin_release_booking_table(booking_id bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.bookings%rowtype; saved public.bookings%rowtype;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(734512);
  select * into previous from public.bookings where id=booking_id for update;
  if not found then raise exception 'Prenotazione non trovata' using errcode='P0002'; end if;
  if previous.booking_type<>'normale' or previous.status not in ('confirmed','arrived','completed')
     or coalesce(previous.tables,'')='' then
    raise exception 'Nessun tavolo CENA da liberare' using errcode='22023';
  end if;
  update public.bookings set status='completed',tables='',table_released_at=now()
    where id=booking_id returning * into saved;
  return jsonb_build_object('booking',to_jsonb(saved));
end $$;

create or replace function private.handoff_released_dinner_table()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_id bigint; released_group text; capacity integer;
begin
  if tg_op<>'UPDATE' or old.booking_type<>'normale'
     or coalesce(old.tables,'')='' or coalesce(new.tables,'')<>''
     or new.status<>'completed' or new.table_released_at is null then return new; end if;
  perform pg_advisory_xact_lock(734512);
  for released_group in select btrim(value) from unnest(string_to_array(old.tables,',')) value loop
    select g.capacity into capacity from private.online_table_groups() g where g.group_id=released_group;
    if capacity is null then continue; end if;
    target_id:=null;
    select b.id into target_id from public.bookings b
      where b.booking_date=new.booking_date and b.booking_type='dopocena'
        and b.status='confirmed' and coalesce(b.tables,'')=''
        and b.party_size between 1 and capacity
        and private.dinner_after_dinner_compatible(old.booking_date,old.booking_time,'normale',
            b.booking_date,b.booking_time,'dopocena')
        and not exists(select 1 from public.bookings occupied
          where occupied.id not in (new.id,b.id) and occupied.booking_date=new.booking_date
            and occupied.status not in ('cancelled','no_show')
            and private.physical_ids(occupied.tables) && private.physical_ids(released_group))
      order by private.service_slot_at(b.booking_date,b.booking_time,'dopocena'),b.id limit 1;
    if target_id is not null then
      update public.bookings set tables=released_group where id=target_id;
    end if;
  end loop;
  return new;
end $$;
create trigger zzz_handoff_released_dinner_table after update of tables on public.bookings
for each row execute function private.handoff_released_dinner_table();

-- RPC ADMIN integrate dalle patch locali mirate.
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
  selected_groups text[];
  selected_physical_ids text[];
  manual_edit_guard text;
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
    if changes->key_name = 'null'::jsonb or jsonb_typeof(changes->key_name) <> 'string' then
      raise exception 'Valore non valido' using errcode = '22023';
    end if;
  end loop;
  if length(changes->>'tables') > 200 or
     (changes->>'tables' <> '' and changes->>'tables' !~ '^[1-9][0-9]*(\+[1-9][0-9]*)*(,[1-9][0-9]*(\+[1-9][0-9]*)*)*$') then
    raise exception 'Assegnazioni tavoli non valide' using errcode = '22023';
  end if;

  -- Tutti i writer devono rispettare questo lock prima di controllare conflitti.
  perform pg_advisory_xact_lock(734512);
  select * into previous_booking from public.bookings b where b.id = booking_id for update;
  if not found then raise exception 'Prenotazione non trovata o non accessibile' using errcode = 'P0002'; end if;
  if coalesce(previous_booking.status, 'confirmed') not in ('confirmed','arrived') then
    raise exception 'Prenotazione non assegnabile' using errcode = '22023';
  end if;
  previous_values := jsonb_build_object(
    'booking_date', previous_booking.booking_date, 'booking_time', previous_booking.booking_time,
    'party_size', previous_booking.party_size, 'tables', previous_booking.tables, 'notes', previous_booking.notes
  );
  if previous_values is distinct from expected then
    raise exception 'La prenotazione è cambiata nel frattempo. Aggiorna la pagina e riapri la modifica' using errcode = '40001';
  end if;
  if not exists (select 1 from jsonb_each(changes) c where c.value is distinct from previous_values->c.key) then
    raise exception 'Nessuna modifica da salvare' using errcode = '22023';
  end if;

  selected_tables := changes->>'tables';
  if selected_tables <> '' then
    selected_groups := string_to_array(selected_tables, ',');
    if exists (
      select 1 from unnest(selected_groups) selected(group_id)
      left join (values
        ('10+11',3),('12',2),('13+14',3),('15+16+17',6),('15+16',4),('17',2),
        ('18+19',4),('18',2),('19',2),('20+21',4),('22+23',4),('22',2),('23',2)
      ) as unit(group_id, physical_capacity) using (group_id)
      where unit.group_id is null
    ) then raise exception 'Assegnazione tavoli non configurata' using errcode = '22023'; end if;
    if cardinality(selected_groups) <> (select count(distinct g) from unnest(selected_groups) g) then
      raise exception 'Lo stesso gruppo tavoli non può essere indicato due volte' using errcode = '22023';
    end if;
    select array_agg(btrim(physical_id)) into selected_physical_ids
      from unnest(selected_groups) grouped_id
      cross join lateral unnest(string_to_array(grouped_id, '+')) physical_id;
    if cardinality(selected_physical_ids) <> (select count(distinct physical_id) from unnest(selected_physical_ids) physical_id) then
      raise exception 'Lo stesso tavolo fisico non può essere indicato in gruppi diversi' using errcode = '22023';
    end if;
    if not private.online_groups_compatible(selected_groups ||
      array(select btrim(grp) from public.bookings b
        cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) grp
        where b.id<>booking_id and b.booking_date=previous_booking.booking_date
          and b.status not in ('cancelled','no_show'))) then
      raise exception 'Configurazione fisica tavoli non disponibile' using errcode='22023';
    end if;
    -- Difesa nel RPC oltre al trigger: funziona anche con trigger ADMIN che
    -- disattivano l'ottimizzatore. Le prenotazioni completate restano occupanti.
    if exists (
      select 1 from public.bookings b
      cross join lateral unnest(string_to_array(coalesce(b.tables, ''), ',')) assigned_group
      cross join lateral unnest(string_to_array(btrim(assigned_group), '+')) physical_id
      where b.id <> booking_id and b.booking_date = previous_booking.booking_date
        and b.status not in ('cancelled','no_show')
        and btrim(physical_id) = any(selected_physical_ids)
    ) then raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa giornata' using errcode = '23505'; end if;
  end if;

  manual_edit_guard := coalesce(current_setting('makai.manual_admin_edit', true), '');
  perform set_config('makai.manual_admin_edit', 'on', true);
  update public.bookings b set tables = selected_tables
    where b.id = booking_id returning b.* into saved_booking;
  perform set_config('makai.manual_admin_edit', manual_edit_guard, true);
  if saved_booking.tables is distinct from selected_tables then
    raise exception 'Assegnazione manuale non salvata: un controllo ha modificato i tavoli' using errcode = '22023';
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
  selected_party_size integer;
  selected_groups text[];
  selected_physical_ids text[];
  selected_date text;
  selected_time text;
  date_value date;
  manual_edit_guard text;
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
    if key_name not in ('booking_date','booking_time','party_size','tables','notes') then
      raise exception 'Campo non modificabile' using errcode = '22023';
    end if;
    if changes->key_name = 'null'::jsonb then raise exception 'Valore non valido' using errcode = '22023'; end if;
    if key_name <> 'party_size' and jsonb_typeof(changes->key_name) <> 'string' then
      raise exception 'Tipo di valore non valido' using errcode = '22023';
    end if;
  end loop;
  if changes ? 'booking_date' then
    if changes->>'booking_date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data non valida' using errcode = '22023'; end if;
    begin date_value := (changes->>'booking_date')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Data non valida' using errcode = '22023';
    end;
    if to_char(date_value, 'YYYY-MM-DD') <> changes->>'booking_date' then raise exception 'Data non valida' using errcode = '22023'; end if;
  end if;
  if changes ? 'booking_time' and changes->>'booking_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Orario non valido' using errcode = '22023';
  end if;
  if changes ? 'party_size' then
    if jsonb_typeof(changes->'party_size') <> 'number'
       or changes->>'party_size' !~ '^[1-9][0-9]*$'
       or (changes->>'party_size')::numeric > 2147483647 then
      raise exception 'Numero persone non valido per il tipo intero della prenotazione' using errcode = '22023';
    end if;
  end if;
  if changes ? 'tables' and (length(changes->>'tables') > 200 or
     (changes->>'tables' <> '' and changes->>'tables' !~ '^[1-9][0-9]*(\+[1-9][0-9]*)*(,[1-9][0-9]*(\+[1-9][0-9]*)*)*$')) then
    raise exception 'Assegnazioni tavoli non valide' using errcode = '22023';
  end if;
  if changes ? 'notes' and length(changes->>'notes') > 300 then
    raise exception 'Note troppo lunghe: massimo 300 caratteri' using errcode = '22023';
  end if;

  if changes ?| array['booking_date','booking_time','party_size','tables'] then perform pg_advisory_xact_lock(734512); end if;
  select * into previous_booking from public.bookings b where b.id = booking_id for update;
  if not found then raise exception 'Prenotazione non trovata o non accessibile' using errcode = 'P0002'; end if;
  previous_values := jsonb_build_object(
    'booking_date', previous_booking.booking_date, 'booking_time', previous_booking.booking_time,
    'party_size', previous_booking.party_size, 'tables', previous_booking.tables, 'notes', previous_booking.notes
  );
  if previous_values is distinct from expected then
    raise exception 'La prenotazione è cambiata nel frattempo. Aggiorna la pagina e riapri la modifica' using errcode = '40001';
  end if;
  if not exists (select 1 from jsonb_each(changes) c where c.value is distinct from previous_values->c.key) then
    raise exception 'Nessuna modifica da salvare' using errcode = '22023';
  end if;

  selected_tables := case when changes ? 'tables' then changes->>'tables' else previous_booking.tables end;
  selected_party_size := case when changes ? 'party_size' then (changes->>'party_size')::integer else previous_booking.party_size end;
  selected_date := case when changes ? 'booking_date' then changes->>'booking_date' else previous_booking.booking_date end;
  selected_time := case when changes ? 'booking_time' then changes->>'booking_time' else previous_booking.booking_time end;
  if changes ?| array['tables','booking_date','booking_time'] and coalesce(selected_tables,'') <> '' then
    selected_groups := string_to_array(selected_tables, ',');
    if exists (
      select 1 from unnest(selected_groups) selected(group_id)
      left join (values
        ('10+11',3),('12',2),('13+14',3),('15+16+17',6),('15+16',4),('17',2),
        ('18+19',4),('18',2),('19',2),('20+21',4),('22+23',4),('22',2),('23',2)
      ) as unit(group_id, physical_capacity) using (group_id)
      where unit.group_id is null
    ) then
      raise exception 'Assegnazione tavoli non configurata' using errcode = '22023';
    end if;
    if cardinality(selected_groups) <> (select count(distinct g) from unnest(selected_groups) g) then
      raise exception 'Lo stesso gruppo tavoli non può essere indicato due volte' using errcode = '22023';
    end if;
    select array_agg(btrim(physical_id)) into selected_physical_ids from unnest(selected_groups) grouped_id
      cross join lateral unnest(string_to_array(grouped_id, '+')) physical_id;
    if cardinality(selected_physical_ids) <> (select count(distinct p) from unnest(selected_physical_ids) p) then
      raise exception 'Lo stesso tavolo fisico non può essere indicato in gruppi diversi' using errcode = '22023';
    end if;
    if not private.online_groups_compatible(selected_groups ||
      array(select btrim(grp) from public.bookings b
        cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) grp
        where b.id<>booking_id and b.booking_date=selected_date
          and b.status not in ('cancelled','no_show'))) then
      raise exception 'Configurazione fisica tavoli non disponibile' using errcode='22023';
    end if;
    if exists (
      select 1 from public.bookings b
      cross join lateral unnest(string_to_array(coalesce(b.tables, ''), ',')) assigned_group
      cross join lateral unnest(string_to_array(btrim(assigned_group), '+')) physical_id
      where b.id <> booking_id and b.booking_date = selected_date
        and b.status not in ('cancelled','no_show')
        and btrim(physical_id) = any(selected_physical_ids)
    ) then raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa giornata' using errcode = '23505'; end if;
  end if;

  manual_edit_guard := coalesce(current_setting('makai.manual_admin_edit', true), '');
  perform set_config('makai.manual_admin_edit', 'on', true);
  update public.bookings b set
    booking_date = case when changes ? 'booking_date' then changes->>'booking_date' else b.booking_date end,
    booking_time = case when changes ? 'booking_time' then changes->>'booking_time' else b.booking_time end,
    party_size = case when changes ? 'party_size' then selected_party_size else b.party_size end,
    tables = selected_tables,
    notes = case when changes ? 'notes' then changes->>'notes' else b.notes end
  where b.id = booking_id returning b.* into saved_booking;
  perform set_config('makai.manual_admin_edit', manual_edit_guard, true);
  if saved_booking.tables is distinct from selected_tables then
    raise exception 'Assegnazione manuale non salvata: un controllo ha modificato i tavoli' using errcode = '22023';
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


create or replace function public.admin_change_booking_type(
  booking_id bigint, changes jsonb, expected jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  previous_booking public.bookings%rowtype;
  saved_booking public.bookings%rowtype;
  previous_values jsonb;
  key_name text;
  target_type text;
  target_date text;
  target_time text;
  target_party integer;
  target_notes text;
  target_tables text;
  manual_edit_guard text;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode = '42501';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' or coalesce(changes->>'booking_type','') not in ('normale','dopocena') then
    raise exception 'Turno non valido' using errcode = '22023';
  end if;
  if expected is null or jsonb_typeof(expected) <> 'object' then
    raise exception 'Dati originali mancanti: aggiorna la pagina' using errcode = '22023';
  end if;
  for key_name in select jsonb_object_keys(changes) loop
    if key_name not in ('booking_type','booking_date','booking_time','party_size','tables','notes') then
      raise exception 'Campo non modificabile' using errcode = '22023';
    end if;
    if changes->key_name = 'null'::jsonb or
      (key_name = 'party_size' and jsonb_typeof(changes->key_name) <> 'number') or
      (key_name <> 'party_size' and jsonb_typeof(changes->key_name) <> 'string') then
      raise exception 'Valore non valido' using errcode = '22023';
    end if;
  end loop;

  -- Serializza con i writer delle assegnazioni e blocca la riga da modificare.
  perform pg_advisory_xact_lock(734512);
  select * into previous_booking from public.bookings b where b.id = booking_id for update;
  if not found then raise exception 'Prenotazione non trovata o non accessibile' using errcode = 'P0002'; end if;
  if previous_booking.status <> 'confirmed' then
    raise exception 'Il cambio turno è disponibile solo per prenotazioni confermate' using errcode = '22023';
  end if;
  previous_values := jsonb_build_object(
    'booking_type', coalesce(previous_booking.booking_type,'normale'),
    'booking_date', previous_booking.booking_date,
    'booking_time', previous_booking.booking_time,
    'party_size', previous_booking.party_size,
    'tables', previous_booking.tables,
    'notes', previous_booking.notes
  );
  if previous_values is distinct from expected then
    raise exception 'La prenotazione è cambiata nel frattempo. Aggiorna la pagina e riapri la modifica' using errcode = '40001';
  end if;
  target_type := changes->>'booking_type';
  if target_type is not distinct from coalesce(previous_booking.booking_type,'normale') then
    raise exception 'Il turno è già quello selezionato' using errcode = '22023';
  end if;
  target_date := case when changes ? 'booking_date' then changes->>'booking_date' else previous_booking.booking_date end;
  target_time := case when changes ? 'booking_time' then changes->>'booking_time' else previous_booking.booking_time end;
  target_notes := case when changes ? 'notes' then changes->>'notes' else previous_booking.notes end;
  if target_date !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Data non valida' using errcode = '22023';
  end if;
  begin
    if to_char(target_date::date,'YYYY-MM-DD') <> target_date then
      raise exception 'Data non valida' using errcode = '22023';
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Data non valida' using errcode = '22023';
  end;
  if not private.valid_service_slot(target_type,target_time)
     or private.booking_scheduled_at(target_date,target_time) is null then
    raise exception 'Orario non valido per il turno selezionato' using errcode = '22023';
  end if;
  if changes ? 'party_size' and (changes->>'party_size' !~ '^[1-9][0-9]*$'
      or (changes->>'party_size')::numeric > 2147483647) then
    raise exception 'Numero persone non valido' using errcode = '22023';
  end if;
  target_party := case when changes ? 'party_size' then (changes->>'party_size')::integer else previous_booking.party_size end;
  if target_party is null or target_party < 1 then
    raise exception 'Numero persone non compatibile con il turno' using errcode = '22023';
  end if;
  if length(coalesce(target_notes,'')) > 300 then
    raise exception 'Note troppo lunghe: massimo 300 caratteri' using errcode = '22023';
  end if;

  if target_type = 'dopocena' then
    if changes ? 'tables' and changes->>'tables' <> '' then
      raise exception 'Il DOPOCENA inizia senza tavolo' using errcode = '22023';
    end if;
    target_tables := '';
  else
    target_tables := changes->>'tables';
    if target_tables is null or not exists (
      select 1 from private.online_table_groups() g where g.group_id = target_tables
    ) then
      raise exception 'Seleziona un’unità tavolo CENA valida' using errcode = '22023';
    end if;
    -- Nessun riuso implicito per orario o turno: un tavolo assegnato a
    -- un'altra prenotazione resta occupato fino alla liberazione esplicita.
    if exists (
      select 1 from public.bookings b where b.id <> booking_id and b.booking_date = target_date
        and b.status not in ('cancelled','no_show') and coalesce(b.tables,'') <> ''
        and private.physical_ids(b.tables) && private.physical_ids(target_tables)
    ) then
      raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa giornata' using errcode = '23505';
    end if;
    if not private.online_groups_compatible(array_prepend(target_tables,
      array(select group_id from public.bookings b
        cross join lateral unnest(string_to_array(coalesce(b.tables,''),',')) group_id
        where b.id <> booking_id and b.booking_date = target_date
          and b.booking_type = 'normale' and b.status not in ('cancelled','no_show'))
    )) then
      raise exception 'Configurazione fisica tavoli non disponibile' using errcode = '22023';
    end if;
  end if;

  manual_edit_guard := coalesce(current_setting('makai.manual_admin_edit',true),'');
  perform set_config('makai.manual_admin_edit','on',true);
  update public.bookings b set
    booking_type = target_type, booking_date = target_date,
    booking_time = target_time, party_size = target_party,
    tables = target_tables, notes = target_notes
  where b.id = booking_id returning b.* into saved_booking;
  if target_type = 'dopocena' and saved_booking.table_released_at is not null then
    -- Il trigger marca il rilascio del vecchio tavolo CENA. La nuova
    -- prenotazione DOPOCENA senza tavolo deve però restare nella quota 25.
    update public.bookings b set table_released_at = null
      where b.id = booking_id returning b.* into saved_booking;
  end if;
  perform set_config('makai.manual_admin_edit',manual_edit_guard,true);
  if saved_booking.booking_type is distinct from target_type or
     saved_booking.booking_date is distinct from target_date or
     saved_booking.booking_time is distinct from target_time or
     saved_booking.party_size is distinct from target_party or
     saved_booking.tables is distinct from target_tables or
     saved_booking.status is distinct from previous_booking.status then
    raise exception 'Cambio turno non salvato: un controllo ha modificato la prenotazione' using errcode = '22023';
  end if;
  return jsonb_build_object('booking',jsonb_build_object(
    'id',saved_booking.id,'booking_type',saved_booking.booking_type,
    'booking_date',saved_booking.booking_date,'booking_time',saved_booking.booking_time,
    'party_size',saved_booking.party_size,'tables',saved_booking.tables,
    'notes',saved_booking.notes,'status',saved_booking.status
  ));
end;
$$;


revoke all on function public.admin_assign_booking_tables(bigint,jsonb,jsonb) from public,anon;
revoke all on function public.admin_update_booking(bigint,jsonb,jsonb) from public,anon;
revoke all on function public.admin_change_booking_type(bigint,jsonb,jsonb) from public,anon;
revoke all on function public.admin_release_booking_table(bigint) from public,anon;
grant execute on function public.admin_assign_booking_tables(bigint,jsonb,jsonb),
  public.admin_update_booking(bigint,jsonb,jsonb),
  public.admin_change_booking_type(bigint,jsonb,jsonb),
  public.admin_release_booking_table(bigint) to authenticated;
revoke all on function private.service_slot_at(text,text,text),
  private.valid_service_slot(text,text),
  private.dinner_after_dinner_compatible(text,text,text,text,text,text),
  private.online_table_candidates(integer),private.dinner_physical_capacity(),
  private.physical_ids(text),private.choose_online_dinner_unit(text,integer,bigint),
  private.service_capacity_for_type(text,text,text,bigint),
  private.online_slot_status(text,text,integer,text,bigint),
  private.handoff_released_dinner_table() from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.online_slot_status(text,text,integer,text,bigint) to service_role;
notify pgrst, 'reload schema';

-- ROLLBACK OPERATIVO (richiede dump pre-applicazione delle definizioni/ACL):
-- 1. Errore prima del COMMIT: ROLLBACK automatico dell'intera transazione.
-- 2. Dopo COMMIT e PRIMA di traffico nuovo: fermare i writer; BEGIN;
--    SELECT pg_advisory_xact_lock(734512); DROP TRIGGER
--    zzz_handoff_released_dinner_table ON public.bookings; ripristinare con
--    CREATE OR REPLACE le definizioni pre-applicazione di prepare_booking,
--    protect_pending_online_bookings, pending_online_windows_fit,
--    fit_online_parties, online_day_status, service_capacity,
--    admin_assign_booking_tables e admin_update_booking. Ripristinare anche
--    i loro GRANT/REVOKE e l'USAGE precedente di private.
-- 3. Eliminare con DROP FUNCTION, senza CASCADE, le nuove RPC e helper solo
--    dopo aver ripristinato le funzioni dipendenti; controllare RLS, trigger,
--    ACL, catalogo e schema migrations; COMMIT. Conservare table_released_at
--    nullable e tutte le prenotazioni. Le migrazioni 20261013115504 e
--    20261013141346 non vanno annullate. Dopo traffico nuovo serve una
--    correzione in avanti: il vecchio prepare_booking non interpreta i nuovi
--    record DOPOCENA online. Mai ripristinare il dump dei dati sul live.

commit;
