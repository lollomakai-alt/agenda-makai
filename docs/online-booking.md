# Flusso prenotazioni Sito → Agenda

I progetti restano separati. Il Sito chiama `POST /api/bookings` sul proprio backend FastAPI; nessuna chiave Supabase privilegiata è esposta al browser. L'Agenda continua a leggere la tabella canonica protetta da RLS.

## Applicazione SQL e pubblicazione

Nel progetto Supabase condiviso `fignmtkbwpbrmllbxoct`, applicare **nell'ordine**:

1. `makai-agenda/supabase/online-booking.sql`.
2. La versione aggiornata di `makai-agenda/supabase/admin-notifications.sql` (riapplicabile).
La RPC `admin_assign_booking_tables` è già presente nel database verificato: non serve riapplicare `manual-table-assignment.sql`.

Gli SQL Agenda precedenti (storico, editor, dopocena, attività, notifiche) devono essere già presenti. I metadati del database sono stati controllati in sola lettura; gli SQL di questo intervento **non sono stati applicati**.

`online-booking.sql` sostituisce `private.prepare_booking`, elimina l'assegnazione automatica online, conserva la protezione dei campi admin e ripristina il limite 25 coperti. Aggiunge le attestazioni privacy al booking, ricevute private per retry idempotenti, il controllo condiviso delle combinazioni normali e un evento di creazione online nello storico. Le prenotazioni precedenti non vengono modificate. Le combinazioni sono allineate e verificate con `src/config/tableAssignments.js`.

Pubblicare poi **entrambi i progetti**. Finché il nuovo SQL non è applicato, il nuovo backend risponde servizio non disponibile e non conferma un salvataggio. La vecchia Edge Function `create-booking` non è usata dal Sito: dopo il nuovo SQL la sua vecchia versione, priva di attestazione privacy, non può inserire prenotazioni online. Nessuna nuova Edge Function da pubblicare.

## Comportamento

- Nome/cognome, telefono, data, orario a mezz'ora (18–23), da 1 a 6 persone, email facoltativa, note fino a 300 caratteri. Anticipo 30 minuti, orizzonte 60 giorni, lunedì chiuso e chiusure online dell'Agenda.
- Salvataggio serializzato sul lock esistente 734512, ricontrollo dentro la transazione. Nuova riga `source=booking`, `status=confirmed`, `tables=''`, `booking_type=normale`. Nessuna email o WhatsApp automatici.
- Il calendario mensile chiama lo stesso controllo SQL del trigger di inserimento. Somma i coperti confermati (tutti i tipi), considera l'occupazione dell'intera serata normale, inclusi gruppi ancora non assegnati; tavoli legacy sconosciuti o conflittuali bloccano conservativamente la disponibilità. Normale/dopocena conservano le occupazioni separate dell'Agenda.
- Privacy obbligatoria registrata separatamente. Marketing WhatsApp opzionale, mai preselezionato: solo un sì salva/rinnova il contatto esistente per 24 mesi nella stessa transazione. Un no non revoca eventuali consensi precedenti. Nessun consenso, contatto o token nello storico operativo.
- UUID per richiesta e impronta privata: reinviare lo stesso payload restituisce la ricevuta anche dopo un aggiornamento admin, senza nuova prenotazione/consenso/storico. Riutilizzare la stessa chiave con altri dati è rifiutato.
- Notifica `online:<id>` per ogni online confermata senza tavolo, lettura personale persistente; si risolve dopo assegnazione/cancellazione. Il click apre `?date=…&assign=…` direttamente nella mappa con la prenotazione selezionata. Evidenzia la combinazione consigliata dalla logica esistente; lo staff la salva esplicitamente. Realtime e aggiornamento periodico delle notifiche.

## Limiti di verifica

Nessuna prenotazione dimostrativa creata sul database reale. Test locali non attestano la pubblicazione, il salvataggio live o il comportamento da smartphone. Applicare SQL e pubblicare i due progetti prima del controllo operativo reale.

L’informativa Privacy è stata allineata al form online e all’assenza di email automatiche. Restano i segnaposto preesistenti per identità del titolare/fornitori e le verifiche su conservazione e trasferimenti: non rappresentano una verifica legale completata.

## Protezione delle prenotazioni pendenti (4 ottobre 2026)

Applicato anche `makai-agenda/supabase/pending-online-capacity.sql`: ogni assegnazione/modifica che occupa spazio deve lasciare una sistemazione possibile ai gruppi online confermati senza tavolo. Il trigger AFTER rifiuta l’intera modifica, compreso lo storico, se non è possibile. Le raccomandazioni della mappa escludono queste scelte. Una chiusura online non blocca l’assegnazione delle prenotazioni già ricevute.

Due connessioni reali in sola lettura hanno verificato che il secondo salvataggio attende il lock 734512 e ricontrolla dopo il rilascio. Nessuna prenotazione di prova creata nel database reale.

Eccezioni operative conservate: sovracapienza scelta esplicitamente dallo staff; tavoli riutilizzabili tra normale/dopocena. Il limite 25 conta i coperti nello stato confirmed. Queste eccezioni non equivalgono a un controllo temporale della sovrapposizione fisica tra cena e dopocena.
