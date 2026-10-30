-- Ripristino del tavolo dopo una liberazione (annulla "Completata").
--
-- La funzione esiste in supabase/complete-booking-system.sql ma non risulta
-- applicata al database Agenda di produzione al 2026-10-30. Il Backend 1D la
-- usa per l'undo dello stato "completed"; senza questa funzione il ripristino
-- restituisce un errore esplicito.
--
-- Eseguire sul DB Agenda dopo la migrazione 1B.

begin;

create or replace function public.admin_restore_released_table(booking_id bigint, previous_tables text)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare b public.bookings%rowtype;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato allo staff' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(734512);
  select * into b from public.bookings bookings
    where id = booking_id and status = 'completed' and tables = ''
    for update;
  if b.id is null then
    raise exception 'Prenotazione cambiata: impossibile annullare' using errcode = '40001';
  end if;
  if exists(
    select 1 from public.bookings other
    where other.id <> booking_id
      and other.booking_date = b.booking_date
      and other.status not in ('cancelled', 'no_show')
      and string_to_array(replace(other.tables, '+', ','), ',')
          && string_to_array(replace(previous_tables, '+', ','), ',')
  ) then
    raise exception 'Tavolo già riassegnato: impossibile annullare la liberazione' using errcode = '23505';
  end if;
  update public.bookings bookings
    set status = 'arrived', tables = previous_tables
    where id = booking_id
    returning * into b;
  return jsonb_build_object('booking_id', b.id, 'status', b.status, 'tables', b.tables, 'history_error', null);
end;
$function$;

revoke all on function public.admin_restore_released_table(bigint, text) from public, anon;
grant execute on function public.admin_restore_released_table(bigint, text) to authenticated;

commit;
