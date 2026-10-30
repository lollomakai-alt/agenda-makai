# Mappa tavoli ADMIN

Nella giornata ADMIN: piantina con 14 tavoli fisici e 13 assegnazioni ammesse
(alcune sono alternative): Sala Principale 10–19, Sala Nami 20–23.
Inventario fisico da tables.json; combinazioni e capienze da TABLE_ASSIGNMENTS.
Capienze delle unità: 10+11 = 3, 13+14 = 3, 15+16 = 4, 15+16+17 = 6,
18+19 = 4, 20+21 = 4 e 22+23 = 4. Gli altri gruppi restano singoli da 2.

Stati per data/tipo:
- confermata: prenotato;
- arrivato/completata: occupato, conservando il blocco giornaliero esistente;
- cancellata/no_show: non bloccante;
- stato storico mancante: confermata; stato sconosciuto: occupato conservativamente.
Lo stato sala include tutta la giornata e CENA/DOPOCENA; occupato prevale su in
arrivo. “Da assegnare” è chiuso sotto la piantina e mostra insieme CENA e
DOPOCENA in ordine cronologico.

Click mostra tutte le prenotazioni collegate, orario, persone, tipo e stato;
il collegamento apre la prenotazione. Sono indicate le combinazioni del tavolo.
Assegnazione per prenotazioni confermate/arrivate: selezionare prenotazione e
combinazione disponibile. La scelta sostituisce esplicitamente l'intera vecchia
assegnazione. Nessun drag&drop, nessuna modifica a cliente/data/ora/persone/note.

Riusa validateBookingEdit, conflitti fisici e configurazioni 15–19,
saveBookingEdit/admin_update_booking, controllo optimistic concurrency,
trigger Supabase e storico esistenti. Anche con snapshot client obsoleto, un
conflitto database annulla assegnazione e storico. Stati terminali non assegnabili.
Le capienze e i gruppi nei file SQL locali restano allineati al catalogo.
Nessuna modifica alle policy o nuovo algoritmo di disponibilità.

## Step 2B — Piantina operativa

`src/config/tableLayout.js` segue la piantina reale condivisa e non definisce
capienze o disponibilità. Le due sale sono impilate, con Nami sopra la
Principale. La piantina mostra i numeri dei tavoli fisici nella loro posizione. Quando una
prenotazione è assegnata a un gruppo ammesso, i relativi tavoli appaiono uniti.
13+14 è un gruppo fisso indivisibile da 3 coperti. 22 e 23 hanno capienza
standard separata di 2 ciascuno; insieme formano `22+23` da 4, candidato anche
del motore automatico quando libero e compatibile. ADMIN può comunque assegnare
manualmente qualunque numero positivo a un'unità fisicamente valida: la
sovracapienza standard mostra un avviso e non cambia il catalogo.
Per i tavoli 15–19 sono ammesse soltanto queste configurazioni:
`15+16+17` con `18+19`; `15+16` con `17` e `18+19`; oppure `15+16`, `17`,
`18` e `19` separati. Le capienze provengono da TABLE_ASSIGNMENTS.

Stati testuali e colori: LIBERO / IN ARRIVO / OCCUPATO. Non dipendono da now()
o da una scadenza. Orari visibili sui tavoli; tocco apre il dettaglio con tutte
le prenotazioni collegate e “Cambia tavolo”. “Da assegnare” apre direttamente
la stessa assegnazione dedicata dell'elenco. Nessun tocco salva automaticamente.
Le scelte e il salvataggio riusano rankedMapAssignments/assignMapTable.

Sale impilate su tutte le dimensioni; posizioni relative e
controlli di almeno 44px. Dettaglio focalizzato dopo il tocco; stati e selezione
accessibili anche da tastiera. Nessuna nuova libreria, nessuna liberazione automatica.

## Mappa live su iPhone

Sotto i 700px la stessa giornata viene presentata come lista di card tappabili
invece della piantina: ogni card mostra tavolo, posti, stato LIBERO / IN ARRIVO /
OCCUPATO e, se presente, orario e cliente. Il tocco apre lo stesso dettaglio
della mappa con le azioni già esistenti (“Cambia tavolo”, non venuto, nuova
prenotazione). Le due sale sono elencate insieme, senza tab. Anche
l’assegnazione usa la lista: ogni card seleziona i tavoli fisici e il pulsante
di conferma resta in fondo. Su desktop e iPad la piantina resta invariata e
scalata in proporzione. La scelta è solo di presentazione: dati, disponibilità,
conflitti e salvataggi sono gli stessi.

Il motore ora considera la giornata prenotata senza finestre di durata:
confirmed/arrived/completed con tavolo assegnato restano bloccanti indipendentemente
dall’orario. La liberazione richiede cancelled/no_show o rimozione esplicita
dell’assegnazione secondo le regole operative. Nessun cambiamento automatico di stato.

## Sovracapienza manuale

La mappa e l’editor, quando cambia soltanto il campo tavoli, consentono allo staff di assegnare 5 persone a `15+16` (4 posti consigliati), mostrando un avviso. Suggerimenti e disponibilità automatica rimangono vincolati alla capienza. Gruppi configurati, configurazioni 15–19 e conflitti fisici restano obbligatori.

Applicare `supabase/manual-table-assignment.sql` dopo booking-edit.sql e after-dinner-bookings.sql: aggiunge `admin_assign_booking_tables`, riservata ADMIN, senza modificare `admin_update_booking` o i trigger esistenti. La RPC accetta esclusivamente tavoli, conserva controllo concorrenza e storico atomico. Nessuna modifica alla capienza configurata o alla UI mobile.
