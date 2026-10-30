## Redesign Agenda: mappa live, Richieste e Archivio — 30 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** tre interventi coordinati, senza modifiche a database, Edge o Backend. **Mappa live:** desktop e iPad mantengono la piantina esistente, scalata in proporzione; sotto i 700px la stessa giornata diventa una lista di card tappabili per sala, con tavolo, posti, stato LIBERO/IN ARRIVO/OCCUPATO, orario e cliente. Il tocco apre lo stesso dettaglio e le stesse azioni (“Cambia tavolo”, non venuto, nuova prenotazione); anche l’assegnazione usa la lista con selezioni e conferma invariate. **Richieste clienti:** la pagina `/richieste-clienti` mostra solo le richieste in attesa, in card con cliente, data/ora, persone e tavolo attuale; azioni Accetta, Proponi alternativa e Rifiuta; telefono ed email solo nel dettaglio; rimossi decisioni recenti, duplicati e testi lunghi; un solo pulsante “Aggiorna”; nessun UUID visibile. La proposta di alternativa usa un pannello interno, senza `window.prompt`. **Archivio:** nuova pagina `/archivio` (alias `/attivita`) con unica lista cronologica di eventi in italiano, prenotazione e esito, dettaglio apribile con identificativi, motivazione e contatti caricati solo all’apertura, filtri in pannello (numero o nome, tipo evento, intervallo date) e contatore “N eventi · ultimi 500”. Le richieste decise confluiscono in questo unico archivio eventi, come concordato, senza diventare prenotazioni confermate.
- **File:** `src/components/TableMap.jsx`, `src/components/BookingRequests.jsx`, nuovi `src/pages/ArchivePage.jsx` e `src/styles/admin-records.css`, `src/pages/CustomerRequestsPage.jsx`, `src/App.jsx`, `src/utils/adminActivity.js`, `src/styles/{admin.css,admin-operations.css}`, `vercel.json`, rimozione del vecchio `src/pages/ActivityPage.jsx`, test `adminActivity`, `tableFloorPlanUi`, `tableMapPresentation`, `bookingsPageRender` e nuovo `redesignPages`; documenti `docs/{admin-activity-log,booking-requests,table-map}.md` e questo registro.
- **Verifiche locali:** suite Agenda 317/317, build Vite riuscita (126 moduli, inclusi i chunk `CustomerRequestsPage` e `ArchivePage`) e `git diff --check` superato. I nuovi test coprono: lista iPhone senza piantina e assegnazione da lista; richieste solo in attesa con tre azioni e contatti dentro il dettaglio; archivio con eventi in italiano, esiti, filtri per numero/nome/tipo, contatore, identificativi e contatti non caricati prima dell’apertura. Test con hook, Supabase e trasporto simulati; nessuna equivalenza dichiarata con una prova live.
- **Verifica visiva locale:** eseguita con un’anteprima temporanea dei componenti reali e dati finti, poi rimossa: desktop 1300px e 846px, iPhone 390px e 320px, tema chiaro e scuro. Confermati piantina desktop, lista e dettaglio su iPhone, tre azioni delle richieste, contatti nel solo dettaglio, archivio con righe, filtri e dettaglio, nessun overflow orizzontale a 320/390px. Corretto in questa fase il colore semantico dei pulsanti Accetta/Rifiuta nel tema chiaro, che il tema sovrascriveva. Non è stata usata alcuna sessione o dato di produzione.
- **LIMITI / DA FARE:** nessuna verifica browser o dispositivo autenticato e nessuna prova su dati reali; l’archivio dipende dalle tabelle `booking_history`/`waitlist_history` già installate e la ricerca per nome richiede che il caricamento dei nomi riesca (in caso contrario restano disponibili numero e dettagli). I contatti nel dettaglio usano letture RLS ADMIN; nessun backfill di eventi o richieste storiche. La pagina resta protetta dal ruolo ADMIN esistente, unico ruolo disponibile: non è stato introdotto un ruolo “titolare” separato. Il breakpoint della lista è 700px; iPad e desktop restano sulla piantina.
- **DEPLOYATO:** commit `e334642` pubblicato su `origin/main`; Vercel Production serve il bundle `index-ec3lsgo8.js` con i chunk `ArchivePage-BuBDgOyt.js` e `CustomerRequestsPage-oI-kVuqi.js`. **VERIFICATO IN PRODUZIONE (sola lettura):** `/archivio`, `/attivita`, `/richieste-clienti` e `/prenotazioni` rispondono HTTP 200; entrambi i chunk rispondono HTTP 200 e il bundle contiene la route `/archivio`. Nessuna UI autenticata, sessione o dato letto. **DA FARE:** verifica autenticata su desktop e iPhone. Preservate le modifiche preesistenti a `.env.example` e `AGENTS.md`.

## Riallineamento .env.example e guida ambienti — 29 ottobre 2026
- **IMPLEMENTATO LOCALMENTE (solo documentazione):** `.env.example` dell’Agenda riorganizzato tra variabili browser (`VITE_*`), server del gateway (`API_PROXY_TARGET`, `AGENDA_BACKEND_SECRET`) e secret delle Edge Function Supabase; rimossa `AGENDA_EMAIL_FROM` non letta dal codice. Creato `../AMBIENTI.md` con matrice e checklist Production.
- **Evidenze:** chiavi confrontate con `api/agenda-gateway.js`, `vite.config.js` e le Edge Function; `git diff --check` superato. **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessuna variabile Vercel/Supabase modificata. Su richiesta successiva il `.env` locale è stato deduplicato e `RESEND_API_KEY` è stata rimossa (appartiene ai secret Supabase; resta nel backup).

## Notifiche richieste cliente verso la pagina di gestione — 24 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** gli avvisi “Richiesta cliente” della campanella aprono ora la pagina `/richieste-clienti` invece della Giornata, dove non esistevano i comandi di decisione. Il collegamento include l’identificativo della richiesta (`#request-<id>`); la pagina porta l’elemento in vista, lo evidenzia per pochi secondi e mostra **Accetta** e **Rifiuta**. Rifiuta apre il pannello con **Conferma rifiuto e invia email** e **Annulla**. Un identificativo non valido porta comunque alla pagina senza parametri. La lettura del frammento non provoca navigazioni o finestre automatiche.
- **File:** `src/utils/adminNotifications.js`, `src/components/BookingRequests.jsx`, `src/styles/admin-operations.css`, test `adminNotifications`, `bookingRequestDecisionEmail` e `bookingCancellationUi` e questo registro. Backend, Edge, database e template invariati.
- **Verifiche locali:** suite Agenda 307/307, build Vite e `git diff --check` superati; nuovi controlli sul collegamento `customer_request` e sul comportamento senza navigazione automatica.
- **DEPLOYATO:** commit `b9c8006` su `main`; Vercel Production `dpl_Aip7AgFTjLq6A1BwGc3gigroK4Ya` READY su `agenda-makai.vercel.app`.
- **VERIFICATO IN PRODUZIONE:** `/richieste-clienti` HTTP 200 con bundle `index-BgATEFu9.js` e chunk `CustomerRequestsPage-CwpoIEyF.js` HTTP 200. La verifica del clic autenticato dalla campanella resta da fare con l’account dello staff. **DA FARE:** prova autenticata del collegamento notifica → pagina e del pannello Conferma/Annulla.

