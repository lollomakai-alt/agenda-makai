-- Rollback del fallback di creazione manuale.
begin;

drop function if exists public.admin_create_agenda_booking(text, text, text, text, text, integer, text, text);

commit;
