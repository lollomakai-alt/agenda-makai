begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Alter only the online-booking branch; preserve all other live notice logic.
do $migration$
declare
  definition text;
  previous_definition text;
  old_message constant text := $old$'Nuova prenotazione online · Tavolo da assegnare', b.created_at$old$;
  new_message constant text := $new$'Nuova prenotazione online', b.created_at$new$;
  old_predicate constant text := $old$where b.source='booking' and b.status='confirmed' and coalesce(btrim(b.tables),'')=''$old$;
  new_predicate constant text := $new$where b.source='booking' and b.status='confirmed'$new$;
begin
  if to_regprocedure('public.admin_list_notifications()') is null
     or to_regclass('public.admin_notification_reads') is null
     or to_regclass('public.admin_notification_archives') is null then
    raise exception 'Centro notifiche non installato: migrazione interrotta';
  end if;
  definition := pg_get_functiondef('public.admin_list_notifications()'::regprocedure);
  if md5(definition) = 'faff59599c266226f22b9e3609470a07' then
    definition := replace(replace(definition, old_message, new_message), old_predicate, new_predicate);
    execute definition;
  else
    previous_definition := replace(replace(definition, new_message, old_message), new_predicate, old_predicate);
    if md5(previous_definition) <> 'faff59599c266226f22b9e3609470a07' then
      raise exception 'Funzione notifiche diversa da Production attesa: riesaminare la migrazione';
    end if;
    -- Already applied: keep the same function and personal read/archive records.
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
