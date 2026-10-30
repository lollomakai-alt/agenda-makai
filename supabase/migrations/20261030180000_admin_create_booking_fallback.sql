-- Fallback controllato per la creazione manuale di una prenotazione CENA.
-- Usata dal client Agenda solo quando il Backend comune non e' raggiungibile.
-- Richiede la migrazione 1B (private.valid_service_slot_for_day).
--
-- Nessuna scrittura diretta alle tabelle: la funzione e' SECURITY DEFINER,
-- riservata al ruolo admin, e lascia al trigger 40 coperti il limite di sala.

begin;

create or replace function public.admin_create_agenda_booking(
  p_name text,
  p_phone text,
  p_email text,
  p_date text,
  p_time text,
  p_party_size integer,
  p_notes text,
  p_booking_type text default 'normale'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  saved public.bookings%rowtype;
  slot text;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode = '42501';
  end if;
  if p_booking_type not in ('normale', 'dopocena') then
    raise exception 'Turno non valido' using errcode = '22023';
  end if;
  if coalesce(p_name, '') = '' or length(p_name) > 60 then
    raise exception 'Nome non valido' using errcode = '22023';
  end if;
  if p_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or p_time !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' then
    raise exception 'Data o ora non valide' using errcode = '22023';
  end if;
  if not private.valid_service_slot_for_day(p_date, p_booking_type, left(p_time, 5)) then
    raise exception 'Orario non disponibile per il turno selezionato' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(734512);

  insert into public.bookings (
    name, email, phone, booking_date, booking_time, party_size, notes,
    tables, status, source, reminder_status, booking_type
  ) values (
    btrim(p_name), coalesce(p_email, ''), coalesce(p_phone, ''), p_date,
    left(p_time, 5), p_party_size, coalesce(p_notes, ''),
    '', 'confirmed', 'agenda', 'skipped', p_booking_type
  )
  returning * into saved;

  return to_jsonb(saved);
end;
$function$;

revoke all on function public.admin_create_agenda_booking(text, text, text, text, text, integer, text, text) from public, anon;
grant execute on function public.admin_create_agenda_booking(text, text, text, text, text, integer, text, text) to authenticated;

commit;
