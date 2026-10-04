# Conflitti tavoli nella stessa data

La configurazione `src/config/tables.json` riprende senza variazioni TABLES
del backend condiviso e i seats del trigger prepare_booking: tavoli 10–23.
Non aggiunge regole di capacità o di combinazione. Se cambia la configurazione
della sala, allineare questi riferimenti con quelli già presenti nel backend.

L'editor riutilizza le prenotazioni caricate per rifiutare tavoli duplicati,
non configurati o assegnati ad altri id nella stessa data. Non considera
orari, durata, dopocena o riutilizzo. La prenotazione modificata non entra
in conflitto con se stessa. Un tavolo resta occupato finché è assegnato:
non ci sono eccezioni per stato cancelled/completed/no_show nella regola richiesta.
Il controllo riguarda le nuove assegnazioni e i cambi di data/tavoli,
senza bloccare modifiche di note su conflitti storici già presenti.

## SQL da applicare manualmente

`supabase/table-conflicts.sql` serializza le scritture usando il lock 734512
già usato dai servizi esistenti. Un trigger AFTER INSERT/UPDATE verifica i
tavoli effettivi dopo prepare_booking; controlla tutte le prenotazioni della
stessa data, anche quelle nascoste dalla RLS di un cliente. È una funzione
interna privata SECURITY DEFINER, non callable da anon/authenticated, con
search_path vuoto, che espone soltanto un errore generico, senza dati cliente.
Un conflitto fa fallire la transazione, inclusi gli eventuali eventi storico.
Il controllo frontend non sostituisce quello SQL, anche in caso di dati
client incompleti o di due invii concorrenti.

Il trigger prepare_booking preesistente resta attivo: per gli inserimenti
online tenta ancora la sua assegnazione precedente. Se il tavolo risultante
è già assegnato nella data, il nuovo controllo rifiuta il salvataggio;
non cerca alternative e non riassegna prenotazioni esistenti.
Nessuna lista d'attesa, durata o nuova assegnazione automatica è implementata.

## Verifiche e dati esistenti

Controllo Supabase in sola lettura: 2 coppie data/tavolo sono già condivise
da più prenotazioni; nessun id tavolo sconosciuto è stato rilevato.
I record esistenti non vengono modificati o corretti dal SQL. I conflitti
preesistenti richiedono una scelta manuale ADMIN; il controllo blocca quelli nuovi.
Il SQL non è stato eseguito. Test dell'editor/conflitti e build passano;
la verifica reale dei salvataggi concorrenti resta da effettuare dopo il SQL.
