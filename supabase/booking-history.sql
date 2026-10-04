-- Storico persistente ADMIN. Da applicare manualmente dopo booking-status.sql.
-- Usa public.booking_history esistente; non elimina o ricrea dati.
begin;
set local lock_timeout = '5s';

-- L'interfaccia può leggere e aggiungere eventi, mai modificarli/eliminarli.
alter table public.booking_history enable row level security;
revoke all on public.booking_history from public, anon, authenticated;
grant select, insert on public.booking_history to authenticated;
drop policy if exists admin_history_select on public.booking_history;
create policy admin_history_select on public.booking_history for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin');
drop policy if exists admin_history_insert on public.booking_history;
create policy admin_history_insert on public.booking_history for insert to authenticated
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'admin');

-- id è già identity: concede soltanto l'uso della sequenza esistente.
do $$
declare history_sequence text;
begin
  history_sequence := pg_get_serial_sequence('public.booking_history', 'id');
  if history_sequence is not null then
    execute format('grant usage on sequence %s to authenticated', history_sequence);
  end if;
end;
$$;

create index if not exists booking_history_booking_created_idx
  on public.booking_history (booking_id, created_at desc, id desc);

-- AFTER UPDATE: OLD/NEW provengono dal database, inclusi i trigger precedenti.
-- La whitelist evita di archiviare contatti, credenziali o l'intero record.
create or replace function private.record_admin_booking_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  previous_values jsonb;
  current_values jsonb;
  previous_changes jsonb := '{}'::jsonb;
  current_changes jsonb := '{}'::jsonb;
  field_name text;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    return new;
  end if;

  previous_values := jsonb_build_object(
    'status', old.status, 'booking_date', old.booking_date,
    'booking_time', old.booking_time, 'party_size', old.party_size,
    'tables', old.tables, 'notes', old.notes
  );
  current_values := jsonb_build_object(
    'status', new.status, 'booking_date', new.booking_date,
    'booking_time', new.booking_time, 'party_size', new.party_size,
    'tables', new.tables, 'notes', new.notes
  );

  foreach field_name in array array[
    'status', 'booking_date', 'booking_time', 'party_size', 'tables', 'notes'
  ] loop
    if previous_values->field_name is distinct from current_values->field_name then
      previous_changes := previous_changes || jsonb_build_object(field_name, previous_values->field_name);
      current_changes := current_changes || jsonb_build_object(field_name, current_values->field_name);
    end if;
  end loop;

  -- Nessun evento per salvataggi senza cambiamenti o campi fuori scope.
  if previous_changes = '{}'::jsonb then return new; end if;

  insert into public.booking_history (booking_id, action, old_data, new_data)
    values (new.id,
      case when previous_changes = jsonb_build_object('status', previous_values->'status')
        then 'status_changed' else 'booking_updated' end,
      previous_changes, current_changes);
  return new;
end;
$$;
revoke all on function private.record_admin_booking_history() from public, anon, authenticated;

drop trigger if exists record_admin_booking_history on public.bookings;
create trigger record_admin_booking_history after update on public.bookings
  for each row execute function private.record_admin_booking_history();

-- Aggiornamento e storico restano nella stessa transazione: se lo storico fallisce,
-- anche il cambio stato viene annullato.
create or replace function public.admin_set_booking_status_with_history(
  booking_id bigint, booking_status text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved_status text;
begin
  saved_status := public.admin_set_booking_status(booking_id, booking_status);
  return jsonb_build_object('booking_id', booking_id, 'status', saved_status);
end;
$$;
revoke all on function public.admin_set_booking_status_with_history(bigint, text) from public, anon;
grant execute on function public.admin_set_booking_status_with_history(bigint, text) to authenticated;
notify pgrst, 'reload schema';
commit;
