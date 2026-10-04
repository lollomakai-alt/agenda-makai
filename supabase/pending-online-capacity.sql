-- Completa la protezione per gruppi online confermati ancora senza tavolo.
-- Dopo online-booking.sql. Nessuna modifica delle prenotazioni precedenti.
begin;
set local lock_timeout = '5s';
create or replace function private.online_day_status(day text, people integer, exclude_id bigint default null)
returns text language plpgsql stable security invoker set search_path = '' as $$
declare row_data record; selected_group text; physical text[];
  used text[] := array[]::text[]; groups text[] := array[]::text[];
  parties integer[] := case when people=0 then array[]::integer[] else array[people] end; covers integer;
begin
  if people is null or people not between 0 and 6 then return 'unverified'; end if;
  if people > 0 and exists(select 1 from public.online_booking_closures c where c.booking_date = day::date) then return 'closed'; end if;
  select coalesce(sum(b.party_size),0) into covers from public.bookings b
    where b.booking_date=day and b.status='confirmed' and (exclude_id is null or b.id<>exclude_id);
  if covers + people > 25 then return 'full'; end if;
  for row_data in select b.* from public.bookings b where b.booking_date=day
      and b.status not in ('cancelled','no_show') and coalesce(b.booking_type,'normale')='normale'
      and (exclude_id is null or b.id<>exclude_id) order by b.id loop
    if row_data.party_size is null or row_data.party_size < 1 then return 'unverified'; end if;
    if coalesce(btrim(row_data.tables),'') = '' then
      parties := parties || row_data.party_size;
    else
      foreach selected_group in array string_to_array(row_data.tables,',') loop
        selected_group := btrim(selected_group);
        if not exists(select 1 from private.online_table_groups() g where g.group_id=selected_group) then return 'unverified'; end if;
        physical := string_to_array(selected_group,'+');
        if physical && used then return 'unverified'; end if;
        used := used || physical; groups := groups || selected_group;
      end loop;
    end if;
  end loop;
  if not private.online_groups_compatible(groups) then return 'unverified'; end if;
  select coalesce(array_agg(p order by p desc),array[]::integer[]) into parties from unnest(parties) p;
  return case when private.fit_online_parties(parties,used,groups) then 'available' else 'full' end;
end;
$$;
revoke all on function private.online_day_status(text,integer,bigint) from public,anon,authenticated,service_role;
create or replace function private.protect_pending_online_bookings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('cancelled','no_show') then return new; end if;
  if tg_op='UPDATE' then
    if new.booking_date is not distinct from old.booking_date
       and new.party_size is not distinct from old.party_size
       and new.tables is not distinct from old.tables
       and new.booking_type is not distinct from old.booking_type
       and (new.status is not distinct from old.status or old.status not in ('cancelled','no_show')) then return new; end if;
  end if;
  -- The preexisting BEFORE trigger owns lock 734512 before any row write.
  -- Check the final row after all assignments/other triggers, under the same lock.
  if coalesce(new.booking_type,'normale')='normale' and exists(
    select 1 from public.bookings b where b.booking_date=new.booking_date
      and b.source='booking' and b.status not in ('cancelled','no_show')
      and coalesce(b.booking_type,'normale')='normale' and coalesce(btrim(b.tables),'')=''
  ) and private.online_day_status(new.booking_date,0,null) <> 'available' then
    raise exception 'Assegnazione non salvata: non resterebbe posto per le prenotazioni online già confermate senza tavolo'
      using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_pending_online_bookings() from public,anon,authenticated,service_role;
drop trigger if exists zz_protect_pending_online_bookings on public.bookings;
create trigger zz_protect_pending_online_bookings after insert or update on public.bookings
  for each row execute function private.protect_pending_online_bookings();
notify pgrst,'reload schema';
commit;