## Richieste cliente: accetta, rifiuta motivato ed email — 24 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** nuova gestione delle richieste cliente nella pagina `/richieste-clienti` dell’Agenda, con collegamento “Richieste clienti” nel menu e conteggio delle sole richieste in attesa. **Accetta** applica la modifica con la RPC atomica esistente e invia al cliente l’unica email “Prenotazione modificata” già accodata dal trigger delle comunicazioni, riusando `communications/prepare` e `send-template-email`; per una cancellazione approvata resta il percorso email di cancellazione esistente. **Rifiuta** apre un pannello con motivazione obbligatoria (1–500 caratteri), salvata sulla richiesta e scritta nell’email al cliente insieme al link al calendario del sito `https://www.makaipigneto.it/prenotazioni` per scegliere un altro giorno o orario; il rifiuto non modifica la prenotazione. Solo email, senza pulsante WhatsApp.
- **Server e database:** migrazione locale `20261024120000_booking_request_decisions.sql` con colonne `rejection_reason` e stato dell’email di decisione, trigger aggiornato (motivo obbligatorio, snapshot immutabile, nessuna email per le approvazioni), RPC `admin_review_booking_request_with_reason` e claim server-only `admin_booking_request_email_operation` con un solo tentativo atomico. La vecchia RPC di rifiuto senza motivo viene bloccata dal trigger. Nuovo endpoint Backend `POST /api/admin/bookings/requests/{id}/reject` dietro il gateway ADMIN, Edge `send-booking-email` con `type: booking_request_rejected`, nuovo template cliente “Richiesta di modifica non accolta” con motivazione e calendario. Nessun backfill delle richieste storiche.
- **File Agenda:** `src/components/BookingRequests.jsx`, nuovi `src/components/CustomerRequestsNavLink.jsx` e `src/pages/CustomerRequestsPage.jsx`, `src/App.jsx`, `src/utils/bookingRequests.js`, `src/styles/admin-operations.css`, `api/agenda-gateway.js`, `vercel.json`, `supabase/functions/agenda-communications/messages.js`, `supabase/functions/send-booking-email/{index.ts,bookingRequest.js}`, nuova migrazione, test `bookingRequestDecisionEmail`, `bookingRequestDecisionsSql`, aggiornamenti a `bookingRequests`, `bookingCancellationUi` e `customerCommunicationCopy`, `docs/{booking-requests,TEMPLATE_MESSAGGI_CLIENTI}.md` e questo registro. **File Backend:** `api/booking_request_decisions.py`, `app.py`, `tests/test_booking_request_decisions.py`.
- **Verifiche locali:** suite Agenda 307/307, build Vite riuscita (incluso il chunk `CustomerRequestsPage`), Backend 181 test con 101 subtest, `git diff --check` superato in entrambi i repository. Il test PGlite su schema minimo verifica motivo obbligatorio, blocco della vecchia RPC, snapshot e stato email, claim unico, esito con provider, rollback, autorizzazione e servizio; i test Edge/client simulano trasporto, esiti e assenza di apertura automatica di finestre. Test Backend con `.env` e database reale non usati; nessuna equivalenza dichiarata con una prova live.
- **Limiti / DA FARE:** nessuna email reale e nessuna verifica browser/dispositivo autenticato. L’accettazione dipende dalla coda `booking_communications` già installata in produzione: se la risposta dell’invio si perde, l’esito resta incerto e va verificato nel log, mentre la modifica è già salvata. Un’email non disponibile non annulla mai la decisione. Le richieste rifiutate prima di questa migrazione non hanno motivazione né email e non vengono riscritte. Resta da allineare il repository alle due migrazioni già applicate in Production ma assenti localmente (`20261022154856` e `20261022155745`). Prova controllata su indirizzo di test e verifica della pagina autenticata ancora da fare.
- **DEPLOYATO:** migrazione `20261024120000_booking_request_decisions` applicata a Production con `psql` e registrata in `supabase_migrations.schema_migrations`; Edge `send-booking-email` versione 24 ACTIVE con `verify_jwt` attivo; Backend commit `a95a86e` su `main`, Vercel Production `dpl_39omNE16SyyG8qT621YS8frZKYHg` READY; Agenda commit `f9013cd` su `main`, Vercel Production `dpl_HQsRXsotMzKErHBxWzKzPUQhf9AN` READY come alias di `agenda-makai.vercel.app`. Backup mirato e script di rollback preparati fuori dal repository; esclusi dai commit `AGENTS.md`, `package-lock.backup.json`, `supabase/.temp/` e le modifiche Backend preesistenti (`.env.example`, moduli gestionale).
- **VERIFICATO IN PRODUZIONE (sola lettura, nessun invio):** colonne e RPC presenti con permessi corretti (`authenticated` sulla decisione, solo `service_role` sul claim), trigger aggiornato, migrazione registrata; Edge risponde `400` con «Richiesta non valida» a un `requestId` non valido, senza tentare invii; Backend `/api/health` 200 e nuova route `POST /api/admin/bookings/requests/1/reject` presente (401 senza sessione); Agenda serve `/richieste-clienti` 200 con bundle `index-DarGsgG4.js` e chunk `CustomerRequestsPage-6lcJAOzv.js`. Nessuna email reale, nessuna richiesta cliente letta o modificata durante le verifiche.

## Cancellazione con email automatica e WhatsApp di ripiego — 21 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** i tasti di cancellazione nella Giornata e l’approvazione di una richiesta di cancellazione chiedono una sola conferma, salvano la decisione tramite le RPC esistenti e avviano automaticamente l’email. Riutilizzato l’evento lifecycle `cancelled` tramite `communications/prepare` → `send-template-email`, senza creare template aggiuntivi o generare link personali. Invio automatico solo con stato `queued` e zero tentativi; gli altri esiti non vengono reinviati automaticamente. Il claim server e l’idempotenza esistenti restano l’autorità contro i duplicati.
- **Interfaccia:** con email accettata dal provider appare soltanto “Cancellazione confermata.”; email assente/non valida (`skipped`), fallita (`failed`) o respinta (`bounced`) rendono disponibile WhatsApp facoltativo, se il numero è valido. Nessuna apertura automatica. La stessa priorità vale nei contatti compatti e nel pannello comunicazioni delle prenotazioni cancellate. Esiti incerti/in corso richiedono consultazione del log e non mostrano WhatsApp. Un problema email conserva sempre la cancellazione e non viene indicato come consegna riuscita.
- **File:** `src/utils/bookingCancellation.js`, `src/components/BookingCancellationFeedback.jsx`, `src/pages/BookingsPage.jsx`, `src/components/{BookingRequests,BookingCommunications,BookingContacts}.jsx`, `src/utils/bookingRequests.js`, test `bookingCancellation*.test.js` e questo registro. Nessuna modifica a Backend, Edge, template cliente o SQL; preservati `AGENTS.md`, backup lockfile e `supabase/.temp/` preesistenti.
- **Verifiche locali:** suite Agenda 298/298, build Vite e `git diff --check` superati. Nuovi test con sessione/RPC/HTTP simulati: rifiuto della conferma, scrittura fallita senza invio, salvataggio prima dell’email, approvazione/rifiuto richieste, riuso evento, nessun retry automatico, errori e risposte incerte, feedback e disponibilità WhatsApp. I test SQL esistenti della suite verificano il lifecycle e il claim in database isolato.
- **Limiti / DA FARE:** verifica browser/dispositivo autenticato e ricezione reale dopo eventuale pubblicazione autorizzata. L’avvio dell’invio avviene dalla pagina dopo la RPC: chiudere la pagina o perdere la connessione prima della richiesta email può lasciare il messaggio in coda; nessun nuovo worker o recupero automatico aggiunto. Compatibilità del Backend/Edge distribuiti non verificata live in questo intervento; accettazione del provider non equivale a consegna.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessuna email reale, mutazione Production o deploy.

## Correzione caricamento coda DOPOCENA — 20 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** corretto l’errore in produzione `client.rpc(...).catch is not a function`: il builder Supabase non espone `.catch`. La lettura degli esiti email ora usa `try/catch`; se la RPC degli esiti non è disponibile la coda resta visibile con stato `unknown`. Aggiunti due test di regressione (thenable senza `.catch` e RPC in errore).
- **File:** `src/utils/onlineDopocenaRequests.js`, `tests/onlineDopocenaRequests.test.js` e questo registro. Nessuna modifica a database, Edge, Backend o template.
- **Verifiche locali:** test DOPOCENA 7/7, suite Agenda completa riuscita, build Vite riuscita.
- **DEPLOYATO:** commit `2dc3c7c` su `main`; Vercel Production Ready (20 ottobre 2026, 14:27) e bundle `index-CqiZ-cg3.js` servito. **VERIFICATO IN PRODUZIONE:** bundle aggiornato servito dal dominio; resta da ricaricare la pagina autenticata Richieste DOPOCENA per confermare la scomparsa dell’errore.

