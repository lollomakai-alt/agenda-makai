# Sistema CENA e DOPOCENA — implementazione locale del 12 ottobre 2026

Questa è la documentazione del comportamento nuovo. Le precedenti descrizioni di finestre 18–23, 150 minuti, limite CENA di 25 e assegnazione online manuale descrivono versioni precedenti.

## Regole condivise

- CENA: 19:00–22:30, ogni 30 minuti. Cucina fino alle 23:30. Durata **programmata** di riferimento: 120 minuti. Nessuna liberazione a tempo.
- DOPOCENA: 22:30, 23:00, 23:30, 00:00. Quota automatica indipendente di 25 persone negli stati attivi, inclusi arrived/completed; cancelled/no_show non consumano quota. Nasce senza tavolo.
- `booking_date` è il giorno del servizio. `00:00` indica la mezzanotte successiva, in Europe/Rome. La giornata operativa resta aperta fino alle 01:00, oppure alle 02:00 per il sabato. Questi orari non estendono gli orari prenotabili.
- CENA usa le unità reali del catalogo: 13+14 è fisso da 3, 22 e 23 sono da 2 ciascuno e `22+23` è un gruppo valido da 4. La capienza fisica standard derivata dalle configurazioni A/B/C e dalle unità fisse è 26. Il limite automatico è invece 25 persone per servizio, con conteggi CENA e DOPOCENA separati.
- Assegnazione automatica: 1/2 → unità standard da 2; 3 → unità da 3 oppure 4; 4 → unità da 4, incluso `22+23`; 5/6 → unità da 6. Il planner continua a verificare capienza, configurazioni 15–19 e conflitti fisici. Questi controlli valgono per i nuovi inserimenti online; ADMIN può superare manualmente la capienza standard senza alterare il catalogo e senza ricalcolare altre prenotazioni. La quota automatica resta 25 persone per ciascun servizio.

## Programma, occupazione, liberazione

Lo stesso tavolo può essere programmato per CENA e DOPOCENA con almeno 120 minuti fra gli orari. Una CENA arrived/completed con tavolo assegnato mantiene l’occupazione effettiva: il DOPOCENA non può arrivare al tavolo fino alla liberazione esplicita. Inoltre non può arrivare prima del proprio orario.

«Libera tavolo» chiama `admin_release_booking_table`: salva insieme completed e `tables=''`. La sola modifica dello stato a completed non libera tavoli. Una rimozione esplicita dell’assegnazione registra `table_released_at`, così quel record non rientra nell’assegnazione automatica. CANCELLED/NO_SHOW restano record storici e liberano la disponibilità. Per cancellare un cliente già arrivato o completed con tavolo ancora occupato, lo staff deve prima liberarlo esplicitamente.

Le prenotazioni già presenti sono grandfathered: l’applicazione SQL non le riscrive. Gli inserimenti e le modifiche manuali ADMIN salvano i valori scelti dallo staff, senza validazione delle nuove regole né ricalcolo di altre prenotazioni. I tavoli già assegnati restano occupazioni fisse per la pianificazione automatica; una nuova prenotazione automatica non può riutilizzarli in modo incompatibile. La liberazione esplicita può invece assegnare quel tavolo a un DOPOCENA idoneo, senza ricalcolare le altre prenotazioni.

Il passaggio al DOPOCENA parte da una liberazione effettiva, sotto lock 734512. Controlla unità/configurazione, minor spreco, poi orario programmato e id. Può assegnare prima delle 22:30 senza consentire l’arrivo anticipato. «ANNULLA» ricontrolla atomicamente che il tavolo non sia stato riassegnato.

## Assegnazione automatica e modifiche manuali

Un nuovo inserimento online CENA riceve un tavolo libero secondo slot, capienza e configurazione, senza spostare prenotazioni già esistenti. Il DOPOCENA nasce senza tavolo; una liberazione esplicita può assegnargli il tavolo compatibile. Gli aggiornamenti manuali non attivano l’ottimizzatore. Lista e mappa rileggono i dati salvati da Supabase.

## Cliente e riconferma

Il backend genera 32 byte casuali. La tabella privata dei token conserva SHA-256, booking collegato, scadenza e revoca; non è accessibile a anon/authenticated. Il token compare nel fragment del link, evitando URL dei log HTTP e Referer. Il backend valida sempre hash, scadenza, revoca e stato. La risposta pubblica non espone booking_id.

`/prenotazioni/gestisci` permette lettura, riconferma e richiesta di cambio data/ora/persone/note/cancellazione. La richiesta non cambia la prenotazione. Lo staff approva/rifiuta mediante i contratti esistenti, con snapshot originale, disponibilità e storico atomici. Può registrare una proposta alternativa, visibile al cliente. Richieste duplicate dello stesso tipo ancora pending sono rifiutate. La riconferma è idempotente e non cancella prenotazioni.

