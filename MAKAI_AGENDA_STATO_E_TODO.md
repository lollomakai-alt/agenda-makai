## DOPOCENA senza assegnazione, orari al minuto e form mobile — 19 ottobre 2026
- **IMPLEMENTATO LOCALMENTE:** la creazione DOPOCENA può avvenire senza tavolo; applicazione e script SQL locale applicano un limite indipendente di 25 coperti al giorno. Sono accettati tutti i minuti dalle 22:30 alle 23:59 e le 00:00 come fine del servizio; gli orari CENA restano nei loro slot. La prenotazione non assegnata resta nell’ELENCO e non occupa la MAPPA; dopo assegnazione manuale compare sui tavoli scelti e resta nell’elenco. Il campo Ora mantiene il controllo nativo e rientra nella scheda su viewport stretti.
- **Verifiche locali:** suite completa `npm test` 278/278; `npm run build` riuscita (121 moduli); controlli mirati per creazione senza tavolo, capienza, modifica orario, assegnazione/lista/mappa e `git diff --check` superati. Anteprima mobile controllata a 390×844 e 320×780: input `type=time` entro i bordi della scheda. Non verificato su dispositivo iPhone fisico.
- **Verifica Production in sola lettura:** la RPC `admin_create_after_dinner_booking` e gli helper Production consultati risultano più vecchi: richiedono una capienza/tavolo e ammettono solo slot fissi, senza il limite DOPOCENA indipendente di 25. Nessuna scrittura al database Production, nessuna migrazione applicata e nessun deploy.
- **DA FARE:** concordare/applicare in un intervento separato gli script SQL aggiornati all’ambiente, quindi verificare il percorso autenticato sull’anteprima prima di qualsiasi promozione. Questa modifica è su branch dedicato e non aggiorna `main`.

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
