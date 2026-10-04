# Gestione stati prenotazioni

Il contratto frontend e API database è esclusivamente minuscolo:
`confirmed`, `arrived`, `completed`, `cancelled`, `no_show`.
Le etichette ADMIN sono Confermata, Arrivato, Completata, Cancellata e No-show.
Stato assente, null o vuoto viene letto come `confirmed`; valori sconosciuti
sono segnalati senza trasformarli in cancellazioni. La normalizzazione in
lettura non modifica il database. Le scritture rifiutano valori maiuscoli.

Il selettore chiama `admin_set_booking_status_with_history`, che richiama
`admin_set_booking_status`: aggiorna solo `status`, senza
DELETE, notifiche, email, modifica contatti o altre automazioni.
Il trigger dello storico aggiunge ora un evento separato: vedere booking-history.md.
Il precedente comando di arrivo è sostituito dal cambio del solo stato:
non aggiorna `arrived_at` né i contatori marketing. Dati e contatori storici
sono conservati. Conferme manuali e consensi già presenti sono mantenuti.
Il calendario continua a contare solo le prenotazioni confermate.

## SQL e compatibilità

Controllo remoto in sola lettura del 4 ottobre 2026: `public.bookings.status`
è `text NOT NULL DEFAULT 'confirmed'`, con vincolo `bookings_status_check`
che accetta `confirmed` e `cancelled`.

`supabase/booking-status.sql` amplia il vincolo ai cinque valori, mantiene
`confirmed` come default e definisce la RPC amministrativa SECURITY INVOKER,
protetta dal ruolo admin in app_metadata e dalle policy RLS esistenti.
Non esegue aggiornamenti dei record durante l'installazione. Il comando
UPDATE è soltanto nel corpo della funzione, eseguito quando l'ADMIN cambia
uno stato. Il file è transazionale e rieseguibile sullo schema verificato.
Se trova stati incompatibili, fallisce senza convertirli o perdere dati.
Include ADD COLUMN IF NOT EXISTS per copie dello schema prive di status.

Sono stati verificati i trigger remoti `private.prepare_booking`,
`private.enforce_online_closure` e `public.set_scadenza_dati`, il codice locale
della Edge Function `create-booking` e il backend condiviso FastAPI:
gli inserimenti e le cancellazioni usano già `confirmed` e `cancelled`.
Non occorre convertire questi confronti o modificare i trigger per allargare
il vincolo. Trigger e RLS non sono modificati dal nuovo SQL.

Le regole preesistenti restano attive: il ritorno a `confirmed` di una
prenotazione online in una giornata chiusa può essere rifiutato dal trigger
di chiusura. I conteggi esistenti basati su `confirmed` continuano a contare
solo quello stato, senza includere automaticamente `arrived` o `completed`.
Le funzioni preesistenti di disponibilità non sono state modificate.

Il SQL degli stati è stato applicato manualmente dall'utente. La verifica reale
degli stati è rimandata. Il nuovo SQL dello storico non è stato applicato:
il selettore aggiornato richiede anche `supabase/booking-history.sql`; fino ad allora
mostra un errore di configurazione senza simulare un salvataggio riuscito.
I test locali non creano prenotazioni remote. La verifica reale dei salvataggi
e dei permessi resta da eseguire dopo l'applicazione manuale.
