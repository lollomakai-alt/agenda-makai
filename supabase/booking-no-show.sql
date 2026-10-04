-- Regola no-show manuale. Da applicare manualmente; non modifica record.
-- Riutilizza le RPC degli stati e il trigger booking_history esistenti.
begin;
set local lock_timeout = '5s';

create or replace function private.validate_manual_no_show()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare scheduled_at timestamptz;
begin
  if old.status in ('cancelled', 'completed') then
    raise exception 'Una prenotazione cancellata o completata non può diventare No-show'
      using errcode = '22023';
  end if;
  if new.booking_date is null or new.booking_time is null
     or new.booking_date !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$'
     or new.booking_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception 'Data o orario non validi: impossibile verificare i 30 minuti'
      using errcode = '22023';
  end if;
  begin
    scheduled_at := (new.booking_date || ' ' || new.booking_time)::timestamp at time zone 'Europe/Rome';
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Data o orario non validi: impossibile verificare i 30 minuti'
      using errcode = '22023';
  end;
  if clock_timestamp() < scheduled_at + interval '30 minutes' then
    raise exception 'No-show non consentito: devono essere trascorsi almeno 30 minuti dall’orario previsto della prenotazione (Europe/Rome)'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_manual_no_show() from public, anon, authenticated;

drop trigger if exists validate_manual_no_show on public.bookings;
create trigger validate_manual_no_show before update of status on public.bookings
  for each row when (new.status = 'no_show' and old.status is distinct from new.status)
  execute function private.validate_manual_no_show();

-- Mantiene firma e contratto della RPC esistente.
-- Per no_show blocca la riga e restituisce subito se è già no_show:
-- nessun UPDATE, nessun nuovo evento nello storico.
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
revoke all on function public.admin_set_booking_status(bigint, text) from public, anon;
grant execute on function public.admin_set_booking_status(bigint, text) to authenticated;
notify pgrst, 'reload schema';

commit;
