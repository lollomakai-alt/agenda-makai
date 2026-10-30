-- Rollback: ripristina lo stato precedente (funzione assente in produzione).
begin;

drop function if exists public.admin_restore_released_table(bigint, text);

commit;
