# Occupazione senza durata fissa

Frontend Agenda, SQL e backend sito-makai considerano l’intera giornata prenotata,
indipendentemente dall’orario o dal tipo normale/dopocena. Non esiste più una
finestra di 120 minuti. La data mantiene il perimetro del servizio; non viene
introdotta un’occupazione perpetua tra giornate diverse.

Confirmed, arrived e completed con tavoli assegnati restano bloccanti.
Cancelled/no_show e rimozione esplicita dell’assegnazione liberano i tavoli.
Nessun timer modifica lo stato o l’assegnazione. Orari legacy incerti non
rendono disponibili i tavoli. Stime di liberazione restano soltanto informative.

Conflitti fisici, unità/capienze, configurazioni 15–19, esclusione del proprio ID,
limite giornaliero e flessibilità manuale già installata restano invariati.
Capacità residua e tutela dei pendenti usano tutte le occupazioni della giornata.
I dati duplicati/incoerenti restano non verificati.

## SQL da applicare separatamente

Per installazioni esistenti applicare `supabase/explicit-table-release.sql`
dopo `temporal-table-conflicts.sql` e, se già utilizzato, `manual-assignment-capacity.sql`.
La patch aggiorna tre funzioni private e una quarta (`service_capacity`) solo
se già presente. Conserva la variante del controllo manuale già installata,
trigger, advisory lock 734512, privilegi e storico. Non aggiorna righe,
stati, assegnazioni, schema o RLS; non invia email e non fa backfill.

Anche i due script sorgente sono allineati, per le nuove installazioni.
La patch è testata con PostgreSQL locale (PGlite), anche riapplicandola;
non è stata applicata al database live. Assegnazioni sovrapposte già salvate
non sono modificate e richiedono eventuale verifica operativa dello staff.
