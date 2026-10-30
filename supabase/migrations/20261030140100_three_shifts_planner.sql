-- Tre turni senza sotto orari: planner e liste d'attesa.
-- Seconda parte della migrazione 20261030140000_three_shifts.
-- Nessun backfill: le prenotazioni storiche restano invariate.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

CREATE OR REPLACE FUNCTION private.online_day_status(day text, people integer, exclude_id bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  slot text;
  result text;
  p integer;
BEGIN
  IF people = 0 THEN
    FOR p IN 1..6 LOOP
      FOREACH slot IN ARRAY ARRAY['19:00','21:30'] LOOP
        result := private.online_slot_status(day, slot, p, 'normale', exclude_id);
        IF result = 'available' THEN RETURN 'available'; END IF;
        IF result = 'closed' THEN RETURN 'closed'; END IF;
      END LOOP;
    END LOOP;
    RETURN 'full';
  END IF;

  FOREACH slot IN ARRAY ARRAY['19:00','21:30'] LOOP
    result := private.online_slot_status(day, slot, people, 'normale', exclude_id);
    IF result IN ('available','closed') THEN RETURN result; END IF;
  END LOOP;
  RETURN 'full';
END;
$function$;

CREATE OR REPLACE FUNCTION private.process_waitlist_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare selected_date date; created_booking public.bookings%rowtype; saved jsonb;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'Accesso riservato allo staff' using errcode='42501'; end if;
  if tg_op='INSERT' then
    new.name:=btrim(new.name); new.phone:=btrim(new.phone); new.email:=lower(btrim(new.email)); new.notes:=btrim(new.notes);
    if length(new.name) not between 2 and 60 then raise exception 'Nome non valido' using errcode='22023'; end if;
    if new.phone='' and new.email='' then raise exception 'Inserisci almeno telefono o email' using errcode='22023'; end if;
    if new.phone<>'' and new.phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Telefono non valido' using errcode='22023'; end if;
    if new.email<>'' and (length(new.email)>120 or new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Email non valida' using errcode='22023'; end if;
    if new.booking_date !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(new.booking_date,'date') then raise exception 'Data non valida' using errcode='22023'; end if;
    selected_date:=new.booking_date::date;
    if selected_date<(now() at time zone 'Europe/Rome')::date or selected_date>(now() at time zone 'Europe/Rome')::date+60 or extract(isodow from selected_date)=1 then raise exception 'Data non disponibile' using errcode='22023'; end if;
    if new.booking_time !~ '^(19:00|21:30)$' then raise exception 'Ora non valida' using errcode='22023'; end if;
    if new.party_size not between 1 and 6 or length(new.notes)>300 then raise exception 'Persone o note non valide' using errcode='22023'; end if;
    new.status:='WAITING'; new.booking_id:=null; new.conversion_table:=null;
    new.created_at:=now(); new.updated_at:=now(); new.created_by:=auth.uid();
  else
    if old.status not in ('WAITING','CONTACTED') or new.status not in ('CONTACTED','CONVERTED','CANCELLED') or new.status=old.status then raise exception 'Stato cambiato o voce già gestita' using errcode='40001'; end if;
    if (to_jsonb(new)-array['status','booking_id','conversion_table','updated_at']) is distinct from (to_jsonb(old)-array['status','booking_id','conversion_table','updated_at']) then raise exception 'Dati lista d’attesa immutabili' using errcode='22023'; end if;
    if new.booking_id is distinct from old.booking_id then raise exception 'Collegamento prenotazione riservato alla conversione' using errcode='22023'; end if;
    if new.status='CONVERTED' then
      if coalesce(new.conversion_table,'')='' then raise exception 'Scegli un tavolo disponibile' using errcode='22023'; end if;
      perform pg_advisory_xact_lock(734512);
      -- Inserimento e modifica avvengono nella stessa transazione. La RPC esistente
      -- ricontrolla date/orari/capienza e lascia attivi i trigger di disponibilità.
      insert into public.bookings(name,phone,email,booking_date,booking_time,party_size,notes,tables,status,source,reminder_status,booking_type)
        values(old.name,old.phone,old.email,old.booking_date,old.booking_time,old.party_size,old.notes,'','confirmed','agenda','skipped','normale') returning * into created_booking;
      saved:=public.admin_update_booking(created_booking.id,jsonb_build_object('tables',new.conversion_table),
        jsonb_build_object('booking_date',created_booking.booking_date,'booking_time',created_booking.booking_time,'party_size',created_booking.party_size,'tables',created_booking.tables,'notes',created_booking.notes));
      new.booking_id:=created_booking.id;
      insert into public.booking_history(booking_id,action,old_data,new_data)
        values(new.booking_id,'waitlist_converted','{}',jsonb_build_object('waitlist_id',new.id,'tables',new.conversion_table));
    elsif new.conversion_table is distinct from old.conversion_table then
      raise exception 'Tavolo riservato alla conversione' using errcode='22023';
    end if;
    new.updated_at:=now();
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_booking_request_alternatives(request_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
    raise exception 'Accesso riservato allo staff' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('booking_date',candidate.day_text,
    'booking_time',candidate.slot,'party_size',candidate.people)
    order by candidate.day_text,candidate.slot),'[]'::jsonb) into result
  from (
    select to_char(days.day_value,'YYYY-MM-DD') as day_text, slots.slot,
      case when r.request_type='persone' then (r.requested_value::text)::integer else b.party_size end as people
    from public.booking_requests r join public.bookings b on b.id=r.booking_id
    cross join lateral generate_series(
      case when r.request_type='data' then (r.requested_value #>> '{}')::date else b.booking_date::date end,
      case when r.request_type='data' then (r.requested_value #>> '{}')::date+7 else b.booking_date::date+7 end,
      interval '1 day') as days(day_value)
    cross join (values ('19:00'),('21:30')) slots(slot)
    where r.id=request_id and r.status='pending' and r.request_type in ('data','ora','persone')
      and b.booking_type='normale'
      and private.online_slot_status(to_char(days.day_value,'YYYY-MM-DD'),slots.slot,
        case when r.request_type='persone' then (r.requested_value::text)::integer else b.party_size end,
        b.booking_type,b.id)='available'
    order by days.day_value,slots.slot limit 10
  ) candidate;
  return result;
end $function$;

commit;