Il link è mostrato dopo il salvataggio ed è inserito nelle conferme email accodate. I token originari restano validi nei retry; un retry può generare un nuovo link. I vecchi fingerprint CENA rimangono riconosciuti. Le nuove prenotazioni attestano l’informativa aggiornata `2026-10-12-online-v2`; il consenso marketing mantiene versione e scadenza separati. I link delle comunicazioni sono conservati negli snapshot **riservati al server**, necessari all’invio; non vengono copiati nello storico operativo.

## Comunicazioni e notifiche

Sono riutilizzati `send-booking-email`, il claim atomico, Resend e i log esistenti. Template: conferma, modifica, cancellazione, reminder, riconferma, ritardo, alternativa. Nel log lo staff può preparare e inviare esplicitamente i messaggi operativi, usando lo stesso claim e le protezioni di retry. WhatsApp usa un messaggio precompilato; invio manuale.

Il worker `sito-makai/scripts/booking_reminders.py` è una simulazione di lettura per default. `--prepare` prepara il reminder del giorno successivo e lo stato pending; `--send` usa il trasporto già esistente. Nessuna schedulazione è installata e nessun comando di invio è stato eseguito. Un timer/scheduler dovrà essere autorizzato e configurato alla pubblicazione. Gli esiti unknown/sending/accepted non ricevono retry automatici.

Le notifiche includono nuove online anche già assegnate, richieste pending, ritardi del servizio attivo, DOPOCENA arrivato senza tavolo, riconferme pending e comunicazioni failed/unknown/bounced/complained. Le richieste da gestire restano visibili anche se ricevute il giorno precedente. Ordine cronologico inverso; nuova/vista/gestita. L’archiviazione è personale e lascia intatti eventi e storico. Realtime copre bookings, richieste e ricevute quando la publication Supabase è disponibile; il polling resta una riserva.

## Applicazione SQL e rilascio — NON eseguiti

Usare gli script del repository **Agenda**, fonte unica per le regole SQL. Non applicare in produzione tutte le fotografie storiche indiscriminatamente. Prima verificare lo schema già installato e le definizioni effettive.

Prerequisiti del nuovo script, verificati dalla fixture locale:

1. booking-status, booking-history, booking-edit, table-conflicts.
2. after-dinner-bookings, manual-table-assignment, online-booking.
3. pending-online-capacity, temporal-table-conflicts, manual-assignment-capacity, explicit-table-release.
4. booking-no-show, booking-requests, admin-notifications, agenda-communications, admin-activity-log.
5. dinner-after-dinner-turnover.
6. **complete-booking-system.sql per ultimo**; sostituisce le regole precedenti e contiene anche la versione finale dell’editor e del claim iniziale online.

Per un ambiente esistente applicare soltanto gli aggiornamenti necessari, poi il nuovo script finale, in una prova di staging prima del live. Il database non riceve prenotazioni o email durante l’applicazione degli script. Non riapplicare vecchi script dopo il nuovo: ripristinerebbero regole superate.

**Audit live del 12 ottobre:** leggere [complete-booking-system-readiness.md](complete-booking-system-readiness.md) prima di pianificare l’applicazione. Sono presenti prenotazioni future incompatibili con gli slot, il catalogo e la capienza nuovi. Lo script finale disattiva il vecchio trigger che somma i 25 coperti dei due servizi e revoca la cancellazione fisica diretta delle prenotazioni. Le definizioni live precedenti sono conservate in `complete-booking-system-live-baseline.json`; il documento di audit descrive anche il ripristino senza eliminare dati.

Pubblicare in modo coordinato SQL, backend sito, Edge email e frontend Agenda/Sito. Il backend nuovo dipende dalle funzioni nuove: prima della migrazione risponderà servizio non disponibile senza dichiarare un salvataggio riuscito. `PUBLIC_SITE_URL` deve essere un’origine HTTPS del sito; default `https://www.makaipigneto.it`. I segreti esistenti restano solo server. Non eseguire il vecchio endpoint Edge `create-booking`, escluso dal flusso del sito.

Staff: conservare inviti nativi Supabase Auth e recupero/cambio password. Nessuna registrazione pubblica o ruolo nuovo. Un eventuale QR futuro deve contenere soltanto il link temporaneo di invito Auth, mai una password. Impostazioni live Auth/redirect/invito e conservazione devono essere verificate prima del rilascio.

## Verifica e limiti

Eseguire anche `npm run test:email`: riusa la suite del trasporto Edge con fetch e credenziali fittizie, tramite Node, senza invii reali.

Le suite usano database locali PGlite con SQL reale, ruoli/RLS e API con servizi simulati. Coprono regole, disponibilità, riassetti multipli, token/richieste/riconferme, reminder, storico e notifiche. Nessun test usa prenotazioni, credenziali o messaggi di produzione.

La prova PGlite è a sessione singola: **non sostituisce una prova di concorrenza PostgreSQL con due connessioni**. Prima della pubblicazione servono inoltre test reali di RLS/Auth/Realtime, verifica invio controllato autorizzato, Safari/iPhone, configurazione Resend e scheduler. La conservazione esistente di bookings/marketing è mantenuta; i token hanno FK e scadenza coerenti, senza nuovi consensi impliciti. La revisione delle informative resta necessaria per i canali nuovi.
