# Mappa tavoli ADMIN

Nella giornata ADMIN: piantina con 10 unità valide che coprono i 14 tavoli fisici,
Sala Principale 10–19, Sala Nami 20–23.
Inventario fisico da tables.json; combinazioni e capienze da TABLE_ASSIGNMENTS.
I posti delle combinazioni non sono sommati dalle capienze fisiche (10+11 = 3).

Stati per data/tipo:
- confermata: prenotato;
- arrivato/completata: occupato, conservando il blocco giornaliero esistente;
- cancellata/no_show: non bloccante;
- stato storico mancante: confermata; stato sconosciuto: occupato conservativamente.
Filtro Tutti/Normale/Dopocena sulle prenotazioni da assegnare; lo stato sala
include sempre tutta la giornata e tutti i tipi. Occupato prevale su in arrivo.
Prenotazioni senza tavoli o con assegnazioni invalide sono segnalate come da
verificare: i pulsanti liberi non garantiscono la disponibilità fisica.

Click mostra tutte le prenotazioni collegate, orario, persone, tipo e stato;
il collegamento apre la prenotazione. Sono indicate le combinazioni del tavolo.
Assegnazione per prenotazioni confermate/arrivate: selezionare prenotazione e
combinazione disponibile. La scelta sostituisce esplicitamente l'intera vecchia
assegnazione. Nessun drag&drop, nessuna modifica a cliente/data/ora/persone/note.

Riusa validateBookingEdit, conflitti fisici e configurazioni 15–19,
saveBookingEdit/admin_update_booking, controllo optimistic concurrency,
trigger Supabase e storico esistenti. Anche con snapshot client obsoleto, un
conflitto database annulla assegnazione e storico. Stati terminali non assegnabili.
Nessun nuovo SQL o modifica alle policy. Richiede gli SQL editor/storico/conflitti
con configurazioni attuali già presenti. Nessun nuovo algoritmo di disponibilità.

## Step 2B — Piantina operativa

`src/config/tableLayout.js` contiene solo coordinate percentuali schematiche,
da confermare con la disposizione reale. Non definisce capienze o disponibilità.
Le unità indivisibili (`10+11`, `13+14`, `15+16`, `20+21`) appaiono unite;
le combinazioni più grandi (`15+16+17`, `18+19`) evidenziano tutti i blocchi
coinvolti quando vengono selezionate. Le capienze provengono da TABLE_ASSIGNMENTS.

Stati testuali e colori: LIBERO / IN ARRIVO / OCCUPATO. Non dipendono da now()
o da una scadenza. Orari visibili sui tavoli; tocco apre il dettaglio con tutte
le prenotazioni collegate e “Cambia tavolo”. “Da assegnare” apre direttamente
la stessa assegnazione dedicata dell'elenco. Nessun tocco salva automaticamente.
Le scelte e il salvataggio riusano rankedMapAssignments/assignMapTable.

Sale affiancate sul desktop, impilate su tablet/iPhone; posizioni relative e
controlli di almeno 44px. Dettaglio focalizzato dopo il tocco; stati e selezione
accessibili anche da tastiera. Nessuna nuova libreria, nessuna liberazione automatica.

Il motore ora considera la giornata prenotata senza finestre di durata:
confirmed/arrived/completed con tavolo assegnato restano bloccanti indipendentemente
dall’orario. La liberazione richiede cancelled/no_show o rimozione esplicita
dell’assegnazione secondo le regole operative. Nessun cambiamento automatico di stato.

## Sovracapienza manuale

La mappa e l’editor, quando cambia soltanto il campo tavoli, consentono allo staff di assegnare 5 persone a `15+16` (4 posti consigliati), mostrando un avviso. Suggerimenti e disponibilità automatica rimangono vincolati alla capienza. Gruppi configurati, configurazioni 15–19 e conflitti fisici restano obbligatori.

Applicare `supabase/manual-table-assignment.sql` dopo booking-edit.sql e after-dinner-bookings.sql: aggiunge `admin_assign_booking_tables`, riservata ADMIN, senza modificare `admin_update_booking` o i trigger esistenti. La RPC accetta esclusivamente tavoli, conserva controllo concorrenza e storico atomico. Nessuna modifica alla capienza configurata o alla UI mobile.
