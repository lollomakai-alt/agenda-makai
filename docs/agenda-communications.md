# Comunicazioni Agenda

Applicare `supabase/agenda-communications.sql` dopo `booking-requests.sql`. La migration non invia email, non fa backfill e non modifica prenotazioni esistenti. Inserimenti confirmed accodano confirmation; modifiche manuali di data/ora/persone/tavoli accodano updated; cancellazioni accodano cancelled. Le vecchie comunicazioni non inviate vengono superate. I permessi operativi sono esclusivamente backend/service_role, con RLS attive e nessun accesso diretto del frontend alle tabelle/RPC comunicazioni.

## Step 2 backend

Il JWT admin serve solo alla verifica Supabase Auth (`app_metadata.role=admin`). Gateway e Origin check restano obbligatori. Il client dedicato in `sito-makai/api/supabase_server.py` legge `SUPABASE_SERVICE_ROLE_KEY` soltanto dall'ambiente server.

Endpoint disponibili dietro il gateway Agenda:

- `GET /api/admin/bookings/{id}/communications`: lettura tramite service_role.
- `POST /api/admin/bookings/{id}/communications/prepare`: RPC `admin_prepare_booking_communication` tramite service_role; email senza destinatario valido risulta skipped.
- `POST /api/admin/bookings/{id}/send-confirmation-email`: nessun contenuto email dal client; verifica booking confirmed, prepara/recupera l'evento email corrente, chiama `claim_booking_email`, invoca `send-booking-email`, registra l'esito con `finish_booking_email`.

Un claim null produce HTTP 409 senza Edge o finish. La RPC ricontrolla stato, snapshot e destinatario sotto lock; soltanto una richiesta può passare a sending. L'endpoint invia confirmation oppure l'updated corrente per una prenotazione confirmed; non invia cancellazioni da questo endpoint.

L'Edge Function `send-booking-email` accetta solo la credenziale service_role. Il backend aggiunge `communicationId` al payload interno `{bookingId,type:"booking_confirmation"}`. L'Edge legge la comunicazione sending, controlla ancora booking/snapshot/email e usa snapshot e destinatario memorizzati; non prepara, reclama o registra log. Il mittente è `Makai Pigneto <prenotazioni@makaipigneto.it>`, con template server e `RESEND_API_KEY` nell'ambiente Edge.

La chiave Resend è `agenda-email-{communicationId}`, coerente anche con il vecchio sistema. Accepted indica accettazione del provider, non consegna. Rifiuti certi risultano failed (HTTP 502 dal backend); timeout, risposta persa, conflitti provider e 5xx risultano unknown (HTTP 502). Failed può essere riprovato esplicitamente solo nella finestra di 23 ore prevista dal claim SQL; nessun retry automatico. Unknown/accepted/sending non possono ottenere un nuovo claim. Tentativi sending più vecchi di 23 ore non vengono trasportati nuovamente dall'Edge.

Se finish fallisce, il backend restituisce un errore sanitizzato e non reinvia. La riga rimane sending, oppure conserva l'esito già registrato se si è persa solo la risposta: entrambi impediscono un nuovo invio. Verificare comunicazioni/Resend prima di intervenire; non ripristinare queued alla cieca.

Il vecchio endpoint `agenda-communications` è conservato ma disabilitato (HTTP 410), così non esiste un secondo percorso autonomo di claim/invio/log. La sua funzione helper è anch'essa disabilitata.

## Pubblicazione e Step 3

Pubblicare insieme la migration, il backend configurato con service_role e le Edge Function aggiornate. Nessun SQL o deploy viene eseguito dai test. Le verifiche di concorrenza locali comprendono due handler HTTP con RPC simulata atomica e SQL reale in PGlite a sessione singola; non costituiscono un test multi-sessione sul DB live.

La UI Agenda non è stata modificata nello Step 2. Lo Step 3 deve spostare lettura, preparazione e invio sugli endpoint del gateway: i vecchi accessi diretti saranno bloccati. Non considerare il flusso utilizzabile dalla UI prima di quel passaggio. WhatsApp resta manuale; nessun cron, reminder o invio automatico è introdotto.

## Step 3 UI

Lettura e preparazione delle comunicazioni, WhatsApp e invio email passano esclusivamente dal gateway `/api/admin/bookings/{id}` con la sessione admin. Nessuna lettura diretta delle tabelle comunicazioni, RPC o invocazione Edge dal browser. Un solo pulsante email usa il booking ID; preparazione, claim e finish restano al backend. Il log si aggiorna dopo ogni operazione; accepted indica accettazione dal servizio, non consegna. Sending, accepted, unknown e failed fuori finestra bloccano il pulsante. Gli errori di trasporto richiedono aggiornamento del log prima di altri tentativi. Nessun invio automatico.

## Conferma automatica dal sito

Applicare `supabase/migrations/20261005141443_automatic_online_confirmation.sql` dopo `agenda-communications.sql`, quindi pubblicare il backend sito-makai. Il sito usa `POST /api/bookings`: dopo il commit di una nuova prenotazione confirmed con email valida, il backend chiama `claim_new_online_booking_email`. Il claim ammette soltanto source=booking, evento iniziale created, queued e attempts=0, con lock booking prima della comunicazione. Non prepara nuovi eventi e condivide claim/trasporto/finish con il pulsante Agenda. Le richieste ripetute tramite request_id non invocano l'invio automatico; nessun backfill o retry automatico. Inserimenti Agenda, modifiche, cancellazioni e prenotazioni senza email restano esclusi. Eventuali errori email sono registrati nelle comunicazioni senza trasformare una prenotazione salvata in un errore di salvataggio; la richiesta attende il singolo tentativo, con timeout frontend 90s e durata massima backend 120s.

La funzione email mantiene verify_jwt=true. Quando Supabase inietta una chiave sb_secret_ in SUPABASE_SERVICE_ROLE_KEY, il JWT legacy del backend viene verificato con una lettura PostgREST limit=0 sulla tabella comunicazioni riservata a service_role. Decodificare il ruolo non autorizza da solo: firma e privilegi devono essere accettati da Supabase. La diagnostica registra soltanto formato/booleani, mai credenziali. Nessun secret aggiuntivo è necessario.

Rollback dell'automatismo: ripubblicare il backend precedente. Conservare migration, coda e log; non azzerare sending/unknown/accepted. L'invio manuale rimane disponibile con il normale claim.