## Email prima, WhatsApp solo come ripiego DOPOCENA — 20 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** dopo Accetta/Rifiuta il canale principale è l’email. Il collegamento WhatsApp non viene più proposto come scelta ordinaria: compare solo se l’email non ha raggiunto un indirizzo valido (`skipped`: email assente/non valida) o se il provider l’ha rifiutata (`failed`). Con esito `queued`, `sending`, `accepted` o `unknown` non viene mostrato alcun invito WhatsApp. Stessa regola in archivio; etichetta aggiornata in “Apri WhatsApp (email non disponibile)” e testo del pannello di rifiuto corretto (motivazione nell’email; WhatsApp solo alternativo). Nessuna apertura automatica di finestre.
- **File:** `src/utils/onlineDopocenaRequests.js` (nuovo `dopocenaWhatsAppFallbackAllowed`), `src/components/OnlineDopocenaRequests.jsx`, `tests/{onlineDopocenaRequests,dopocenaDecisionEmail,dopocenaRejectionPanel}.test.js` e questo registro. Backend, Edge, SQL e template invariati.
- **Verifiche locali:** suite Agenda 291/291 e build Vite riuscite. Nessuna prova browser/dispositivo, nessuna email reale, nessuna modifica a database o Supabase.
- **DEPLOYATO:** Edge `send-booking-email` versione 23 (20 ottobre 2026, 12:07 UTC, `verify_jwt` attivo); migrazioni `20261020111054` e `20261020114339` applicate su Production con `psql` e registrate in `supabase_migrations.schema_migrations`; Backend Production `backend-makai-o1vizfk8q` Ready, poi ridistribuito dal push `32e65ce`.
- **PUBBLICATO SU GITHUB:** Agenda `main` aggiornato con merge `9b5227e` (include `9422d98`, WhatsApp solo come ripiego) e Backend `main` con merge `32e65ce`; push confermati dal remoto.
- **VERIFICATO IN PRODUZIONE:** struttura database confermata in sola lettura (tabella `private.dopocena_decision_emails`, funzioni `admin_dopocena_email_outcomes`/`admin_review_dopocena_with_reason`/`dopocena_email_operation`, trigger `queue_dopocena_decision_email`/`require_dopocena_rejection_reason`/`zz_attach_dopocena_rejection_reason`). Vercel Production Agenda e Backend risultano Ready (20 ottobre 2026, 14:15); l’Agenda serve il bundle `index-CJUhuiMr.js` e l’OpenAPI Backend espone `POST /api/admin/bookings/dopocena-requests/{request_id}/decision`. Gateway Agenda risponde 401 senza sessione e Backend 403 senza credenziale, quindi le route esistono.
- **DA FARE:** prova controllata di ricezione reale su un indirizzo di test; nessuna email reale inviata finora.

## Verifica email automatiche Accetta/Rifiuta DOPOCENA — 20 ottobre 2026
- **IMPLEMENTATO LOCALMENTE (solo lettura del codice):** confermato che Accetta e Rifiuta inviano una email automatica al cliente, una sola per richiesta. Catena verificata: `OnlineDopocenaRequests.jsx` → `reviewOnlineDopocenaRequest` → `POST /api/admin/bookings/dopocena-requests/{id}/decision` (gateway `api/agenda-gateway.js`) → Backend `api/dopocena_decisions.py` → RPC di decisione → trigger `private.queue_dopocena_decision_email` (stato `queued`, oppure `skipped` se email assente/non valida) → Edge `send-booking-email` (`type: dopocena_decision`, `dopocena.js`) → Resend. Template distinti: accettazione = conferma con link personale di gestione; rifiuto = template “Richiesta DOPOCENA rifiutata” con motivazione e link per riprenotare.
- **Garanzie:** chiave primaria per richiesta, claim atomico `queued`→`sending`, `Idempotency-Key` Resend stabile, nessun retry automatico di `failed`/`unknown`/`sending`; la conferma generica creata dall’INSERT viene annullata nella stessa transazione. Un errore email non annulla la decisione e l’esito (`accepted` Resend, `failed`, `unknown`, `skipped`) è mostrato in coda. “Accettata da Resend” non equivale a consegna.
- **Limiti:** verifica statica dei sorgenti locali sul ramo `codex/dopocena-email`, nessuna esecuzione di test, nessuna chiamata API, nessuna email reale.
- **DEPLOYATO:** non attestato per questo flusso. **VERIFICATO IN PRODUZIONE:** no: migrazioni `20261020111054` e `20261020114339`, Edge e Backend risultano ancora da attivare in modo coordinato secondo il registro. **DA FARE:** attivazione autorizzata e prova controllata di ricezione su un indirizzo di test.

## Push motivazione rifiuto DOPOCENA — 20 ottobre 2026
- **IMPLEMENTATO LOCALMENTE / SALVATO SU GITHUB:** richiesta esplicita di push eseguita sui rami `codex/dopocena-email`: Agenda `16f029b`, Backend `744d55b`; entrambi confermati dal remoto. Nessuna modifica a `main` in questo intervento. Esclusi i file preesistenti estranei (`AGENTS.md`, backup lockfile e proposta Backend sui segreti).
- **Evidenze:** contenuto applicativo invariato rispetto alle verifiche dell’intervento precedente: Agenda 290/290, Backend 166 test con 39 sottocasi, Edge 15 passaggi simulati e build Vite riuscita; controlli Git dei file preparati superati.
- **DA FARE:** attivazione coordinata delle migrazioni `20261020111054` e `20261020114339`, Edge e applicativi, dopo autorizzazione separata. **DEPLOYATO:** non attestato per questi rami; nessun deploy manuale, SQL applicato o aggiornamento Edge eseguito. Eventuali Preview automatiche non verificate. **VERIFICATO IN PRODUZIONE:** no. Nessuna email reale o mutazione dati Production.

## Pannello motivazione rifiuto DOPOCENA — 20 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** “Rifiuta” apre un pannello nella scheda con campo obbligatorio (massimo 500 caratteri), avviso che il testo sarà condiviso col cliente, conferma esplicita e “Annulla”. L’apertura e l’annullamento non salvano decisioni e non inviano messaggi. Il rifiuto confermato conserva la motivazione nell’email privata, nell’archivio staff e nel WhatsApp precompilato anche dopo ricaricamento; nessuna apertura automatica della chat.
- **Server/SQL:** validazione API e nuova RPC autenticata `admin_review_dopocena_with_reason` richiamano la funzione di decisione esistente senza modificarne le regole. Trigger prima/dopo l’UPDATE impongono la motivazione e la aggiungono allo snapshot nella stessa transazione di decisione/coda; la vecchia chiamata diretta non può più rifiutare senza motivo. Replay con motivo diverso rifiutato, motivo salvato immutato e nessuna seconda email. L’Edge non invia nuovi rifiuti con motivo mancante. Rifiuto senza booking, errore email e decisione persistente restano gestiti.
- **Migrazione preparata, non applicata:** `supabase/migrations/20261020114339_dopocena_rejection_reason.sql`, successiva alla migrazione email `20261020111054`. Nessun backfill delle decisioni storiche, nessuna modifica alle regole tavoli o al limite di 25 persone.
- **File Agenda:** `src/components/OnlineDopocenaRequests.jsx`, `src/utils/onlineDopocenaRequests.js`, `src/styles/admin-operations.css`, `supabase/functions/agenda-communications/messages.js`, `supabase/functions/send-booking-email/{dopocena.js,index.test.ts}`, nuova migrazione, `tests/{onlineDopocenaRequests,dopocenaDecisionEmail,dopocenaRejectionPanel,dopocenaRejectionReasonSql}.test.js`, anteprima template e questo registro. **File Backend:** `api/dopocena_decisions.py`, `tests/test_dopocena_decisions.py`.
- **Verifiche locali:** Agenda 290/290, Backend 166 test con 39 sottocasi, Edge 15 passaggi simulati, build Vite 121 moduli e diff check superati. Test interazione componente con hook/sessione/trasporto simulati: apertura, limite/obbligatorietà, annullamento, conferma, esito email fallito e WhatsApp con stesso motivo. Test PGlite su schema minimo: trigger, vincoli, replay, autorizzazione e rollback; la RPC originale è simulata nella fixture. Nessuna prova browser/dispositivo o verifica sullo schema live.
- **DA FARE:** pubblicazione futura coordinata di entrambe le migrazioni, Edge, Backend e Agenda, con autorizzazione separata e verifica controllata. **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nuove modifiche soltanto locali sui rami `codex/dopocena-email`, senza ulteriori commit/push/deploy, email reali o dati Production. Preservati i file estranei preesistenti.

