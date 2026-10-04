# No-show manuale ADMIN

Nei dettagli è presente «Segna come No-show». Il comando e l'opzione no_show
del selettore sono bloccati fino a 30 minuti dopo data/orario della prenotazione,
interpretati in Europe/Rome, indipendentemente dal fuso del browser. La soglia
è inclusiva: alle 20:30 è ammessa una prenotazione prevista alle 20:00.
Dati mancanti o non validi impediscono il comando. Il controllo viene ripetuto
al click, seguito da conferma ADMIN. L'orologio dell'interfaccia aggiorna solo
la disponibilità del comando: non cambia automaticamente alcuna prenotazione.
cancelled e completed restano bloccati anche dopo la soglia. Una prenotazione
già no_show non genera alcuna nuova richiesta dall'interfaccia.

Si riutilizza admin_set_booking_status_with_history per impostare solo status
a no_show, conservando id e record. Il trigger booking_history esistente
registra status_changed; non è aggiunto un secondo sistema di storico.
I salvataggi falliti mostrano l'errore e un eventuale errore separato dello
storico conserva il cambio stato, come negli altri comandi già presenti.

## SQL necessario

Applicare manualmente `supabase/booking-no-show.sql`. Il file non è stato
eseguito durante questo intervento. Installa un trigger BEFORE UPDATE OF status
che controlla ogni passaggio a no_show usando l'orologio del database e
Europe/Rome: protegge anche il selettore/RPC e chiamate dirette alla tabella,
senza fidarsi dell'ora del browser. Prima della soglia genera un errore: nessun
cambio stato o evento nello storico viene salvato. Il trigger rifiuta anche
i passaggi da cancelled/completed. La RPC degli stati mantiene firma e valori,
ma per una richiesta no_show su una prenotazione già no_show restituisce lo
stato senza UPDATE: nessun evento o altro aggiornamento, anche in caso di retry.
La RPC con storico resta la stessa e richiama questa RPC come prima.
Il SQL non aggiorna record durante l'installazione e non modifica RLS o storico.

Il controllo riguarda il passaggio a no_show: non impone nuovi vincoli alle
modifiche dei dati di una prenotazione già no_show, né cambia altri stati.
Nessun no-show automatico, messaggio, reminder o nuova disponibilità.

Verifiche locali: limite dei 30 minuti, date passate/future, cambio giorno,
secondi, ora estiva/invernale e date/orari invalidi; test esistenti e build.
La verifica reale di scrittura/reload resta da effettuare dopo il SQL.
