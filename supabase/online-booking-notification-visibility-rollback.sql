begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Reverse only this patch and reject any intervening function changes.
do $rollback$
declare
  definition text;
  previous_definition text;
  old_message constant text := $old$'Nuova prenotazione online · Tavolo da assegnare', b.created_at$old$;
  new_message constant text := $new$'Nuova prenotazione online', b.created_at$new$;
  old_predicate constant text := $old$where b.source='booking' and b.status='confirmed' and coalesce(btrim(b.tables),'')=''$old$;
  new_predicate constant text := $new$where b.source='booking' and b.status='confirmed'$new$;
begin
  if to_regprocedure('public.admin_list_notifications()') is null then
    raise exception 'Funzione notifiche assente: rollback interrotto';
  end if;
  definition := pg_get_functiondef('public.admin_list_notifications()'::regprocedure);
  if md5(definition) <> 'faff59599c266226f22b9e3609470a07' then
    previous_definition := replace(replace(definition, new_message, old_message), new_predicate, old_predicate);
    if md5(previous_definition) <> 'faff59599c266226f22b9e3609470a07' then
      raise exception 'Funzione notifiche cambiata: riesaminare il rollback';
    end if;
    execute previous_definition;
  end if;
end;
$rollback$;

notify pgrst, 'reload schema';
commit;