## Commit e push su rami dedicati — 20 ottobre 2026
- **IMPLEMENTATO LOCALMENTE / SALVATO SU GITHUB:** dopo richiesta esplicita dell’utente, commit Agenda `ac1cd24` e integrazione `30d3758`, Backend `44ea7cf`, inviati ai rispettivi rami `origin/codex/dopocena-email`. `main` non modificato da questo intervento. Prima del push integrati nel ramo Agenda i due commit remoti già presenti `938bf6c` e `2983ce2`, risolvendo soltanto la sovrapposizione nel documento di stato e preservando entrambe le sezioni.
- **Evidenze:** entrambi i push confermati da GitHub; suite Agenda sulla versione unificata 287/287, Backend 164 test con 39 sottocasi, Edge 15 passaggi simulati, build Vite 121 moduli e controlli diff superati. Esclusi `AGENTS.md` e `package-lock.backup.json` preesistenti di Agenda e `docs/proposta_rotazione_push_secret.md` del Backend.
- **DA FARE:** attivazione coordinata della migrazione mirata, dell’Edge e dei due applicativi; integrazione dei rami in `main` e verifica completa soltanto con autorizzazione separata. Il push Git non installa la migrazione né aggiorna la funzione Supabase. Eventuali Preview automatiche non verificate.
- **DEPLOYATO:** non attestato per questi rami; nessun deploy/promozione manuale, pubblicazione Edge o SQL Production eseguito. **VERIFICATO IN PRODUZIONE:** no per il nuovo flusso. Nessuna email reale o mutazione dati live durante commit/push.

## Link personale nell’accettazione DOPOCENA — 20 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** il Backend riutilizza `issue_management_link` per la prenotazione DOPOCENA confermata collegata alla richiesta accettata. Token personale, snapshot dell’email e acquisizione dell’unico tentativo vengono salvati nella medesima transazione, con blocco prenotazione -> coda; un errore esegue rollback del token e del tentativo, conservando la decisione già registrata. Replay e stati sending/accepted/failed/unknown non emettono un altro token e non reinviano l’email.
- **Email cliente:** “Gestisci o riconferma la prenotazione” con link HTTPS `/prenotazioni/gestisci#token=…`, per le funzioni di riconferma/modifica/cancellazione già esistenti. L’Edge non invia l’accettazione se manca un link personale formalmente valido. Token casuale emesso dal sistema esistente, hash nella tabella token; URL completo soltanto nello snapshot privato dell’email e nel messaggio cliente, non nella risposta al browser dello staff. Rifiuti restano collegati al calendario pubblico, senza token personale.
- **File:** Backend `api/dopocena_decisions.py`, `tests/test_dopocena_decisions.py`; Agenda `supabase/functions/send-booking-email/dopocena.js`, `supabase/functions/send-booking-email/index.test.ts`, `tests/dopocenaDecisionEmail.test.js`, `docs/TEMPLATE_MESSAGGI_CLIENTI.md` e documenti di stato. Nessuna ulteriore migrazione SQL o modifica alle regole tavoli/capienza.
- **Verifiche locali:** Agenda 285/285, Backend 164 test con 39 sottocasi, Edge 15 passaggi simulati, build Vite 121 moduli e diff check superati. Test Backend senza `.env` e con DB reale bloccato; token/hash, rollback e replay provati con fixture transazionali simulate. La suite Agenda include i controlli SQL isolati esistenti del percorso cliente. Nessuna equivalenza dichiarata con una prova completa su browser/live.
- **DA FARE:** futura attivazione coordinata già prevista di SQL/Edge/Backend/Agenda e verifica controllata apertura/ricezione. Il limite della precedente sezione “Controllo coerenza testi e link” è risolto localmente per l’email automatica di accettazione; non eseguito backfill delle decisioni storiche. **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessuna email reale, lettura/scrittura dati Production, commit, push o deploy.

## Controllo coerenza testi e link — 20 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** il generatore condiviso non propone più gestione/riconferma per template cancelled né per stati pending/rejected/cancelled/arrived/completed/no_show. Rifiuto -> calendario pubblico per riprenotare; prenotazione attiva -> pagina personale, soltanto se il server ha già incluso il relativo link. Non aggiunti nuovi token o flussi di invio. Aggiornati generatore, test customerCommunicationCopy e anteprime.
- **Verifiche:** ispezionata la route Sito `/prenotazioni` e la pagina `/prenotazioni/gestisci`, che offre riconferma, modifica data/ora/persone/note e cancellazione alle prenotazioni confirmed; disponibilità e applicazione della modifica sono controllate dal flusso cliente esistente. 31 test mirati superati, 15 passaggi Edge simulati, build Vite 121 moduli e diff check superati. Nessuna chiamata a dati reali, invio email o verifica browser live.
- **Limite esplicito:** l’email automatica di accettazione DOPOCENA attualmente non genera un link personale di gestione. Le anteprime ora chiariscono che i link su stati attivi compaiono solo se già presenti nello snapshot; non garantiscono un link in ogni invio.
- **DA FARE:** verifica autenticata completa dei percorsi e invii soltanto con autorizzazione separata; eventuale aggiunta futura del link personale all’accettazione DOPOCENA richiede intervento server dedicato. **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessuna modifica a Backend/SQL/Production, commit, push o deploy in questo controllo.

## Rifiuto DOPOCENA: collegamento per riprenotare — 20 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** email e WhatsApp di rifiuto includono “🏴‍☠️ Scegli un’altra data” con `https://www.makaipigneto.it/prenotazioni`, route del calendario/form prenotazioni verificata nei sorgenti del Sito. Escluso il link di gestione/riconferma anche se presente nello snapshot; nessun token personale nel rifiuto. La stessa protezione vale per il template confirmation con stato rejected. Aggiornata l’anteprima DOPOCENA rifiutato in entrambi i canali.
- **File:** `supabase/functions/agenda-communications/messages.js`, `tests/customerCommunicationCopy.test.js`, `tests/dopocenaDecisionEmail.test.js`, `docs/TEMPLATE_MESSAGGI_CLIENTI.md` e questo registro. Altri stati, logica decisione/invio, privacy e database invariati.
- **Verifiche:** 30 test mirati template/comunicazioni/WhatsApp/DOPOCENA superati, ulteriori 4/4 controlli trasporto DOPOCENA dopo aggiunta delle asserzioni sul link nell’email Resend simulata; suite Edge 15 passaggi, build Vite 121 moduli e controllo diff superati. Il link apre la pagina pubblica per una nuova prenotazione, senza inviarla automaticamente. Destinazione verificata nel codice locale, nessuna prova browser live o invio reale.
- **DA FARE:** verifica visuale e futura pubblicazione autorizzata. **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessuna email reale, modifica Production, commit, push o deploy; preservate le modifiche preesistenti.

