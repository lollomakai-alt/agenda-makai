# Audit prima dell'applicazione — 12 ottobre 2026

## Rettifica capienze catalogo — nota storica superata dalla migrazione del 13 ottobre 2026

La nota seguente descrive la regola precedente (13+14=2, capienza CENA 25 e 22+23 escluso dal planner) ed è **superata** dalla migrazione già applicata `table_group_13_14_3_and_22_23_4` (`20261013141346`). La regola corrente è: 13+14=3 fisso; 22 e 23 separati da 2 oppure gruppo 22+23=4, utilizzabile anche dal motore automatico in base a capienza, compatibilità e conflitti. La capienza fisica standard CENA è 26, mentre il limite automatico resta 25 persone per servizio, con conteggi separati CENA/DOPOCENA.

La verifica storica riportata qui si riferiva allo stato dello schema prima dell'applicazione della nuova migrazione; non è prova dello schema attuale. Le funzioni di disponibilità Sito, trigger e concorrenza devono essere nuovamente verificate in sola lettura/ambiente isolato prima di un rilascio.

Le verifiche e i test riportati nei paragrafi successivi precedono la regola aggiornata e non attestano la revisione corrente. Nessun dato è stato modificato e nessun SQL è stato applicato durante questo intervento. La migrazione già applicata non viene duplicata né riscritta.

**Esito: NON PRONTA per il live.** Questo controllo ha letto metadati e aggregati dal progetto Supabase `fignmtkbwpbrmllbxoct` senza modificarlo. I risultati sui dati possono cambiare: ripetere la verifica immediatamente prima di qualsiasi rilascio.

## Verifica finale schema e patch — 13 ottobre 2026

Verifica live in sola lettura disponibile: `table_group_13_14_3_and_22_23_4` è registrata come `20261013141346`; anche `separate_booking_turn_capacity_guard` resta registrata (`20261013115504`). Il catalogo live espone 13+14=3, 22=2, 23=2 e 22+23=4. Questa verifica non ha scritto sul database.

Nel catalogo live 22+23 è una configurazione disponibile, ma il planner automatico live non è attestato: nell'ultimo inventario read-only non risultavano `private.online_table_candidates` né `private.online_slot_status`; `private.service_capacity_for_type` è anch'essa assente e `private.service_capacity(text,text,bigint)` resta una definizione precedente. Il Sito non mantiene cataloghi alternativi: dipende da `private.online_slot_status`. **NOT READY per il flusso online live** finché API e planner condivisi non sono presenti e verificati.

Le patch SQL locali sono aggiornate a 13+14=3 e candidati automatici per 22+23. `private.dinner_physical_capacity()` deriva 26 posti standard; `private.online_slot_status` e il trigger online limitano a 25 persone per turno con conteggi CENA/DOPOCENA separati, includendo prenotazioni ADMIN nei conteggi automatici senza gonfiare i posti fisici. La validazione ADMIN ammette sovracapienza ma mantiene unità di catalogo e conflitti fisici. Le patch locali non duplicano né sostituiscono le due migrazioni già applicate.

Verifica locale aggiornata il 13 ottobre: test mirati Agenda **43/43**; `npm run build` e `git diff --check` superati. La suite completa resta **219/229**: gli stessi 10 test di DOPOCENA/UI/piantina già riportati nello stato Agenda; i casi modificati per catalogo e quota passano. `scripts/test-postgres-concurrency.py` è passato con PostgreSQL 17 temporaneo e due connessioni indipendenti: una scrittura su due per ultimo posto CENA e per 25º coperto DOPOCENA; per un tavolo in conflitto una scrittura su due; conteggi automatici indipendenti (25 CENA, 25 DOPOCENA), nessun conflitto fisico e prova di rollback delle definizioni. Questa prova locale non attesta il live. Nessuna patch SQL applicata live.

La sequenza SQL corrente è stata caricata in un PostgreSQL locale temporaneo (non copia dei dati live). Con due connessioni reali sincronizzate sul lock 734512, i casi CENA 25+1 e DOPOCENA 24+1 hanno accettato una sola INSERT su due per turno; il secondo writer ha ricevuto l'errore di disponibilità/capacità. Il ruolo `service_role` può chiamare la funzione nuova. Con 23 manuali su 22+23, il motore ha ammesso una prenotazione automatica al tavolo 12 e il controllo fisico non ha trovato identificativi duplicati. Questa prova verifica concorrenza PostgreSQL sulla patch locale, non sul database Supabase.

