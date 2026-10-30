# Richieste cliente

Applicare `supabase/booking-requests.sql` dopo storico, modifica e conflitti tavoli.
Lo staff registra una richiesta ricevuta, collegata al booking_id: data, ora,
persone, cancellazione o note. Il cliente può inviare una richiesta dal proprio
link personale quando la modifica non è applicabile subito.

## Dove si gestiscono
- Pagina `/richieste-clienti` dell’Agenda, con il collegamento “Richieste clienti”
  nel menu e il conteggio delle sole richieste in attesa.
- La pagina mostra soltanto le richieste in attesa, come lista di card: cliente,
  data e orario, persone e tavolo attuale. Le azioni sono Accetta, Proponi
  alternativa e Rifiuta. Telefono, email e identificativi compaiono solo nel
  dettaglio apribile; le decisioni concluse non vengono duplicate qui.
- Le richieste decise confluiscono nell’unico Archivio eventi, collegate al
  numero di prenotazione: non diventano prenotazioni confermate e non esiste
  una seconda pagina di archivio richieste.
- La Giornata non mostra il pannello delle richieste, così non si sovrappone alla
  mappa e all’elenco.

## Accetta
- Applica la modifica con la logica atomica già esistente (`admin_update_booking`
  oppure `admin_set_booking_status_with_history`), con disponibilità, capienza,
  conflitti e vincoli invariati.
- Il trigger delle comunicazioni accoda già l’unica email `updated`; la pagina la
  prepara e la invia riusando `communications/prepare` e `send-template-email`.
  Nessun secondo messaggio viene creato. Se l’invio non è confermato, la modifica
  resta valida e l’esito va verificato nel log.
- Per una cancellazione approvata resta il percorso email di cancellazione già
  esistente.

## Rifiuta
- La motivazione è obbligatoria (1–500 caratteri), viene salvata nella richiesta
  e scritta nell’email inviata al cliente.
- L’email contiene anche il link al calendario del sito
  `https://www.makaipigneto.it/prenotazioni` per scegliere un altro giorno o
  orario. Non contiene il link personale di gestione.
- Il rifiuto non modifica la prenotazione. La decisione e il motivo sono
  immutabili; un secondo invio non è possibile.
- Un errore email non annulla il rifiuto. Gli esiti incerti non vanno presentati
  come consegna riuscita.

## Server
- Migrazione locale `20261024120000_booking_request_decisions.sql`: colonne
  `rejection_reason` e stato dell’email di decisione, trigger aggiornato, RPC
  `admin_review_booking_request_with_reason` e claim server-only
  `admin_booking_request_email_operation`.
- Backend `POST /api/admin/bookings/requests/{id}/reject` (gateway ADMIN) applica
  la decisione, acquisisce l’unico tentativo e chiama l’Edge
  `send-booking-email` con `type: booking_request_rejected`.
- `admin_review_booking_request` resta per le approvazioni; un rifiuto senza
  motivo viene bloccato dal trigger anche passando dalla vecchia RPC.

RLS limita lettura e scrittura agli utenti con app_metadata.role=admin; le
funzioni di claim sono riservate a service_role. Nessun accesso anonimo e
nessuna policy cliente inventata.