## Template clienti pirata senza dettagli sui tavoli — 20 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** rivisti esclusivamente testi e formattazione del generatore condiviso `supabase/functions/agenda-communications/messages.js`: saluto “Ahoy” e bandiera pirata anche nelle email, emoji Unicode sui dettagli data/ora/persone; eliminate tutte le righe tavolo e le spiegazioni operative sull’assegnazione, anche dalle accettazioni DOPOCENA. Tono da ciurma per conferma, modifica e ritardo; alleggeriti i testi di arrivo, visita conclusa e mancato arrivo senza cambiare gli stati. Accettazione DOPOCENA resta distinta da richiesta in attesa e rifiuto, senza promessa di un tavolo.
- **Perimetro:** logica, canali, destinatari, consensi, link personali e privacy con relative condizioni, database e flusso email/WhatsApp invariati. La richiesta corrente supera il precedente criterio di mostrare il tavolo se assegnato: nessun dettaglio tavolo nei messaggi al cliente.
- **File:** generatore condiviso, test `customerCommunicationCopy`, `bookingWhatsApp`, `bookingCommunications`, `bookingServiceRules`, `dopocenaDecisionEmail`; anteprime complete generate dal codice in `docs/TEMPLATE_MESSAGGI_CLIENTI.md`; questo registro.
- **Verifiche:** test mirati 29/29 (presenza emoji in email e WhatsApp, codifica/decodifica del link, assenza tavoli e dati operativi, mantenimento link e stati), suite trasporto Edge 15 passaggi; build Vite 121 moduli e `git diff --check` superati. Nessuna verifica visiva su client email/telefono e nessun invio reale: test Unicode e URL non equivalgono a conferma del rendering su ogni dispositivo.
- **DA FARE:** verifica visuale controllata e pubblicazione solo su richiesta separata. **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessuna modifica backend/SQL, email reale, commit, push o deploy in questo intervento; preservate tutte le modifiche preesistenti.

## Decisioni DOPOCENA con email automatica — 20 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** Accetta/Rifiuta passa dal gateway ADMIN al Backend condiviso. La decisione usa la RPC esistente (nessuna modifica alle regole: nessun tavolo automatico, limite DOPOCENA 25 persone). Un trigger prepara atomicamente una sola email per richiesta, anche per il rifiuto senza prenotazione. Backend acquisisce un solo tentativo e usa l'Edge `send-booking-email` e i template esistenti distinti di accettazione/rifiuto; chiavi e service_role restano sul server.
- **Idempotenza/esiti:** chiave primaria sulla richiesta, acquisizione atomica da queued a sending, chiave Resend stabile e blocco del riuso oltre la finestra del provider. Nessun retry automatico di stati failed/unknown/sending; la conferma generica preparata dall'INSERT della prenotazione viene superata nella medesima transazione. Errori email conservano la decisione; esiti incerti o non registrati non vengono indicati come riusciti. “Accettata da Resend” non equivale a consegna. Esito persistente visibile in archivio; WhatsApp è esclusivamente un link manuale facoltativo, senza apertura automatica. Cancellazione della richiesta elimina anche la relativa coda email secondo la retention esistente.
- **File Agenda:** `src/components/OnlineDopocenaRequests.jsx`, `src/utils/onlineDopocenaRequests.js`, `api/agenda-gateway.js`, `supabase/functions/send-booking-email/{index.ts,dopocena.js,index.test.ts}`, `supabase/migrations/20261020111054_dopocena_decision_email.sql`, `scripts/test-email-edge.mjs`, `tests/{onlineDopocenaRequests,adminProxy,dopocenaDecisionEmail,dopocenaDecisionEmailSql}.test.js` e questo registro.
- **File Backend:** `app.py`, `api/dopocena_decisions.py`, `tests/test_dopocena_decisions.py`; aggiornati anche stato Backend e roadmap comune.
- **Verifiche locali:** suite Agenda 281/281; trasporto Edge simulato 15 passaggi; Backend 159 test e 39 sottocasi. Test mirati coprono accettazione, rifiuto senza booking, errori/risposte ambigue, mancata registrazione esito, replay, permessi, rollback SQL, retention e assenza di apertura automatica WhatsApp. Build Vite riuscita (121 moduli); controlli diff superati. Test SQL in PGlite con schema minimo sintetico; non è una copia dello schema live. Test Backend senza caricamento `.env` e con connessione DB reale bloccata; email/HTTP simulati.
- **DA FARE:** attivazione futura coordinata di migrazione mirata, Edge, Backend e Agenda soltanto dopo autorizzazione separata; verifica autenticata browser/dispositivo e prova controllata di ricezione. La migrazione non esegue backfill delle decisioni storiche. In caso di invio incerto serve verificare il provider prima di qualsiasi recupero manuale; nessun pulsante di reinvio aggiunto.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessuna email reale, lettura/scrittura di dati di produzione, migrazione applicata, commit, push o pubblicazione. Conservate le modifiche preesistenti a `AGENTS.md`, `package-lock.backup.json` e la proposta Backend `docs/proposta_rotazione_push_secret.md`.

## DOPOCENA senza assegnazione, orari al minuto e form mobile — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** la creazione DOPOCENA può avvenire senza tavolo; applicazione e script SQL locale applicano un limite indipendente di 25 coperti al giorno. Sono accettati tutti i minuti dalle 22:30 alle 23:59 e le 00:00 come fine del servizio; gli orari CENA restano nei loro slot. La prenotazione non assegnata resta nell’ELENCO e non occupa la MAPPA; dopo assegnazione manuale compare sui tavoli scelti e resta nell’elenco. Il campo Ora mantiene il controllo nativo e rientra nella scheda su viewport stretti.
- **Verifiche locali:** suite completa `npm test` 278/278; `npm run build` riuscita (121 moduli); controlli mirati per creazione senza tavolo, capienza, modifica orario, assegnazione/lista/mappa e `git diff --check` superati. Anteprima mobile controllata a 390×844 e 320×780: input `type=time` entro i bordi della scheda. Non verificato su dispositivo iPhone fisico.
- **PUBBLICATO SU `main`:** commit `938bf6c97d1b31d44e8401a889e726adc2e17502` inviato a `origin/main` il 19 ottobre 2026. Nessun comando di deploy/promozione eseguito; eventuale deploy automatico successivo al push non è stato verificato.
- **Verifica Production in sola lettura:** la RPC `admin_create_after_dinner_booking` e gli helper Production consultati risultano più vecchi: richiedono una capienza/tavolo e ammettono solo slot fissi, senza il limite DOPOCENA indipendente di 25. Nessuna scrittura al database Production né migrazione applicata.
- **DA FARE:** verificare se il push ha attivato un deployment Vercel e controllare il percorso autenticato sull’ambiente appropriato; applicare separatamente gli script SQL solo con autorizzazione concordata. La verifica di anteprima qui riportata è locale e non costituisce verifica live.

## Pubblicazione Agenda e Backend — 19 ottobre 2026
- **DEPLOYATO:** Agenda commit `67f3283af71c19fce61568cc248f90e684bc11ec` inviato a `origin/main`; Vercel Production `dpl_BMrGxXygUGusLWQ6RWDA9h4YS4Ac` READY, alias `agenda-makai.vercel.app`. Backend commit `378e2c79bb28b8bcd9e7357eb9ff62b38464fd66` pubblicato separatamente; la migrazione SQL mirata è registrata in Supabase come `20261019132636_prepare_staff_reconfirmation`.
- **VERIFICATO IN PRODUZIONE:** identità del deployment Agenda e associazione al dominio; GET pubblica del dominio HTTP 200. La funzione SQL privata risulta installata con permesso al solo ruolo server. La variabile `CRON_SECRET` risulta Secret e limitata a Production nel progetto Backend.
- **Evidenze locali:** suite Agenda 276/276, build Vite 121 moduli, test SQL della migrazione in database isolato 7/7 e controlli diff superati prima del push.
- **DA FARE:** verifica autenticata dell'interfaccia su desktop e iPhone, e controllo concordato del ciclo di riconferma senza presumere la consegna email. Nessuna prenotazione reale creata, email reale inviata o UI autenticata osservata in questo rilascio. `AGENTS.md` modificato prima dell'intervento e `package-lock.backup.json` restano esclusi dal commit.

