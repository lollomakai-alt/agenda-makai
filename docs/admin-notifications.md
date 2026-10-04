# Centro notifiche ADMIN

Applicare `supabase/admin-notifications.sql` dopo `booking-requests.sql`.
Il centro compare nel calendario e nella giornata, dentro il controllo ADMIN.
Non produce email, WhatsApp o push e non modifica prenotazioni/storico.

Feed degli avvisi attivi:
- richieste cliente pending: priorità normale, alta per cancellazione;
- clienti confirmed non arrivati: da 15 minuti priorità normale, da 30 alta;
- i ritardi terminano quando cambia lo stato o dopo 24 ore dall'orario previsto.
La finestra considera oggi/ieri in Europe/Rome per il passaggio di mezzanotte;
non segnala tutte le vecchie prenotazioni confirmed come ritardi attuali.

Badge non lette, filtro e stato letta/non letta. Segna come letta salva nel database
una ricevuta personale `(auth.uid(), notification_id)`; la lettura non è condivisa
tra membri dello staff. Click sul collegamento apre e mette a fuoco il booking.
Aprire la prenotazione non marca automaticamente la notifica: comando esplicito.
I ritardi mantengono la lettura quando aumenta la priorità. Cambiare data/ora crea
una diversa chiave di avviso; una nuova richiesta ha sempre una propria chiave.
Gli avvisi risolti escono dal feed; le ricevute restano persistenti.

Aggiornamento ogni 30 secondi, al ritorno alla finestra e subito dopo una richiesta
registrata/gestita nella stessa pagina. Errori di lettura non mostrano badge zero.
RLS: soltanto app_metadata.role=admin, ricevute personali, nessun UPDATE/DELETE
client e RPC SECURITY INVOKER. Nessuna autorizzazione basata su user_metadata.
