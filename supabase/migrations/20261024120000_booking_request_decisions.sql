-- Preparazione locale: decisioni delle richieste cliente con motivazione ed
-- email di rifiuto. Nessun backfill: le richieste storiche restano invariate.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.booking_requests add column if not exists rejection_reason text not null default '';
alter table public.booking_requests add column if not exists decision_email jsonb;
alter table public.booking_requests add column if not exists decision_email_status text;
alter table public.booking_requests add column if not exists decision_email_attempted_at timestamptz;
alter table public.booking_requests add column if not exists decision_email_provider_id text;
alter table public.booking_requests add column if not exists decision_email_error text;
alter table public.booking_requests add column if not exists decision_email_created_at timestamptz;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='booking_requests_rejection_reason_length'
      and conrelid='public.booking_requests'::regclass) then
    alter table public.booking_requests add constraint booking_requests_rejection_reason_length
      check (length(rejection_reason)<=500);
  end if;
  if not exists(select 1 from pg_constraint where conname='booking_requests_decision_email_status'
      and conrelid='public.booking_requests'::regclass) then
    alter table public.booking_requests add constraint booking_requests_decision_email_status
      check (decision_email_status is null
        or decision_email_status in ('queued','sending','accepted','failed','unknown','skipped'));
  end if;
end $$;

-- Stessa logica di approvazione, con motivazione obbligatoria sul rifiuto e
-- snapshot immutabile dell'email preparata nella medesima transazione.
create or replace function private.process_booking_request()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  b public.bookings%rowtype;
  field_name text;
  changes jsonb;
  day_value date;
  reason text;
  email_ok boolean;
  allowed text[] := array['status','reviewed_at','reviewed_by','rejection_reason','decision_email',
    'decision_email_status','decision_email_attempted_at','decision_email_provider_id',
    'decision_email_error','decision_email_created_at'];
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin'
     and not (tg_op='INSERT' and current_user not in ('anon','authenticated')
       and current_setting('makai.customer_request',true)='on') then
    raise exception 'Accesso riservato allo staff' using errcode = '42501';
  end if;
  -- Aggiornamento interno del solo stato email (claim/finish server-side).
  if coalesce(current_setting('makai.booking_request_email',true),'') = 'on' then
    return new;
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
    new.rejection_reason := '';
    new.decision_email := null;
    new.decision_email_status := null;
    new.decision_email_attempted_at := null;
    new.decision_email_provider_id := null;
    new.decision_email_error := null;
    new.decision_email_created_at := null;
    new.expected := jsonb_build_object('booking_date',b.booking_date,'booking_time',b.booking_time,'party_size',b.party_size,'tables',b.tables,'notes',b.notes,'status',b.status);
    new.status := 'pending'; new.created_at := now(); new.created_by := auth.uid();
    new.reviewed_at := null; new.reviewed_by := null;
  else
    if old.status = 'pending' and new.status = 'pending'
       and new.alternative_note is distinct from old.alternative_note
       and (to_jsonb(new)-'alternative_note')=(to_jsonb(old)-'alternative_note') then
      insert into public.booking_history(booking_id,action,old_data,new_data)
        values(new.booking_id,'customer_request_alternative',
          jsonb_build_object('request_id',new.id,'alternative',old.alternative_note),
          jsonb_build_object('request_id',new.id,'alternative',new.alternative_note));
      return new;
    end if;
    if old.status <> 'pending' or new.status not in ('approved','rejected') then raise exception 'Richiesta già gestita o decisione non valida' using errcode = '40001'; end if;
    if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then raise exception 'Richiesta immutabile'; end if;
    reason := btrim(coalesce(new.rejection_reason,''));
    if new.status = 'rejected' then
      if reason !~ '[^[:space:]]' or char_length(reason) > 500 then
        raise exception 'Inserisci una motivazione del rifiuto (massimo 500 caratteri)' using errcode = '22023';
      end if;
      new.rejection_reason := reason;
    elsif reason <> '' then
      raise exception 'La motivazione è prevista soltanto per il rifiuto' using errcode = '22023';
    end if;
    if new.status = 'approved' then
      if jsonb_build_object('booking_date',b.booking_date,'booking_time',b.booking_time,'party_size',b.party_size,'tables',b.tables,'notes',b.notes,'status',b.status) is distinct from old.expected then
        raise exception 'Prenotazione cambiata: rifiuta la richiesta e registrane una aggiornata' using errcode = '40001';
      end if;
      if coalesce(b.status,'confirmed') <> 'confirmed' then raise exception 'Prenotazione non più modificabile'; end if;
      -- La conferma della modifica riusa la coda comunicazioni esistente:
      -- nessun secondo invio viene creato da questa richiesta.
      new.decision_email := null;
      new.decision_email_status := null;
      new.decision_email_attempted_at := null;
      new.decision_email_provider_id := null;
      new.decision_email_error := null;
      new.decision_email_created_at := null;
      if old.origin='customer' and old.request_type in ('data','ora','persone')
         and b.booking_type='normale' then
        if private.online_slot_status(
          case when old.request_type='data' then old.requested_value #>> '{}' else b.booking_date end,
          case when old.request_type='ora' then old.requested_value #>> '{}' else b.booking_time end,
          case when old.request_type='persone' then (old.requested_value::text)::integer else b.party_size end,
          b.booking_type,b.id) <> 'available' then
          raise exception 'Disponibilità cambiata: proporre un’alternativa' using errcode='40001';
        end if;
      end if;
      if old.request_type = 'cancellazione' then
        perform public.admin_set_booking_status_with_history(old.booking_id,'cancelled');
      else
        field_name := case old.request_type when 'data' then 'booking_date' when 'ora' then 'booking_time' when 'persone' then 'party_size' when 'note' then 'notes' end;
        changes := jsonb_build_object(field_name,old.requested_value);
        perform public.admin_update_booking(old.booking_id,changes,old.expected - 'status');
      end if;
    else
      -- Il rifiuto non modifica la prenotazione: il cliente riceve motivazione
      -- e link al calendario del sito per scegliere un altro giorno o orario.
      email_ok := coalesce(b.email,'') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(b.email)<=120;
      new.decision_email := jsonb_build_object(
        'name',b.name,'booking_date',b.booking_date,'booking_time',b.booking_time,
        'party_size',b.party_size,'tables',coalesce(b.tables,''),
        'request_type',old.request_type,'requested_value',old.requested_value,
        'rejection_reason',new.rejection_reason,'recipient',coalesce(b.email,''));
      new.decision_email_status := case when email_ok then 'queued' else 'skipped' end;
      new.decision_email_attempted_at := null;
      new.decision_email_provider_id := null;
      new.decision_email_error := case when email_ok then null else 'invalid_email' end;
      new.decision_email_created_at := now();
    end if;
    new.reviewed_at := now(); new.reviewed_by := auth.uid();
  end if;
  insert into public.booking_history(booking_id,action,old_data,new_data)
    values(new.booking_id, 'customer_request_' || case when tg_op = 'INSERT' then 'created' else new.status end,
      case when tg_op = 'INSERT' then '{}'::jsonb else jsonb_build_object('request_status',old.status) end,
      jsonb_build_object('request_id',new.id,'request_type',new.request_type,'requested_value',new.requested_value,
        'request_status',new.status,'actor_id',auth.uid(),
        'rejection_reason',case when new.status='rejected' then new.rejection_reason else null end));
  return new;