## Apertura diretta pagina DOPOCENA — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** aggiunta la regola Vercel `/richieste-dopocena` → `/index.html`. La route React e il link nel menu erano presenti; mancava il fallback SPA richiesto quando si apre o ricarica direttamente l'indirizzo.
- **DEPLOYATO:** commit `121aa65da1a7b256551fbc10951779a1f98432a6` su `origin/main`; Vercel Production `dpl_5QgZb1ndj3iexubHqCaFdf3C5ig4` READY.
- **VERIFICATO IN PRODUZIONE:** Vercel associa il deployment al commit corretto e lo segna READY. Il recupero HTTP diretto da questa sessione non è riuscito (DNS/accesso Vercel), quindi l'apertura della pagina autenticata resta da verificare con l'account dell'utente.
- **DA FARE:** aprire `https://agenda-makai.vercel.app/richieste-dopocena` dopo il login e confermare la visualizzazione. Nessuna modifica alla logica delle richieste.

## Preparazione rilascio e riconferma — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** corretti i controlli della mappa che facevano riferimento alla vecchia disposizione; preparata `supabase/migrations/20261019132636_prepare_staff_reconfirmation.sql` per installare soltanto la funzione privata mancante. La richiesta manuale può essere ripetuta, mentre quella programmata ha una chiave unica per prenotazione e giorno; le email in coda con link superato vengono annullate.
- **Evidenze:** suite Agenda 276/276 superata; build Vite 121 moduli e `git diff --check` superati. La migrazione è passata in un database SQL locale isolato. Nessuna nuova prova visuale desktop/iPhone in questo passaggio.
- **DEPLOYATO:** dopo autorizzazione esplicita, applicata soltanto la migrazione mirata in Supabase Production, registrata dal servizio come `20261019132636_prepare_staff_reconfirmation`; il file locale è stato allineato a tale versione. Non applicate le altre migrazioni pendenti.
- **VERIFICATO IN PRODUZIONE:** funzione privata installata, eseguibile da `service_role` e non da `authenticated`; sola verifica di metadati, senza leggere prenotazioni o dati cliente.
- **DA FARE:** verificare i deploy applicativi e il percorso completo con un controllo concordato. `CRON_SECRET` è stato predisposto dall'utente sul progetto Vercel Backend e verificato come Secret Production. Il tentativo automatico di configurarlo era stato respinto dal controllo autorizzazioni e non è stato aggirato. Nessun invio email reale durante questa verifica.

## Fila tavoli 15–19 specchiata su iPhone — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** la fila orizzontale della Sala Principale è specchiata nella vista verticale: tavolo 15 a destra e 19 a sinistra. La posizione desktop landscape resta invariata; non cambia la disposizione fisica o l'assegnazione.
- **File:** `src/utils/tableMapPresentation.js`, `tests/tableMapPresentation.test.js` e questo registro.
- **Verifiche e limiti:** il test della sequenza specchiata passa. Nel file di test mirato resta un'asserzione preesistente fallita che si aspetta una vecchia forma di `TableMap.jsx` non modificata in questo intervento (3 test passati, 1 fallito). Build Vite e `git diff --check` superati; nessuna anteprima iPhone.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessun commit, push o deploy.

## Altezza schede Giornata desktop — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** ripristinata la larghezza precedente della colonna; ridotta l'altezza della riga principale e degli indicatori NOTE/RITARDO/NO-SHOW. La griglia desktop tiene nome, dettagli tavolo/stato, coperti e freccia in colonne distinte; tavolo lungo con ellissi. La regola hover usa ora la stessa griglia desktop, evitando che torni al layout a tre colonne.
- **File:** `src/styles/admin-light.css` e questo registro. Nessuna modifica alla logica o ai dati.
- **Verifiche e limiti:** build Vite e `git diff --check` superati; nessuna anteprima desktop/iPhone in questo passaggio.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessun commit, push o deploy.

## Contrasto e accento temi — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** tema chiaro con accento terracotta profondo e tema scuro con terracotta più luminoso. Selettori, pulsanti principali e numero dei coperti nel riepilogo Giornata usano accenti coordinati. Il controllo online distingue aperto (verde) e chiuso (ambra). Nel Calendario le barrette sotto i coperti sono più larghe e spesse, con verde/rosa più saturi nei temi chiaro e scuro. Testo secondario e bordi restano ad alto contrasto; colori di stato dei tavoli invariati.
- **File:** `src/styles/admin-appearance.css` e questo registro. Nessuna modifica alla logica o ai dati.
- **Verifiche e limiti:** regole CSS ispezionate e `git diff --check` eseguito; nessun test, build o anteprima visuale desktop/iPhone in questo intervento.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessun commit, push o deploy.

## Registro nuove prenotazioni online — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** pannello diviso in due blocchi: avvisi da gestire sopra e registro delle nuove prenotazioni online sotto. Registro limitato alle ultime 48 ore dalla creazione, ordinato dalla più recente; include i cambi di stato della prenotazione e non duplica sotto quelle collegate a un avviso ancora aperto. Nessun tasto di lettura/archiviazione nel registro.
- **Accesso:** lettura dei soli campi necessari da public.bookings con sessione ADMIN e policy RLS esistente; nessuna nuova funzione SQL o modifica ai dati. Gli aggiornamenti arrivano dal realtime prenotazioni e dal rinnovo automatico ogni 30 secondi.
- **File:** src/components/AdminNotifications.jsx, src/utils/adminNotifications.js, src/styles/admin-appearance.css e questo registro.
- **Verifiche e limiti:** codice e policy locali ispezionati; nessuna query su dati reali, build, test o anteprima browser eseguiti. La prova visuale desktop/iPhone resta da fare.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessun commit, push o deploy.

## Selettore Aspetto con icone — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** le tre scelte automatico, chiaro e scuro sono rappresentate da icona orologio/aggiornamento, sole e luna. La scelta corrente è evidenziata; i nomi restano disponibili a voce e al passaggio del puntatore.
- **File:** src/components/AppearanceControl.jsx, src/styles/admin-appearance.css e questo registro.
- **Verifiche e limiti:** codice e stili ispezionati; nessun test, build o controllo browser eseguito.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessun commit, push o deploy.

## Notifiche operative e telefono cliente — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** la campanella conta soltanto avvisi che richiedono attenzione: richieste in sospeso, ritardi, tavolo DOPOCENA mancante, riconferme da ricevere, comunicazioni non confermate e conferme online che richiedono invio/verifica. Aggiornamenti informativi del cliente e prenotazioni online la cui conferma è già gestita non entrano nella coda. Preparata la migrazione 20261019190000_auto_resolve_communication_notifications.sql: una comunicazione fallita sparisce dalla coda quando un successivo invio corrispondente risulta accettato/consegnato per lo stesso destinatario e snapshot.
- **Interfaccia:** rimossi filtro “Solo non lette”, pulsante Aggiorna, “Segna come letta” e “Gestita · Archivia”. La coda si aggiorna con i cambi di prenotazione/comunicazioni e conserva il collegamento all'elemento da gestire. Il telefono nella scheda cliente appare subito sotto il nome anche su desktop ed è un collegamento per chiamare.
- **File:** src/components/AdminNotifications.jsx, src/utils/adminNotifications.js, src/components/CustomerCard.jsx, src/styles/admin-appearance.css, supabase/complete-booking-system.sql, nuova migrazione locale e questo registro. Nessuna modifica ai dati o invii.
- **Verifiche e limiti:** modifiche ispezionate localmente; git diff --check superato. Nessun test, build, anteprima browser o prova su iPhone eseguiti in questo passaggio. La migrazione SQL è soltanto preparata localmente e non applicata.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessuna migrazione applicata, commit, push o deploy.

