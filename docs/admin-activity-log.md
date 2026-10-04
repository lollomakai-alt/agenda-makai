# Activity log ADMIN

Applicare `supabase/admin-activity-log.sql` dopo `booking-history.sql` e
`waitlist.sql`, quando la tabella bookings include `booking_type`. La migration
è additiva: riutilizza `booking_history` e `waitlist_history`, rende nullable il
booking_id nello storico booking per eventi generali futuri e aggiunge actor_id.
Non crea eventi retroattivi.

La pagina ADMIN `/attivita` unisce i due storici e filtra per data locale
Europe/Rome, azione e testo/ID. Mostra autore come UUID Supabase, data/ora,
booking/lista d’attesa e dettagli essenziali. Legge fino a 500 eventi recenti
per ciascuno storico. L’accesso resta protetto da AdminAccess e RLS.

Un trigger registra creazione e aggiornamenti booking solo con JWT ADMIN;
contatti e note non sono inclusi nella riga di creazione. Le richieste cliente
riusano gli eventi già salvati in booking_history e l’autore già presente nei
dettagli. Le azioni lista d’attesa riusano waitlist_history, che include già
actor_id. La creazione manuale normale passa dal backend esterno che non
propaga il JWT: dopo la risposta confermata l’interfaccia chiama
admin_record_booking_creation, che verifica il ruolo e registra lo snapshot
essenziale in modo idempotente. Un errore di log non annulla una prenotazione
già salvata e viene mostrato nell’interfaccia.

Il log non attribuisce eventi da SQL Editor o backend senza JWT ADMIN, salvo
quelli esplicitamente registrati tramite la RPC riservata. L’autore è un UUID;
non viene esposto un indirizzo email. Gli storici esistenti e le loro regole di
cancellazione/FK restano invariate.