end;
$$;
revoke all on function private.process_booking_request() from public, anon, authenticated;
drop trigger if exists process_booking_request on public.booking_requests;
create trigger process_booking_request before insert or update on public.booking_requests
  for each row execute function private.process_booking_request();

-- Rifiuto sempre motivato; approvazione invariata rispetto alla RPC esistente.
create or replace function public.admin_review_booking_request_with_reason(
  p_request_id bigint, p_decision text, p_reason text default '')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.booking_requests%rowtype; reason text := btrim(coalesce(p_reason,''));
begin
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'Accesso riservato allo staff' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Decisione non valida' using errcode = '22023'; end if;
  if p_decision = 'rejected' then
    if reason !~ '[^[:space:]]' or char_length(reason) > 500 then
      raise exception 'Inserisci una motivazione del rifiuto (massimo 500 caratteri)' using errcode = '22023';
    end if;
  elsif reason <> '' then
    raise exception 'La motivazione è prevista soltanto per il rifiuto' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(734512);
  update public.booking_requests r set status = p_decision, rejection_reason = reason
    where r.id = p_request_id and r.status = 'pending' returning r.* into saved;
  if not found then raise exception 'Richiesta già gestita o non accessibile' using errcode = '40001'; end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.admin_review_booking_request_with_reason(bigint,text,text) from public, anon, service_role;
grant execute on function public.admin_review_booking_request_with_reason(bigint,text,text) to authenticated;

-- Il rifiuto senza motivo tramite la vecchia RPC resta bloccato dal trigger.
revoke all on function public.admin_review_booking_request(bigint,text) from public, anon;
grant execute on function public.admin_review_booking_request(bigint,text) to authenticated;

-- Claim atomico dell'unico tentativo email per richiesta; solo server.
create or replace function public.admin_booking_request_email_operation(
  p_request_id bigint, p_action text, p_status text default null, p_provider_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.booking_requests%rowtype; prior_guard text;
begin
  prior_guard := coalesce(current_setting('makai.booking_request_email',true),'');
  perform set_config('makai.booking_request_email','on',true);
  if p_action = 'claim' then
    update public.booking_requests set decision_email_status='sending', decision_email_attempted_at=now()
      where id=p_request_id and status='rejected' and decision_email_status='queued' returning * into r;
  elsif p_action = 'finish' then
    if p_status is null or p_status not in ('accepted','failed','unknown')
       or (p_status='accepted' and (p_provider_id is null or length(p_provider_id) not between 1 and 256)) then
      raise exception 'Esito non valido' using errcode = '22023';
    end if;
    update public.booking_requests set decision_email_status=p_status,
      decision_email_provider_id=case when p_status='accepted' then p_provider_id end
      where id=p_request_id and decision_email_status='sending' returning * into r;
  elsif p_action = 'read' then
    select * into r from public.booking_requests where id=p_request_id;
  else raise exception 'Operazione non valida' using errcode = '22023'; end if;
  perform set_config('makai.booking_request_email',prior_guard,true);
  if r.id is null then return null; end if;
  return to_jsonb(r);
end;
$$;
revoke all on function public.admin_booking_request_email_operation(bigint,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_booking_request_email_operation(bigint,text,text,text) to service_role;

notify pgrst, 'reload schema';
commit;
