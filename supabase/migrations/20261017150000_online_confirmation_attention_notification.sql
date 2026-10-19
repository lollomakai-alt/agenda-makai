begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Update only the existing online-booking notice; retain its stable ID, read/archive state,
-- booking link, CENA/DOPOCENA visibility and every other notification branch.
do $migration$
declare
  definition text;
  old_notice constant text := $old$'Nuova prenotazione online', b.created_at$old$;
  new_notice constant text := $new$case
        when coalesce(b.booking_type, 'normale') = 'normale'
          and (coalesce(btrim(b.email), '') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
            or exists (
              select 1 from public.booking_communications failed
              where failed.booking_id = b.id and failed.channel = 'email'
                and failed.kind = 'confirmation' and failed.status in ('failed', 'unknown')
                and not exists (
                  select 1 from public.booking_communications sent
                  where sent.booking_id = b.id and sent.channel = 'email'
                    and sent.kind in ('confirmation', 'updated')
                    and sent.status in ('accepted', 'delivered')
                    and sent.recipient = b.email
                    and sent.snapshot->>'booking_date' = b.booking_date
                    and sent.snapshot->>'booking_time' = b.booking_time
                    and sent.snapshot->>'party_size' = b.party_size::text
                    and sent.snapshot->>'name' = b.name
                )
            ))
          then 'Conferma cliente da inviare o verificare'
        else 'Nuova prenotazione online'
      end, b.created_at$new$;
begin
  if to_regprocedure('public.admin_list_notifications()') is null
     or to_regclass('public.booking_communications') is null
     or to_regclass('public.admin_notification_archives') is null then
    raise exception 'Schema notifiche/comunicazioni mancante: migrazione interrotta';
  end if;

  definition := pg_get_functiondef('public.admin_list_notifications()'::regprocedure);
  if position(old_notice in definition) > 0 then
    if length(definition) - length(replace(definition, old_notice, '')) <> length(old_notice) then
      raise exception 'Ramo notifica online ambiguo: riesaminare la migrazione';
    end if;
    if position('where b.source=''booking'' and b.status=''confirmed''' in definition) = 0 then
      raise exception 'Visibilità prenotazioni online diversa da quella attesa: migrazione interrotta';
    end if;
    definition := replace(definition, old_notice, new_notice);
    execute definition;
  elsif position('Conferma cliente da inviare o verificare' in definition) > 0 then
    -- Idempotent when the exact behavior is already present.
    null;
  else
    raise exception 'Funzione notifiche diversa da quella attesa: riesaminare la migrazione';
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
