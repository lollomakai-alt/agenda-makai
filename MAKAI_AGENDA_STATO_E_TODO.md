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