**Esito: NOT READY per il live.** La funzione richiesta dal Sito manca ancora sul database corrente e le RPC/catalogo live sono incompatibili. Inoltre `complete-booking-system.sql` è una migrazione estesa, non una patch isolata della capienza: va rieseguita una rehearsal aggiornata su una copia fedele dello schema live, con controllo di tutte le policy, grant, trigger, rollback e modifiche non inerenti prima di autorizzare l'applicazione. Nessuna SQL è stata applicata live.

Decisione operativa successiva all’audit: le prenotazioni esistenti sono grandfathered e non vanno corrette né ricalcolate; le modifiche manuali ADMIN saltano i nuovi controlli. Questo risolve la richiesta di una decisione dello staff, ma il codice è cambiato dopo l’audit: l’esito resta NON PRONTA finché non si ripetono le verifiche locali e di staging sullo script aggiornato.

La regola è stata estesa al percorso di inserimento manuale ADMIN: slot, quota e capienza restano applicati ai nuovi inserimenti online automatici. L’audit e le prove precedenti non coprono questa revisione.

Le verifiche di concorrenza e ripristino descritte in questo report precedono la modifica alla logica manuale e non attestano la versione corrente.

## Dati esistenti

- `public.bookings`: 205 prenotazioni. Gli stati rilevati sono `confirmed`, `arrived`, `completed`, `cancelled`, `no_show`, coerenti con il vincolo live. Nessun orfano nelle relazioni controllate: storico, richieste, comunicazioni e log, ricevute online, eventi, marketing, lista d'attesa, relativo storico e utenti Auth. I vincoli FK risultano validati.
- Nessuna coppia di prenotazioni attive con lo stesso identificativo fisico di tavolo nello stesso giorno; nessun identificativo fisico ripetuto dentro una singola prenotazione attiva. Il live non ha DOPOCENA futuri assegnati, quindi non offre ancora un caso reale per verificare il passaggio CENA/DOPOCENA.
- Le regole nuove trovano **14** prenotazioni con più di 6 persone e **18** CENA fuori dagli slot da 30 minuti; tra le prenotazioni attive future i conteggi sono rispettivamente **8** e **11**. Due prenotazioni online future assegnano `tables='15'`, che non è un gruppo del catalogo SQL (`10+11`, `12`, `13+14`, ecc.).
- Le CENA attive future del **15 ottobre** hanno 30 coperti, del **23 ottobre** 28, del **30 ottobre** 36. Il piano fisico nuovo ha 25 posti. Esempi senza dati personali: il 30 ottobre la prenotazione 52 ha 30 persone e nessun tavolo; il 14 ottobre la prenotazione 15 usa il gruppo non valido `15`.
- La migrazione non modifica queste righe. La logica aggiornata tratta gli assegnati come occupazioni fisse e non inserisce nel piano i record esistenti senza tavolo; una nuova prenotazione automatica può comunque essere rifiutata se non trova un’unità fisica compatibile. Le modifiche manuali non vengono respinte né provocano riassetti. Non correggere automaticamente le prenotazioni.

## Schema e sicurezza live

- I trigger prerequisito su `bookings` e `booking_requests` risultano attivi: preparazione, conflitti fisici, storico, no-show, richieste, email e protezione online. Le funzioni `private.dinner_after_dinner_compatible` e `private.service_capacity_for_type` non sono ancora presenti: `dinner-after-dinner-turnover.sql` è davvero un prerequisito non applicato.
- Il trigger live `y_enforce_daily_booking_capacity_25` somma la CENA e il DOPOCENA confermati online nello stesso giorno. Bloccherebbe la quota indipendente richiesta. La migrazione locale ora lo rimuove, conservandone la definizione nel baseline.
- `bookings` ha RLS attivo, ma conserva la policy `booking_owner_delete` e il GRANT `DELETE` ad `authenticated`: un proprietario autenticato può cancellare fisicamente una propria riga. La migrazione locale ora revoca questo percorso. `booking_requests` ha policy admin per SELECT/INSERT/UPDATE; le tabelle delle comunicazioni non concedono accesso diretto ad anon/authenticated.
- Le RPC admin live controllate sono eseguibili da `authenticated`, non da `anon`; i claim email e le altre RPC email `SECURITY DEFINER` sono eseguibili da `service_role`, non da `anon` o `authenticated`. Le funzioni private `SECURITY DEFINER` non sono eseguibili direttamente da anon/authenticated e hanno `search_path` fissato. Il nuovo SQL concede a `service_role` l'USAGE dello schema `private`, che oggi non possiede.
- `public.rls_auto_enable()` è una funzione `SECURITY DEFINER` con EXECUTE concesso a PUBLIC, anon e authenticated; l'event trigger `ensure_rls` la usa per abilitare RLS sulle nuove tabelle pubbliche. L'advisor Supabase lo segnala. Le due utenze non hanno CREATE su `public`, e il tipo di ritorno `event_trigger` ne limita l'uso normale come RPC. Il GRANT resta eccessivo e va riesaminato separatamente; questo lavoro non modifica la sicurezza live.

