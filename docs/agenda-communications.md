# Comunicazioni Agenda

Applicare `supabase/agenda-communications.sql` dopo booking-requests.sql. Non modifica prenotazioni o log precedenti e non invia email durante l'applicazione. I nuovi inserimenti confermati accodano conferma, le richieste approvate accodano aggiornamento, le cancellazioni accodano cancellazione. Richieste pendenti/rifiutate non producono email; aggiornamenti e cancellazioni superano le email ancora da inviare. Nessun backfill dei clienti esistenti.

L'ADMIN apre **Comunicazioni e log** e usa **Invia email**. **Prepara email** serve per prenotazioni precedenti alla migrazione ed è idempotente. Email assente/non valida produce un esito skipped. La comunicazione contiene solo i dati della prenotazione, senza richiesta marketing o note interne.

Deploy della Edge Function `agenda-communications`, con secrets server `RESEND_API_KEY` e `AGENDA_EMAIL_FROM` (mittente con dominio verificato). Non usare VITE_ per questi secrets. Riferimento: https://supabase.com/docs/guides/functions/examples/send-emails e https://resend.com/docs/api-reference/emails/send-email. L'endpoint verifica l'utente con getUser e il ruolo app_metadata.admin; solo server può registrare esiti email. Non è implementato un cron o reminder temporizzato, non richiesto dal flusso. Non sono state inviate email reali nei test.

Claim atomico impedisce invii concorrenti. Resend riceve una chiave idempotente per comunicazione. Accepted indica accettazione del provider, NON consegna al cliente. Errori 4xx certi permettono retry entro 23h dalla creazione; esiti incerti e invii rimasti sending richiedono verifica del provider, senza retry automatico. Anche il fallimento del log dopo invio impedisce un nuovo claim. booking_communication_logs conserva i tentativi e le transizioni.

WhatsApp apre wa.me con testo precompilato: il log indica opened/preparata, non sent. Nessuna API WhatsApp, invio automatico o push. Un blocco popup viene mostrato all'operatore.
