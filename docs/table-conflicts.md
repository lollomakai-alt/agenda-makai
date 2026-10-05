# Conflitti temporali dei tavoli

La durata resta quella del backend condiviso (`api/config.py`, `STAY_MINUTES = 120`).
L'Agenda usa `bookingScheduledAt` in `src/utils/bookingTime.js` per interpretare
l'orario in Europe/Rome e un unico intervallo `[inizio, inizio + 120 minuti)`.
Alle 22:00 un tavolo prenotato alle 20:00 è riutilizzabile. Gli orari legacy
incerti restano bloccanti nella stessa data, senza inventare disponibilità.

I conflitti richiedono sovrapposizione temporale e tavoli fisici comuni.
Normale e dopocena seguono lo stesso controllo: tipi diversi non autorizzano
occupazioni simultanee. Cancelled e no_show non occupano; gli altri stati
mantengono il comportamento precedente. La prenotazione non confligge con se stessa.

Le configurazioni Makai 15–19 sono invariate e devono essere compatibili in
ogni finestra simultanea, senza combinare gruppi usati in orari separati.
Le funzioni di disponibilità, raccomandazione e lista d'attesa riutilizzano
questi controlli. La mappa in assegnazione valuta l'intervallo della prenotazione;
la vista generale conserva il riepilogo giornaliero.

## Correzione SQL necessaria

`supabase/temporal-table-conflicts.sql` va applicato **dopo** le definizioni
esistenti di `table-conflicts.sql`, `after-dinner-bookings.sql` e, se presente,
`pending-online-capacity.sql`. Non eseguire nuovamente i vecchi file dopo la patch:
sostituirebbero il controllo temporale con quello giornaliero.

La patch aggiorna `private.check_daily_table_conflicts` e include `booking_time`
tra i campi che richiedono verifica. Mantiene il trigger e il lock 734512,
le configurazioni, la RPC di assegnazione e la registrazione dello storico.
Una collisione reale annulla l'intera transazione, incluso l'evento storico.
Il trigger privato mantiene SECURITY DEFINER, search_path vuoto e accesso
negato ai ruoli pubblici; controlla anche le righe nascoste dalla RLS.

Il guard già presente per le prenotazioni online senza tavolo usa la ricerca
`fit_online_parties` esistente, valutata nelle finestre temporali effettive.
Non riassegna prenotazioni e non cambia il limite giornaliero di 25 coperti,
la chiusura online o la disponibilità pubblica basata su giorno e persone.

La patch non aggiorna righe, colonne, capacità, stati o policy RLS.
I test Postgres locali verificano riuso, sovrapposizioni, gruppi, modifiche
all'orario, protezione delle prenotazioni senza tavolo e storico.

Applicata al progetto Supabase collegato il 5 ottobre 2026 come
`temporal_booking_table_conflicts`. Verifica successiva in sola lettura:
intervalli separati ammessi, intervalli sovrapposti bloccanti; helper privati
non eseguibili da anon/authenticated; lock invariato. Nessuna prenotazione
aggiornata dalla patch. Il frontend locale richiede il normale deploy.
