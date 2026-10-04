-- Gestione stati prenotazioni. Eseguire manualmente nel SQL Editor Supabase.
-- Non elimina, ricrea o aggiorna prenotazioni durante l'esecuzione.
-- Mantiene i trigger, le policy RLS e i valori minuscoli esistenti.
begin;

-- Se la tabella è occupata, interrompe senza lasciare modifiche parziali.
set local lock_timeout = '5s';

-- Compatibilità anche con uno schema privo della colonna status.
alter table public.bookings
  add column if not exists status text not null default 'confirmed';

alter table public.bookings
  alter column status set default 'confirmed';

-- Il nuovo vincolo conserva confirmed/cancelled e aggiunge gli altri stati.
-- Se esistono valori incompatibili, la transazione fallisce senza convertirli.
alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status in ('confirmed', 'arrived', 'completed', 'cancelled', 'no_show'));

-- API database usata dal selettore ADMIN. Rispetta le policy RLS esistenti.
-- Ogni chiamata modifica soltanto status; i trigger esistenti restano attivi.
create or replace function public.admin_set_booking_status(
  booking_id bigint,
  booking_status text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_status text;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore'
      using errcode = '42501';
  end if;

  if booking_status is null or booking_status not in (
    'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'
  ) then
    raise exception 'Stato non valido' using errcode = '22023';
  end if;

  update public.bookings as b
    set status = booking_status
    where b.id = booking_id
    returning b.status into saved_status;

  if not found then
    raise exception 'Prenotazione non trovata o non accessibile'
      using errcode = 'P0002';
  end if;

  return saved_status;
end;
$$;

revoke all on function public.admin_set_booking_status(bigint, text)
  from public, anon;
grant execute on function public.admin_set_booking_status(bigint, text)
  to authenticated;

-- Rende disponibile la nuova RPC alla Data API dopo il commit.
notify pgrst, 'reload schema';

commit;
