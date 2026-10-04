# Modifica prenotazione ADMIN

«Modifica prenotazione» nei dettagli apre soltanto data, orario, persone,
tavolo/tavoli e note. Annulla chiude senza chiamate di scrittura. Il salvataggio
valida una data disponibile entro 60 giorni, gli orari operativi del tipo di
prenotazione, da 1 a 6 persone, le assegnazioni tavoli configurate (o vuote),
la relativa capienza e note <= 300 caratteri. Nessuna modifica effettiva
significa nessun salvataggio.

Applicare manualmente `supabase/booking-edit.sql`: non è stato eseguito durante
l'intervento. La RPC `admin_update_booking` usa SECURITY INVOKER, ruolo ADMIN
in app_metadata e RLS esistente. Blocca la riga con SELECT FOR UPDATE, confronta
la versione originale dei cinque campi per evitare sovrascritture concorrenti,
usa lo stesso advisory lock del motore esistente, valida nuovamente i dati e fa
un solo UPDATE WHERE id = booking_id.
Il payload contiene solo campi effettivamente cambiati; il SET SQL contiene
esclusivamente i cinque campi consentiti, conservando quelli non cambiati.
Non scrive id, stato, contatti, consensi o created_at; non usa INSERT/DELETE.
I trigger preesistenti possono aggiornare updated_at/scadenza_dati come prima.

La RPC restituisce i dati effettivamente salvati e l'id originale. L'Agenda
aggiorna subito la stessa riga senza aspettare Realtime. Se cambia il giorno,
la prenotazione scompare dalla lista del giorno precedente e compare un link
«Apri la nuova data». Lo storico si aggiorna usando esclusivamente il trigger
AFTER UPDATE già presente: nessun INSERT nello storico da parte dell'editor.
Aggiornamento e storico sono atomici; se lo storico fallisce, fallisce anche la
modifica.

## Verifica del database esistente

In sola lettura è stata confermata la presenza di
`private.record_admin_booking_history` che confronta OLD/NEW per booking_date,
booking_time, party_size, tables e notes (oltre a status). La modifica tramite
JWT ADMIN esegue questo stesso trigger, con action booking_updated.
Non è stata effettuata una prova reale di scrittura/reload.

## Disponibilità

I trigger prepare_booking ed enforce_online_closure restano attivi. Per le
prenotazioni online confermate possono imporre i controlli già esistenti:
orari 18–23 ogni 30 minuti, giorni/anticipo/coperti e chiusure online.
prepare_booking può anche tentare di riassegnare i tavoli quando cambiano
data/orario/persone. La nuova RPC rifiuta e annulla l'intera modifica se il
tavolo restituito dal trigger differisce da quello scelto o mantenuto.
Non aggira i controlli e non aggiunge un motore/assegnazione automatica.

L'editor controlla conflitti per data e tipo di prenotazione usando i tavoli
fisici inclusi nelle assegnazioni. Le prenotazioni cancelled e no_show liberano
la disponibilità. Le assegnazioni 15-19 rispettano esclusivamente le tre
configurazioni operative già definite. Il trigger database ripete il controllo
nel momento dell'UPDATE, dentro la stessa transazione.
