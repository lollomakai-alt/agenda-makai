-- Ripristina la definizione precedente della campanella senza toccare prenotazioni o richieste.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
declare saved_definition text;
begin
  if to_regclass('private.admin_dopocena_notification_backup') is null then
    raise exception 'Backup della funzione notifiche assente' using errcode='P0001';
  end if;
  select definition into saved_definition from private.admin_dopocena_notification_backup where id=true;
  if saved_definition is null
     or position('admin_pending_dopocena_notice_events' in
       pg_get_functiondef('public.admin_list_notifications()'::regprocedure)) = 0 then
    raise exception 'Funzione notifiche modificata o backup non valido' using errcode='P0001';
  end if;
  execute saved_definition;
end $$;
drop function public.admin_pending_dopocena_notice_events();
drop table private.admin_dopocena_notification_backup;
notify pgrst, 'reload schema';
commit;
