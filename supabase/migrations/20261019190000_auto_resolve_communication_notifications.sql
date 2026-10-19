begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Una consegna successiva dello stesso messaggio/destinatario e della stessa prenotazione
-- risolve in automatico l'avviso di comunicazione precedente.
do $migration$
declare
  definition text;
  old_branch constant text := $old$where c.status in ('failed','unknown','bounced','complained')$old$;
  new_branch constant text := $new$where c.status in ('failed','unknown','bounced','complained')
    and not exists (
      select 1 from public.booking_communications resolved
      where resolved.booking_id=c.booking_id and resolved.channel=c.channel
        and resolved.kind=c.kind and resolved.recipient=c.recipient
        and resolved.status in ('accepted','delivered')
        and (resolved.created_at > c.created_at or (resolved.created_at=c.created_at and resolved.id>c.id))
        and resolved.snapshot->>'name'=c.snapshot->>'name'
        and resolved.snapshot->>'booking_date'=c.snapshot->>'booking_date'
        and resolved.snapshot->>'booking_time'=c.snapshot->>'booking_time'
        and resolved.snapshot->>'party_size'=c.snapshot->>'party_size'
        and resolved.snapshot->>'tables'=c.snapshot->>'tables'
    )$new$;
begin
  if to_regprocedure('public.admin_list_notifications()') is null
     or to_regclass('public.booking_communications') is null then
    raise exception 'Centro notifiche/comunicazioni mancante: migrazione interrotta';
  end if;

  definition := pg_get_functiondef('public.admin_list_notifications()'::regprocedure);
  if position('communication_failed' in definition) = 0 then
    -- Questa versione del feed non genera avvisi di comunicazione separati.
    null;
  elsif position(new_branch in definition) > 0 then
    null;
  elsif position(old_branch in definition) > 0 then
    if length(definition) - length(replace(definition, old_branch, '')) <> length(old_branch) then
      raise exception 'Filtro comunicazioni ambiguo: riesaminare la funzione notifiche';
    end if;
    definition := replace(definition, old_branch, new_branch);
    execute definition;
  else
    raise exception 'Funzione notifiche diversa da quella attesa: migrazione interrotta';
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
