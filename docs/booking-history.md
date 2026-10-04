# Storico modifiche prenotazioni

## Installazione

Applicare manualmente `supabase/booking-history.sql` nel SQL Editor del progetto
dopo il SQL degli stati già applicato. Nessuna modifica remota è stata eseguita
durante questo intervento; sono state verificate soltanto struttura e policy.
Il file usa la tabella `public.booking_history` esistente e il suo id identity,
aggiunge policy SELECT/INSERT riservate al ruolo admin in app_metadata, rimuove
permessi UPDATE/DELETE dall'interfaccia e installa trigger e RPC. Non ricrea dati.
Pubblicare anche la build dell'Agenda.

## Registrazione

Un trigger AFTER UPDATE su `public.bookings` registra le modifiche effettuate
con una sessione Supabase ADMIN. Confronta OLD/NEW effettivi, dopo i trigger
già presenti: status, booking_date, booking_time, party_size, tables, notes.
Archivia soltanto i campi cambiati in old_data/new_data, con booking_id e
created_at. Se cambia solo status, action è status_changed; per gli altri
cambiamenti, anche combinati con status, è booking_updated. cancelled e
no_show sono normali cambi stato, senza DELETE. Salvataggi identici non
generano eventi; non vengono creati eventi retroattivi o di inserimento.
I JSON non includono contatti, password, token, dati Auth o campi marketing.
Le note sono conservate soltanto quando cambiano, come richiesto.

La RPC admin_set_booking_status_with_history richiama la RPC degli stati già
presente; il trigger aggiunge l'evento automaticamente. L'Agenda non inserisce
una seconda copia. Il trigger copre anche futuri aggiornamenti ADMIN diretti
a Supabase degli altri campi, senza introdurre editor nuovi.

Se UPDATE fallisce, il trigger AFTER UPDATE non produce un evento persistente.
Se INSERT nello storico fallisce, un blocco di eccezione annulla soltanto
quell'inserimento; la prenotazione aggiornata resta salvata. Un warning con id
e codice SQL viene registrato sul database. La RPC restituisce separatamente
history_error: l'Agenda mostra «Stato salvato, ma lo storico non è stato
registrato» e scrive in console id/codice, senza rollback o retry automatici.
Gli eventi falliti non vengono ricostruiti automaticamente.

## Interfaccia e limiti

«Storico modifiche» nella scheda carica le righe di quella prenotazione,
ordinate per created_at DESC e id DESC. Mostra data/ora Europe/Rome,
tipo di modifica e prima → dopo. Gli errori di lettura sono espliciti;
un pulsante consente di ricaricare. Non esistono comandi per alterare gli eventi.

Il trigger riconosce ADMIN tramite auth.jwt(): operazioni di altri utenti,
SQL Editor o servizi che non propagano il JWT ADMIN non sono attribuite
all'ADMIN e non vengono registrate. Il backend FastAPI condiviso non propaga
attualmente il JWT alle sue connessioni SQL; nell'Agenda i campi in scope
si modificano attraverso la RPC Supabase degli stati. Eventuali futuri editor
che passassero dal backend dovranno propagare un contesto ADMIN affidabile
o registrare lo storico lato backend. Consensi/arrivi marketing precedenti
sono fuori dai campi tracciati e non sono stati modificati.

La FK esistente di booking_history è ON DELETE CASCADE: un'eventuale
eliminazione fisica esterna della prenotazione cancellerebbe anche i suoi
eventi. Questa funzione non elimina prenotazioni e non cambia quella FK.

Verifiche locali: test del contratto RPC, errore separato dello storico,
lettura filtrata/ordinata e rappresentazione dei campi. La prova reale dei
salvataggi e della persistenza dopo reload resta da fare dopo il SQL.
