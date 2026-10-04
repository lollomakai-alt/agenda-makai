-- Lista d'attesa ADMIN. Dopo booking-history.sql, booking-edit.sql,
-- table-conflicts.sql e after-dinner-bookings.sql (configurazioni attuali).
begin;
set local lock_timeout = '5s';
create table if not exists public.waitlist (
  id bigint generated always as identity primary key,
  name text not null, phone text not null default '', email text not null default '',
  booking_date text not null, booking_time text not null, party_size integer not null,
  notes text not null default '',
  status text not null default 'WAITING' check(status in ('WAITING','CONTACTED','CONVERTED','CANCELLED')),
  booking_id bigint unique references public.bookings(id),
  conversion_table text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid,
  check ((status='CONVERTED') = (booking_id is not null)),
  check ((status='CONVERTED') = (conversion_table is not null))
);
create index if not exists waitlist_date_status_idx on public.waitlist(booking_date,status,booking_time);
create table if not exists public.waitlist_history (
  id bigint generated always as identity primary key,
  waitlist_id bigint not null references public.waitlist(id),
  action text not null, old_data jsonb, new_data jsonb,
  created_at timestamptz not null default now(), actor_id uuid
);
create index if not exists waitlist_history_entry_idx on public.waitlist_history(waitlist_id,created_at desc,id desc);
alter table public.waitlist enable row level security;
alter table public.waitlist_history enable row level security;
revoke all on public.waitlist,public.waitlist_history from public,anon,authenticated;
grant select,insert,update on public.waitlist to authenticated;
grant select,insert on public.waitlist_history to authenticated;
grant usage on sequence public.waitlist_id_seq,public.waitlist_history_id_seq to authenticated;
drop policy if exists admin_waitlist_select on public.waitlist;
create policy admin_waitlist_select on public.waitlist for select to authenticated using((select auth.jwt()->'app_metadata'->>'role')='admin');
drop policy if exists admin_waitlist_insert on public.waitlist;
create policy admin_waitlist_insert on public.waitlist for insert to authenticated with check((select auth.jwt()->'app_metadata'->>'role')='admin');
drop policy if exists admin_waitlist_update on public.waitlist;
create policy admin_waitlist_update on public.waitlist for update to authenticated using((select auth.jwt()->'app_metadata'->>'role')='admin') with check((select auth.jwt()->'app_metadata'->>'role')='admin');
drop policy if exists admin_waitlist_history_select on public.waitlist_history;
create policy admin_waitlist_history_select on public.waitlist_history for select to authenticated using((select auth.jwt()->'app_metadata'->>'role')='admin');
drop policy if exists admin_waitlist_history_insert on public.waitlist_history;
create policy admin_waitlist_history_insert on public.waitlist_history for insert to authenticated with check((select auth.jwt()->'app_metadata'->>'role')='admin');

create or replace function private.process_waitlist_entry()
returns trigger language plpgsql security invoker set search_path='' as $$
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
    if new.booking_time !~ '^(18|19|20|21|22):(00|30)$|^23:00$' then raise exception 'Ora non valida' using errcode='22023'; end if;
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
$$;
create or replace function private.record_waitlist_history()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  insert into public.waitlist_history(waitlist_id,action,old_data,new_data,actor_id)
    values(new.id,case when tg_op='INSERT' then 'created' when new.status='CONVERTED' then 'converted' else 'status_changed' end,
      case when tg_op='INSERT' then '{}'::jsonb else jsonb_build_object('status',old.status,'booking_id',old.booking_id) end,
      jsonb_build_object('status',new.status,'booking_id',new.booking_id,'conversion_table',new.conversion_table),auth.uid());
  return new;
end;
$$;
revoke all on function private.process_waitlist_entry(),private.record_waitlist_history() from public,anon,authenticated;
drop trigger if exists process_waitlist_entry on public.waitlist;
create trigger process_waitlist_entry before insert or update on public.waitlist for each row execute function private.process_waitlist_entry();
drop trigger if exists record_waitlist_history on public.waitlist;
create trigger record_waitlist_history after insert or update on public.waitlist for each row execute function private.record_waitlist_history();

create or replace function public.admin_create_waitlist_entry(p_name text,p_phone text,p_email text,p_date text,p_time text,p_party_size integer,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.waitlist%rowtype;
begin
  insert into public.waitlist(name,phone,email,booking_date,booking_time,party_size,notes) values(p_name,coalesce(p_phone,''),coalesce(p_email,''),p_date,p_time,p_party_size,coalesce(p_notes,'')) returning * into saved;
  return to_jsonb(saved);
end;
$$;
create or replace function public.admin_set_waitlist_status(p_entry_id bigint,p_status text,p_expected_status text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.waitlist%rowtype;
begin
  if p_status is null or p_status not in ('CONTACTED','CANCELLED') then raise exception 'Stato non valido' using errcode='22023'; end if;
  update public.waitlist w set status=p_status where w.id=p_entry_id and w.status=p_expected_status returning * into saved;
  if not found then raise exception 'Voce cambiata o non accessibile' using errcode='40001'; end if;
  return to_jsonb(saved);
end;
$$;
create or replace function public.admin_convert_waitlist_entry(p_entry_id bigint,p_table_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.waitlist%rowtype;
begin
  perform pg_advisory_xact_lock(734512);
  update public.waitlist w set status='CONVERTED',conversion_table=p_table_id where w.id=p_entry_id and w.status in ('WAITING','CONTACTED') returning * into saved;
  if not found then raise exception 'Voce già convertita, cancellata o non accessibile' using errcode='40001'; end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.admin_create_waitlist_entry(text,text,text,text,text,integer,text),public.admin_set_waitlist_status(bigint,text,text),public.admin_convert_waitlist_entry(bigint,text) from public,anon;
grant execute on function public.admin_create_waitlist_entry(text,text,text,text,text,integer,text),public.admin_set_waitlist_status(bigint,text,text),public.admin_convert_waitlist_entry(bigint,text) to authenticated;
notify pgrst,'reload schema';
commit;
