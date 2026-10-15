-- Emergency rollback only before any customer token, operation, request, archive or history event exists.
-- If activity exists, keep the schema and prepare a forward fix so customer links remain usable.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
begin
  if to_regclass('private.customer_management_function_backup') is null then
    raise exception 'Backup funzioni non presente';
  end if;
  if exists(select 1 from private.booking_customer_tokens limit 1)
     or exists(select 1 from private.customer_booking_operations limit 1)
     or exists(select 1 from public.booking_requests where origin='customer' or alternative_note<>'' limit 1)
     or exists(select 1 from public.booking_history where action in ('customer_changed','customer_cancelled','customer_reconfirmed') limit 1)
     or exists(select 1 from public.admin_notification_archives limit 1) then
    raise exception 'Attività cliente presente: usare una correzione in avanti';
  end if;
end $$;
do $$ declare saved record; begin
  for saved in select definition from private.customer_management_function_backup loop
    execute saved.definition;
  end loop;
end $$;
drop function if exists private.customer_booking_request(text,text,jsonb,uuid);
drop function if exists private.customer_booking_request(text,text,jsonb);
drop function if exists private.customer_booking(text);
drop function if exists private.reconfirm_customer_booking(text);
drop function if exists public.admin_archive_notification(text);
drop function if exists public.admin_propose_booking_alternative(bigint,text);
drop function if exists public.admin_booking_request_alternatives(bigint);
drop table if exists public.admin_notification_archives;
drop table if exists private.customer_booking_operations;
drop table if exists private.booking_customer_tokens;
drop table if exists private.customer_management_function_backup;
drop index if exists public.booking_requests_one_pending_kind;
alter table public.booking_requests drop column if exists alternative_note;
alter table public.booking_requests drop column if exists origin;
alter table public.bookings drop column if exists reconfirmed_at;
alter table public.bookings drop column if exists reconfirmation_status;
notify pgrst, 'reload schema';
commit;