/* Colori ad alto contrasto. L'ora automatica è Europe/Rome: giorno 07–19. */
@media screen {
  :root {
    --ui-color-scheme: light;
    --ui-bg: #faf7f0;
    --ui-surface: #ffffff;
    --ui-surface-soft: #f3f0e8;
    --ui-hover: #eae8df;
    --ui-text: #222b2c;
    --ui-muted: #505f61;
    --ui-disabled: #687778;
    --ui-border: #c9cfca;
    --ui-border-strong: #829393;
    --ui-primary: #245d65;
    --ui-primary-hover: #174b53;
    --ui-on-primary: #ffffff;
    --ui-selected-bg: #e4eff0;
    --ui-selected-text: #234f56;
    --ui-success-bg: #edf4ec;
    --ui-success-text: #355d3e;
    --ui-success-border: #82a68b;
    --ui-warning-bg: #fcf3df;
    --ui-warning-text: #775516;
    --ui-warning-border: #bc9a55;
    --ui-danger-bg: #fbefef;
    --ui-danger-text: #943f49;
    --ui-danger-border: #c88e96;
    --ui-overlay: rgb(30 40 42 / 32%);
    --jade-9: var(--ui-success-border); --jade-11: var(--ui-success-text); --jade-a2: var(--ui-success-bg); --jade-a3: var(--ui-success-bg);
    --ruby-9: var(--ui-danger-border); --ruby-11: var(--ui-danger-text); --ruby-a2: var(--ui-danger-bg); --ruby-a3: var(--ui-danger-bg);
    --amber-9: var(--ui-warning-border); --amber-11: var(--ui-warning-text); --amber-a2: var(--ui-warning-bg); --amber-a3: var(--ui-warning-bg);
  }
  :root[data-agenda-theme="dark"] {
    --ui-color-scheme: dark;
    --ui-bg: #1d2326;
    --ui-surface: #282f32;
    --ui-surface-soft: #30393c;
    --ui-hover: #3b474a;
    --ui-text: #f5f0e5;
    --ui-muted: #c2ccca;
    --ui-disabled: #a7b4b2;
    --ui-border: #566365;
    --ui-border-strong: #94aaa9;
    --ui-primary: #9cc8cb;
    --ui-primary-hover: #bddadd;
    --ui-on-primary: #18383d;
    --ui-selected-bg: #354e52;
    --ui-selected-text: #d4eceb;
    --ui-success-bg: #2a3b30;
    --ui-success-text: #c1ddc4;
    --ui-success-border: #73947a;
    --ui-warning-bg: #423a29;
    --ui-warning-text: #efdaa5;
    --ui-warning-border: #b49b62;
    --ui-danger-bg: #463135;
    --ui-danger-text: #f0c1c7;
    --ui-danger-border: #b9838a;
    --ui-overlay: rgb(6 12 14 / 56%);
  }
  html, body, .admin-shell { background: var(--ui-bg); color: var(--ui-text); }
  .admin-shell { --day-bg: var(--ui-bg); --day-surface: var(--ui-surface-soft); }
  .admin-shell-day .booking-detail-drawer { --admin-panel: var(--ui-surface); --admin-panel-2: var(--ui-surface-soft); }
  .admin-shell-day .agenda-create-compact,
  .admin-shell-day .agenda-create-compact:not(:disabled):hover,
  .admin-shell-private .notification-badge { color: var(--ui-on-primary); }
  .admin-shell-private .notification-badge { background: var(--ui-primary); }
  .appearance-control { display: flex; align-items: center; gap: 8px; color: var(--ui-muted); font-size: 13px; }
  .admin-shell .appearance-control select { min-height: 36px; width: 120px; padding: 6px 8px; border: 1px solid var(--ui-border-strong); border-radius: 8px; background: var(--ui-surface); color: var(--ui-text); font-size: 13px; }
  .admin-shell .admin-header-actions .appearance-control { padding: 0 6px; }
  .admin-shell-day .booking-card-compact .booking-card-name { font-size: 16px; }
  .admin-shell-day .agenda-view-switch button { font-size: 11px; font-weight: 700; }
  .admin-shell-day .agenda-create-text { font-size: 11px; }
  .admin-shell-day .booking-reconfirmation-summary { font-size: 12px; }
  .admin-shell-day .booking-detail-stat { font-size: 13px; }
  .admin-shell-day .booking-detail-stat:first-child { font-size: 12px; }
  .admin-shell-day .booking-detail-stat:first-child > span { white-space: nowrap; }
  .admin-shell-day .booking-detail-stat small { font-size: 11px; }
  @media (min-width: 1101px) {
    .admin-shell-day .booking-card-compact .booking-card-name { font-size: 15px; }
    .admin-shell-private .admin-header-actions { gap: 4px; }
  }
  @media (max-width: 1100px) {
    .admin-shell .admin-header-actions .appearance-control { justify-content: space-between; min-height: 44px; padding: 6px 12px; border-top: 1px solid var(--ui-border); }
  }
}

/* Scheda cliente: il recapito segue il nome ed è subito chiamabile. */
@media screen {
  .admin-shell-day .customer-card-contact { grid-template-columns: minmax(0, 1fr); }
  .admin-shell-day .customer-card-phone a { color: var(--ui-primary); font-weight: 700; text-underline-offset: 2px; }
  .admin-shell-day .notification-panel-help { color: var(--ui-muted); font-size: 13px; }
  .admin-shell-day .notification-item a { color: var(--ui-primary); text-decoration-thickness: 1px; text-underline-offset: 2px; }
}

## Scheda prenotazione senza comando manuale di congelamento — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** rimossi dalla scheda i comandi “Congela assegnazione” e “Sblocca assegnazione automatica”; la scheda mantiene il riepilogo di riconferma e l’avviso DOPOCENA pertinente. Il pannello non invoca più la RPC manuale.
- **Perimetro:** motore, regole di assegnazione, comportamento dei tavoli modificati manualmente e dati non cambiati. La gestione automatica continua a rispettare `operational_frozen` nei casi previsti dal motore; nessuna modifica o applicazione SQL.
- **File:** `src/components/BookingOperationalControls.jsx`, `src/pages/BookingsPage.jsx`, `src/styles/admin-day-reference.css`, `src/styles/admin-light.css` e questo registro.
- **Verifiche locali:** build Vite superata (120 moduli) usando output temporaneo; `git diff --check` superato; ricerca nel codice UI non trova più i due comandi né chiamate alla RPC. I due test mirati non si sono avviati perché Vite ha ricevuto `EPERM` scrivendo `node_modules/.vite-temp` nell'area non scrivibile dal sandbox. Nessuna verifica browser/iPhone.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessun commit, push o deploy.

## Conteggio separato richieste DOPOCENA — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** aggiunto un badge autonomo accanto a “Richieste DOPOCENA” nel menu desktop e mobile. Conta soltanto le richieste `pending`, si aggiorna dopo una decisione, al ritorno sulla scheda e ogni 30 secondi; in caso di errore mostra un trattino, senza fingere un conteggio aggiornato. Le richieste DOPOCENA non entrano più nella coda o nel numero della campanella generale.
- **File:** `src/components/AfterDinnerRequestsNavLink.jsx`, `src/App.jsx`, `src/components/OnlineDopocenaRequests.jsx`, `src/utils/onlineDopocenaRequests.js`, `src/utils/adminNotifications.js`, stili, test e questo registro. Nessuna modifica SQL o ai dati.
- **Verifiche locali:** test richieste DOPOCENA e notifiche 17/17; build Vite superata (121 moduli, output temporaneo); `git diff --check` superato. Nessuna verifica browser/iPhone né Production.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessun commit, push o deploy.

