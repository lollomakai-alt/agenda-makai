-- Regola ADMIN: lo stesso tavolo non può essere assegnato a due prenotazioni
-- della stessa data. Nessuna durata/riassegnazione/lista d'attesa.
-- Configurazione invariata: TABLES del backend e prepare_booking, tavoli 10–23.
-- Da applicare manualmente. Nessuna prenotazione esistente viene modificata.
begin;
set local lock_timeout = '5s';

-- Tutti gli inserimenti/aggiornamenti si coordinano con il lock già esistente.
create or replace function private.lock_daily_table_assignment()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(734512);
  return new;
end;
$$;
revoke all on function private.lock_daily_table_assignment() from public, anon, authenticated;
drop trigger if exists a_lock_daily_table_assignment on public.bookings;
create trigger a_lock_daily_table_assignment before insert or update on public.bookings
  for each row execute function private.lock_daily_table_assignment();

-- Trigger interno privato: deve verificare anche le prenotazioni nascoste
-- dalla RLS del singolo cliente. Non restituisce contatti o altri dati cliente.
create or replace function private.check_daily_table_conflicts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  selected_ids text[];
begin
  if tg_op = 'UPDATE' then
    if new.booking_date is not distinct from old.booking_date
       and new.tables is not distinct from old.tables then return new; end if;
  end if;
  if coalesce(btrim(new.tables), '') = '' then return new; end if;
  if new.booking_date is null or new.booking_date = '' then
    raise exception 'Data obbligatoria per assegnare tavoli' using errcode = '22023';
  end if;

  select array_agg(btrim(t)) into selected_ids
    from unnest(string_to_array(new.tables, ',')) t;
  if exists (select 1 from unnest(selected_ids) t where t not in
    ('10','11','12','13','14','15','16','17','18','19','20','21','22','23')) then
    raise exception 'Tavolo non configurato: usare i tavoli dal 10 al 23' using errcode = '22023';
  end if;
  if cardinality(selected_ids) <> (select count(distinct t) from unnest(selected_ids) t) then
    raise exception 'Lo stesso tavolo non può essere indicato due volte' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.bookings b
    cross join lateral unnest(string_to_array(coalesce(b.tables, ''), ',')) t
    where b.id <> new.id and b.booking_date = new.booking_date
      and coalesce(to_jsonb(b)->>'booking_type', 'normale') =
          coalesce(to_jsonb(new)->>'booking_type', 'normale')
      and btrim(t) = any(selected_ids)
  ) then
    raise exception 'Tavolo già assegnato a un’altra prenotazione nella stessa data. Salvataggio annullato'
      using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function private.check_daily_table_conflicts() from public, anon, authenticated;

-- AFTER: verifica i tavoli effettivi, anche dopo prepare_booking.
-- Un conflitto annulla anche gli eventuali eventi dello storico della modifica.
drop trigger if exists z_check_daily_table_conflicts on public.bookings;
create trigger z_check_daily_table_conflicts after insert or update on public.bookings
  for each row execute function private.check_daily_table_conflicts();

commit;