## Concorrenza PostgreSQL

`scripts/test-postgres-concurrency.py` avvia PostgreSQL 17 in una directory temporanea, applica la fixture SQL e poi `complete-booking-system.sql`. Crea due connessioni indipendenti per ciascuno di quattro casi:

| Caso | Esito |
| --- | --- |
| Due CENA per l'ultimo tavolo da 2 | Una confermata, una rifiutata (`P0001`); 25 coperti finali. |
| Due DOPOCENA che porterebbero da 24 a 26 | Una confermata, una rifiutata (`P0001`); 25 coperti finali. |
| Due assegnazioni simultanee dello stesso tavolo | Una confermata, una rifiutata (`23505`). |
| Cancellazione con lock trattenuto e nuova prenotazione | Entrambe confermate nell'ordine corretto; nessun tavolo fisico condiviso. |

Il test verifica inoltre che la migrazione tolga il vecchio trigger giornaliero, la policy DELETE e il relativo GRANT, e che 25 coperti CENA più un coperto DOPOCENA nello stesso giorno siano ammessi. Non usa dati o credenziali live.
Sulla stessa copia temporanea ripristina poi le 17 definizioni precedenti archiviate, `private.service_capacity`, il vecchio trigger giornaliero e il vincolo originale delle comunicazioni; il ripristino è riuscito. La prova non copre un rollback dopo traffico reale, né la configurazione gestita della publication Supabase.

## Definizioni precedenti e piano di ripristino

Il file `complete-booking-system-live-baseline.json` conserva **prima di ogni applicazione** le definizioni live di 17 funzioni sostituite, 14 trigger, 12 policy, 86 righe di GRANT, 23 vincoli, la publication Realtime e gli ACL dello schema. Contiene anche la funzione di capienza precedente al prerequisito, il vecchio trigger giornaliero e `rls_auto_enable`. Non contiene prenotazioni né segreti. Verificare nuovamente lo schema alla data di rilascio e rigenerare questo baseline se cambia.

1. **Errore durante l'applicazione:** lo script usa un'unica transazione. Un errore prima del `COMMIT` annulla le modifiche dello script. Controllare che non siano state applicate separatamente migrazioni prerequisito prima dell'errore.
2. **Dopo il COMMIT, prima di nuovo traffico:** mettere in pausa i canali di scrittura di sito, Agenda, worker e invii; conservare un backup o punto di ripristino Supabase. In una transazione con lock `734512`, rimuovere il nuovo trigger `zzz_rebalance_booking_event`, ripristinare con `CREATE OR REPLACE FUNCTION` le definizioni del baseline e ripristinare il trigger `y_enforce_daily_booking_capacity_25` dalla definizione salvata. Se `dinner-after-dinner-turnover.sql` è stato applicato apposta per questo rilascio, ripristinare anche la versione precedente di `private.service_capacity`.
3. Ripristinare il vincolo `booking_communications_kind_check` originale soltanto se non esistono comunicazioni dei nuovi tipi. Confrontare policy, GRANT e publication con il baseline; revocare le nuove RPC quando il backend precedente è tornato operativo. Il vecchio GRANT/policy di cancellazione fisica è archiviato per tracciabilità, **ma non va riattivato** perché perderebbe prenotazioni storiche.
4. Conservare colonne, tabelle token/archivi, prenotazioni, storico e comunicazioni. Non usare `DROP ... CASCADE`, `DELETE` o un ripristino che sovrascriva prenotazioni acquisite dopo il backup. Se è già transitato traffico con `00:00`, nuovi tipi email o quota DOPOCENA indipendente, fare una correzione in avanti: un rollback delle sole funzioni precedenti potrebbe interpretare male quei record o rifiutarli.
5. Su una copia isolata, confrontare funzioni, trigger, policy, privilegi e vincoli con il baseline; verificare prenotazioni e relazioni, quindi riaprire i canali solo dopo la revisione. Il piano è preparato, non eseguito sul live.

## Condizioni per cambiare l'esito

Decisione dello staff: le prenotazioni già presenti restano invariate; le anomalie rilevate non richiedono correzioni o spostamenti prima della migrazione. Le modifiche manuali non attivano i nuovi controlli e non ricalcolano le altre prenotazioni. Restano da ripetere gli aggregati live in sola lettura e la prova della migrazione su una copia aggiornata e rappresentativa; verificare inoltre RLS/RPC con ruoli reali e coordinare il rilascio delle applicazioni. L’esito precedente resta **NON PRONTA** finché questi controlli aggiornati non sono completati.