## Tavoli uniti rappresentati con dimensione proporzionale — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** la mappa ritrae i gruppi assegnati come un’unica forma: due tavoli occupano due quadrati affiancati, tre occupano tre; anche l’altezza dell’unità base su iPhone ora è quadrata. Disposizioni, stati, disponibilità e assegnazioni restano invariate.
- **File:** `src/styles/admin-operations.css`, `tests/tableMapResponsive.test.js` e questo registro.
- **Verifiche locali:** test responsive mirati 7/7, test piantina 4/4, build Vite superata (121 moduli, output temporaneo) e `git diff --check` superato. Il test responsive completo conserva un’asserzione preesistente sui breakpoint CSS non più presenti nella versione locale; la verifica del nuovo layout è passata. Nessuna anteprima visuale browser/iPhone.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessun commit, push o deploy.

## Larghezza gruppi uniti nella mappa desktop — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** corrette le regole grafiche desktop/tablet che riportavano i tavoli uniti alla larghezza di un singolo quadrato. I gruppi da due e tre tavoli ora mantengono rispettivamente due e tre unità affiancate anche con il tema di riferimento della Giornata.
- **File:** `src/styles/admin-day-reference.css`, `tests/tableMapResponsive.test.js` e questo registro.
- **Verifiche locali:** test mirati sulla larghezza mobile e desktop 2/2; build Vite superata (121 moduli, output temporaneo); `git diff --check` superato. Screenshot allegato mostrava il problema prima della correzione; nessuna nuova verifica visuale browser/dispositivo.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessun commit, push o deploy.

## Header, stato online e invio manuale della riconferma — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** stato “Aperte” verde e “Chiuse” rosso nei temi chiaro/scuro; etichetta “Area riservata” spostata fuori dal menu accanto al marchio; l’apertura delle notifiche chiude il menu e viceversa. La scheda prenotazione include “Invia richiesta di riconferma”, che prepara e invia l’email dal Backend e mostra l’esito del provider.
- **File Agenda:** `src/App.jsx`, `src/components/AdminNotifications.jsx`, `src/components/BookingOperationalControls.jsx`, `src/components/MobileSection.jsx`, `src/styles/admin-appearance.css`, `src/styles/admin-day-reference.css`, `src/styles/admin-light.css`, `src/styles/admin-mobile.css`, `src/styles/admin-operations.css`, `tests/headerAndReconfirmation.test.js`.
- **Verifiche:** test mirati UI/notifiche/comunicazioni 18/18; build Vite 121 moduli; `git diff --check`. Anteprima locale desktop osservata: etichetta accanto al marchio, stato online verde. Nessuna prova su viewport iPhone, invio email o Production.
- **Limite riconferma:** non è stato aggiunto o applicato SQL. Il pulsante usa il gateway template del Backend e dipende dalla disponibilità di `private.prepare_staff_email`; il helper è presente nello script schema locale, ma la sua presenza nell’ambiente live non è verificata.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no. Nessun commit, push o deploy.

## Verifica collegamento Backend — 29 ottobre 2026
- **VERIFICATO IN LOCALE, SOLA LETTURA:** il gateway Agenda (`api/agenda-gateway.js`) continua a inoltrare `/api/admin/*` al Backend con il Bearer Supabase e `X-Agenda-Backend-Key`. Il segreto `AGENDA_BACKEND_SECRET` locale coincide con quello del Backend e `API_PROXY_TARGET` punta a `https://backend-makai.vercel.app`.
- **Verifica Backend:** `/api/admin/bookings/month` senza header gateway risponde 403; con il solo header condiviso il Backend locale risponde 503 perché il fallback legacy non è configurato, mentre in produzione il gateway invia sempre il Bearer e `require_admin` verifica il token su Supabase Auth.
- **Limiti:** nessuna modifica al codice o alla configurazione Agenda, nessuna chiamata autenticata reale e nessuna verifica Production. Nessun commit, push o deploy.
- **DEPLOYATO:** no. **VERIFICATO IN PRODUZIONE:** no.

## Turni prenotazione e validazioni — 30 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** DOPOCENA 23:00–00:00 (slot 23:00, 23:30, 00:00) e CENA 19:00–22:30. Aggiornati default dell’editor, regex di modifica, validazione dopocena e messaggi. La compatibilità CENA/DOPOCENA resta a 120 minuti.
- **SQL:** nuova migrazione `20261030120000_service_shift_times.sql` con `private.valid_service_slot`, `private.service_capacity`, `private.service_slot_at` e `public.admin_create_after_dinner_booking`. Nuovo test PGlite `tests/serviceShiftTimesSql.test.js`.
- **VERIFICHE LOCALI:** 308/308 test e build Vite superati.
- **DEPLOYATO:** commit `ac6a366` su `origin/main`; Vercel Production `agenda-makai-digkxzxhu-lollo1.vercel.app` READY su `agenda-makai.vercel.app`.
- **SUPABASE PRODUCTION:** migrazione applicata e registrata su `fignmtkbwpbrmllbxoct`; verificati `valid_service_slot` e `service_slot_at` per 23:00/23:30/00:00 e rifiuto di 22:30 dopocena.
- **VERIFICATO IN PRODUZIONE:** homepage Agenda HTTP 200; bundle con i nuovi messaggi “dalle 23:00”.
- **DA FARE:** 3 prenotazioni DOPOCENA future ancora a `22:30` (31/10, 03/11, 10/11) da spostare o annullare; nessun backfill automatico.

## Correzione: tre turni senza sotto orari — 30 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** validazione e modifica accettano solo 19:00 e 21:30 per la cena e 23:00 per il dopocena. `isValidBookingTimeForType` usa elenchi espliciti, non intervalli. Messaggi e default editor allineati.
- **SQL:** nuove migrazioni `20261030140000_three_shifts.sql` e `20261030140100_three_shifts_planner.sql`; test PGlite aggiornato ai tre turni.
- **VERIFICHE LOCALI:** 309/309 test e build Vite superati.
- **DEPLOYATO:** commit `10e0bd5`; Vercel Production `agenda-makai-f6t1f248n-lollo1.vercel.app` READY su `agenda-makai.vercel.app`.
- **SUPABASE PRODUCTION:** migrazioni applicate e registrate; verificati `valid_service_slot` e `service_slot_at` per 19:00/21:30/23:00 e rifiuto di 19:30, 22:30, 23:30 e 00:00.
- **DATI:** nessun backfill. Le prenotazioni cena esistenti restano a orari interni ai due turni; le 3 DOPOCENA future alle 22:30 sono da spostare o annullare.

## Calendario Sito e manutenzione — 30 ottobre 2026
- **CONTESTO:** il Sito distingue ora locale chiuso (grigio) da prenotazioni online chiuse/non prenotabile (rosso). Agenda non è stata modificata in questo passaggio.
- **DEPLOYATO:** Backend `fe019e5`, Sito `e1ba0ab`/`280e251`. Agenda resta al commit `10e0bd5`.
- **NOTA:** la manutenzione globale delle prenotazioni online è ancora attiva; i giorni già presenti in `online_booking_closures` restano invariati.

## Audit pre-apertura — 30 ottobre 2026
- **SQL:** migrazione `20261030140300_online_closure_all_services` applicata e registrata; le chiusure online valgono anche per il dopocena. Migrazione `20261030140400_legacy_table_compatibility` applicata e registrata; le prenotazioni storiche a 20:00/20:30/22:00/22:30 restano compatibili per il riuso tavolo dopo 120 minuti, mentre i nuovi booking restano limitati a 19:00/21:30/23:00.
- **TEST:** 316/316 test e build Vite superati.
- **NOTA:** l’inserimento manuale in Agenda usa ancora un campo orario libero; le validazioni automatiche del flusso online restano sui tre turni.
