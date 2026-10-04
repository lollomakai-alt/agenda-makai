# Lista d’attesa ADMIN

Pagina protetta `/lista-attesa`, disponibile dal menu ADMIN. Cliente, telefono/email
(almeno uno), data, ora, persone e note; validazione dei campi esistente.
Stati persistenti: WAITING → CONTACTED, CONVERTED o CANCELLED; CONTACTED →
CONVERTED o CANCELLED. Le voci terminali restano consultabili col filtro Tutti.
Nessun invio email/WhatsApp né prenotazione alla creazione della voce.

La conversione richiede la scelta di un tavolo configurato libero con capienza
sufficiente. Usa TABLE_ASSIGNMENTS, conflitti e configurazioni ADMIN esistenti,
poi ricontrolla nel database tramite admin_update_booking e i trigger correnti.
Non introduce un secondo algoritmo di assegnazione automatica. I tavoli sono
occupati per data e tipo normale secondo i controlli ADMIN già approvati.
Le chiusure delle prenotazioni online non bloccano questa operazione manuale.

Inserimento della prenotazione source=agenda/reminder_status=skipped, assegnazione,
collegamento booking_id, stato CONVERTED e storico sono nella stessa transazione.
Errore/conflitto/storico indisponibile annullano tutto; nessuna prenotazione orfana.
La conversione può avvenire una sola volta, con lock condiviso 734512.
WAITING e CONTACTED non occupano tavoli. Nessuna cancellazione fisica delle voci.
CONVERTED non cambia se lo staff cancella successivamente la prenotazione:
conserva il collegamento e la cronologia della conversione.

Applicare `supabase/waitlist.sql` dopo storico, editor, conflitti e dopocena
(per le configurazioni tavoli correnti). Tabelle waitlist e waitlist_history con
RLS app_metadata.role=admin; RPC SECURITY INVOKER, niente accesso anonimo.
Dati originali immutabili; per correggerli cancellare la voce e inserirne una nuova.
Storico della voce (creazione/stati/conversione) e evento waitlist_converted nello
storico della prenotazione. Il browser aggiorna lista e disponibilità dopo salvataggi.
