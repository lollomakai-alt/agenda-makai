-- Applicare dopo booking-history.sql, booking-edit.sql e table-conflicts.sql.
-- Nessun accesso pubblico: lo staff registra le richieste ricevute dal cliente.
begin;
set local lock_timeout = '5s';
create table if not exists public.booking_requests (
  id bigint generated always as identity primary key,
  booking_id bigint not null references public.bookings(id),
  request_type text not null check (request_type in ('data','ora','persone','cancellazione','note')),
  requested_value jsonb,
  expected jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  created_by uuid,
  reviewed_at timestamptz,
  reviewed_by uuid
);
create index if not exists booking_requests_pending_idx on public.booking_requests(status, created_at);
alter table public.booking_requests enable row level security;
revoke all on public.booking_requests from public, anon, authenticated;
grant select, insert, update on public.booking_requests to authenticated;
grant usage on sequence public.booking_requests_id_seq to authenticated;
drop policy if exists admin_requests_select on public.booking_requests;
create policy admin_requests_select on public.booking_requests for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin');
drop policy if exists admin_requests_insert on public.booking_requests;
create policy admin_requests_insert on public.booking_requests for insert to authenticated
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'admin');
drop policy if exists admin_requests_update on public.booking_requests;
create policy admin_requests_update on public.booking_requests for update to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin')
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'admin');

-- Anche scritture dirette rispettano validazione, transizioni e storico atomico.
create or replace function private.process_booking_request()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  b public.bookings%rowtype;
  field_name text;
  changes jsonb;
  day_value date;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'Accesso riservato allo staff' using errcode = '42501';
  end if;
  -- Stesso ordine di lock della logica modifica: serializza le approvazioni.
  perform pg_advisory_xact_lock(734512);
  select * into b from public.bookings where id = new.booking_id for update;
  if not found then raise exception 'Prenotazione non trovata' using errcode = 'P0002'; end if;
  if tg_op = 'INSERT' then
    if coalesce(b.status,'confirmed') <> 'confirmed' then raise exception 'Prenotazione non più modificabile'; end if;
    if new.request_type = 'cancellazione' then
      if new.requested_value is not null and new.requested_value <> 'null'::jsonb then raise exception 'Cancellazione senza valore'; end if;
      new.requested_value := null;
    elsif new.request_type = 'persone' then
      if jsonb_typeof(new.requested_value) is distinct from 'number' or new.requested_value::text !~ '^[1-6]$' then raise exception 'Numero persone non valido'; end if;
    elsif new.request_type in ('data','ora','note') then
      if jsonb_typeof(new.requested_value) is distinct from 'string' then raise exception 'Valore non valido'; end if;
      if new.request_type = 'data' then
        if new.requested_value #>> '{}' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data non valida'; end if;
        day_value := (new.requested_value #>> '{}')::date;
        if to_char(day_value,'YYYY-MM-DD') <> new.requested_value #>> '{}' then raise exception 'Data non valida'; end if;
      elsif new.request_type = 'ora' and new.requested_value #>> '{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Ora non valida';
      elsif new.request_type = 'note' and length(new.requested_value #>> '{}') > 300 then raise exception 'Note troppo lunghe'; end if;
    else raise exception 'Tipo richiesta non valido'; end if;
    new.expected := jsonb_build_object('booking_date',b.booking_date,'booking_time',b.booking_time,'party_size',b.party_size,'tables',b.tables,'notes',b.notes,'status',b.status);
    new.status := 'pending'; new.created_at := now(); new.created_by := auth.uid();
    new.reviewed_at := null; new.reviewed_by := null;
  else
    if old.status <> 'pending' or new.status not in ('approved','rejected') then raise exception 'Richiesta già gestita o decisione non valida' using errcode = '40001'; end if;
    if (to_jsonb(new) - array['status','reviewed_at','reviewed_by']) is distinct from
       (to_jsonb(old) - array['status','reviewed_at','reviewed_by']) then raise exception 'Richiesta immutabile'; end if;
    if new.status = 'approved' then
      if jsonb_build_object('booking_date',b.booking_date,'booking_time',b.booking_time,'party_size',b.party_size,'tables',b.tables,'notes',b.notes,'status',b.status) is distinct from old.expected then
        raise exception 'Prenotazione cambiata: rifiuta la richiesta e registrane una aggiornata' using errcode = '40001';
      end if;
      if coalesce(b.status,'confirmed') <> 'confirmed' then raise exception 'Prenotazione non più modificabile'; end if;
      if old.request_type = 'cancellazione' then
        perform public.admin_set_booking_status_with_history(old.booking_id,'cancelled');
      else
        field_name := case old.request_type when 'data' then 'booking_date' when 'ora' then 'booking_time' when 'persone' then 'party_size' when 'note' then 'notes' end;
        changes := jsonb_build_object(field_name,old.requested_value);
        perform public.admin_update_booking(old.booking_id,changes,old.expected - 'status');
      end if;
    end if;
    new.reviewed_at := now(); new.reviewed_by := auth.uid();
  end if;
  insert into public.booking_history(booking_id,action,old_data,new_data)
    values(new.booking_id, 'customer_request_' || case when tg_op = 'INSERT' then 'created' else new.status end,
      case when tg_op = 'INSERT' then '{}'::jsonb else jsonb_build_object('request_status',old.status) end,
      jsonb_build_object('request_id',new.id,'request_type',new.request_type,'requested_value',new.requested_value,
        'request_status',new.status,'actor_id',auth.uid()));
  return new;
end;
$$;
revoke all on function private.process_booking_request() from public, anon, authenticated;
drop trigger if exists process_booking_request on public.booking_requests;
create trigger process_booking_request before insert or update on public.booking_requests
  for each row execute function private.process_booking_request();

create or replace function public.admin_create_booking_request(booking_id bigint, request_type text, requested_value jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.booking_requests%rowtype;
begin
  insert into public.booking_requests(booking_id,request_type,requested_value,expected)
    values(booking_id,request_type,requested_value,'{}') returning * into saved;
  return to_jsonb(saved);
end;
$$;
create or replace function public.admin_review_booking_request(request_id bigint, decision text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.booking_requests%rowtype;
begin
  if decision is null or decision not in ('approved','rejected') then raise exception 'Decisione non valida'; end if;
  perform pg_advisory_xact_lock(734512);
  update public.booking_requests r set status = decision where r.id = request_id and r.status = 'pending' returning r.* into saved;
  if not found then raise exception 'Richiesta già gestita o non accessibile' using errcode = '40001'; end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.admin_create_booking_request(bigint,text,jsonb), public.admin_review_booking_request(bigint,text) from public, anon;
grant execute on function public.admin_create_booking_request(bigint,text,jsonb), public.admin_review_booking_request(bigint,text) to authenticated;
notify pgrst, 'reload schema';
commit;
