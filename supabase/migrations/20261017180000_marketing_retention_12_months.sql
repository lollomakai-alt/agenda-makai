-- Riduce a 12 mesi la conservazione dei consensi marketing esistenti.
-- Le scadenze già più brevi restano invariate; il job giornaliero esistente elimina gli scaduti.
begin;

update public.marketing_contacts
set scadenza_consenso = consenso_data + interval '12 months'
where scadenza_consenso > consenso_data + interval '12 months';

commit;
