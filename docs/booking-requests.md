# Richieste cliente

Applicare `supabase/booking-requests.sql` dopo storico, modifica e conflitti tavoli.
Lo staff registra una richiesta ricevuta, collegata al booking_id: data, ora,
persone, cancellazione o note. Nessuna comunicazione viene inviata.
L'ADMIN elenca le richieste pending di tutte le date e aggiorna ogni 30 secondi.

L'approvazione richiama admin_update_booking oppure
admin_set_booking_status_with_history nella stessa transazione della decisione.
Valgono disponibilità, capienza, conflitti e vincoli già presenti. Una prenotazione
cambiata dopo la richiesta blocca l'approvazione: rifiutare e registrarne una nuova.
Un errore annulla decisione, modifica e storico; il rifiuto non modifica il booking.
Richiesta, approvazione/rifiuto e modifica effettiva sono nello storico.
Le decisioni non si possono ripetere; contenuto e collegamento sono immutabili.

RLS limita lettura e scrittura agli utenti con app_metadata.role=admin;
nessun accesso anonimo, nessun segreto client, nessuna policy cliente inventata.
Questo repository non ha un canale pubblico verificato per ricevere richieste:
l'inserimento diretto del cliente richiede una successiva integrazione con
verifica di possesso della prenotazione. Il solo booking_id non autentica il cliente.
