-- Activity log ADMIN. Applicare dopo booking-history.sql e waitlist.sql.
-- Estende gli storici esistenti senza ricreare o migrare via i dati.
begin;
set local lock_timeout = '5s';

alter table public.booking_history
  alter column booking_id drop not null;
alter table public.booking_history
  add column if not exists actor_id uuid;
create index if not exists booking_history_created_idx
  on public.booking_history (created_at desc, id desc);
grant select on public.booking_history to authenticated;
drop policy if exists admin_history_select on public.booking_history;
create policy admin_history_select on public.booking_history for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin');

-- Record only essential, non-contact fields. The actor comes from the verified ADMIN JWT.
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

  if tg_op = 'INSERT' then
    insert into public.booking_history (booking_id, action, old_data, new_data, actor_id)
      values (new.id, 'booking_created', '{}'::jsonb,
        jsonb_build_object('booking_date', new.booking_date, 'booking_time', new.booking_time,
          'party_size', new.party_size, 'tables', new.tables, 'status', new.status,
          'booking_type', new.booking_type), auth.uid());
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
  if previous_changes = '{}'::jsonb then return new; end if;

  insert into public.booking_history (booking_id, action, old_data, new_data, actor_id)
    values (new.id,
      case when previous_changes = jsonb_build_object('status', previous_values->'status')
        then 'status_changed' else 'booking_updated' end,
      previous_changes, current_changes, auth.uid());
  return new;
end;
$$;
revoke all on function private.record_admin_booking_history() from public, anon, authenticated;
drop trigger if exists record_admin_booking_history on public.bookings;
create trigger record_admin_booking_history after insert or update on public.bookings
  for each row execute function private.record_admin_booking_history();

-- The external booking backend does not forward the admin JWT to PostgreSQL.
-- The UI calls this after a confirmed manual booking create; retries are idempotent.
create or replace function public.admin_record_booking_creation(p_booking_id bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved public.bookings%rowtype;
  history_entry public.booking_history%rowtype;
begin
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Accesso riservato all’amministratore' using errcode = '42501';
  end if;
  select * into saved from public.bookings where id = p_booking_id;
  if not found then raise exception 'Prenotazione non trovata' using errcode = 'P0002'; end if;
  select * into history_entry from public.booking_history
    where booking_id = p_booking_id and action = 'booking_created' and actor_id = auth.uid()
    order by id desc limit 1;
  if not found then
    insert into public.booking_history (booking_id, action, old_data, new_data, actor_id)
      values (saved.id, 'booking_created', '{}'::jsonb,
        jsonb_build_object('booking_date', saved.booking_date, 'booking_time', saved.booking_time,
          'party_size', saved.party_size, 'tables', saved.tables, 'status', saved.status,
          'booking_type', saved.booking_type), auth.uid())
      returning * into history_entry;
  end if;
  return to_jsonb(history_entry);
end;
$$;
revoke all on function public.admin_record_booking_creation(bigint) from public, anon;
grant execute on function public.admin_record_booking_creation(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;