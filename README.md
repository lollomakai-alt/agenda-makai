# Makai Agenda

Applicazione Vite + React autonoma, con dipendenze, stili e build propri. Non importa file dal sito Makai.

## Avvio locale

```bash
npm ci
npm run dev
```

Apri http://localhost:5174. Il file `.env` locale è già predisposto; per una nuova copia usa `cp .env.example .env`.

- `/`: login Supabase con email e password.
- `/prenotazioni`: calendario mensile.
- `/prenotazioni/giorno?date=AAAA-MM-GG`: agenda del giorno.

Il backend FastAPI deve essere raggiungibile su `API_PROXY_TARGET` (default http://127.0.0.1:8000). Nel repository del backend si avvia con:

```bash
.venv/bin/python -m uvicorn index:app --app-dir api --host 127.0.0.1 --port 8000 --reload
```

## Calendario unico Supabase

Tabella esistente: `public.bookings`, con `booking_date`, `booking_time`, `party_size` e gli altri campi originali. `source` usa `agenda` (ex `staff`) e `booking` (ex `ai`). `user_id` è il riferimento facoltativo a Supabase Auth: i record guest e storici restano senza proprietario e accessibili allo staff. Non si assegna la proprietà confrontando le email.

Il login usa Supabase Auth con email/password. L'Agenda usa un solo account amministratore: `app_metadata.role` deve essere `admin`, mai `staff` e mai in `user_metadata`. Nessuna chiave service_role entra nel frontend.

`useAppointments('agenda' | 'booking' | 'all')` restituisce `appointments`, `loading`, `error`, `refresh`. `all` serve al calendario staff unificato. Le query filtrano per source; le notifiche realtime ascoltano la tabella per intercettare anche cancellazioni e cambi di source, quindi ricaricano attraverso RLS. Il calendario mensile usa direttamente l’hook; la pagina del giorno conserva le informazioni marketing delle API FastAPI e le ricarica quando cambiano i record.

RLS: l'amministratore ha CRUD completo; utenti autenticati CRUD soltanto su `source='booking' AND user_id=auth.uid()`; guest nessun accesso diretto. Il trigger protegge i campi amministrativi e assegna i tavoli rispettando le regole attuali (120 minuti, massimo 6 persone, anticipo 30 minuti, 60 giorni, lunedì chiuso e massimo 2 prenotazioni attive per telefono). La disposizione tavoli proviene dal backend attuale: aggiornare entrambi se cambia la sala. Il trigger usa lo stesso advisory lock `734512` del backend.

`supabase/calendar.sql` contiene lo script già applicato al progetto; è una fotografia dell’intervento, non va rieseguito. Realtime è attivo sulla tabella. Il backend condiviso deve includere gli aggiornamenti a `api/admin_auth.py` e `api/bookings/service.py`: verifica online del token Supabase e nomi source aggiornati. Arrivi, consensi e inserimenti staff mantengono le API `/api/admin/*`. Il backend richiede `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`.

### Prenotazioni guest

Edge Function pubblicata: `create-booking`. `verify_jwt=false` consente guest senza login; il service_role è letto esclusivamente dall’ambiente Edge. Per utenti autenticati il bearer token è verificato con `getUser`; il corpo non può scegliere proprietario, origine, tavoli o consensi.

```js
const { data, error } = await supabase.functions.invoke('create-booking', {
  body: {
    name: 'Nome Cognome', phone: '+39…', email: '',
    booking_date: 'AAAA-MM-GG', booking_time: '20:00',
    party_size: 2, notes: ''
  }
});
```

Il successo restituisce HTTP 201 e `booking` con id/data/ora/coperti/stato. Disponibilità e assegnazione avvengono nella transazione SQL. Il sito pubblico vive in un repository distinto: questo esempio è l’interfaccia per collegarne il modulo, non una modifica al suo flusso chat.

## Verifiche e build

```bash
npm test
npm run build
npm run preview
```

Preview: http://localhost:4174. Nessun test inserisce prenotazioni nel database.

## Deploy Vercel

`vercel.json` configura la build Vite e le rotte del calendario. `api/admin/[...path].js` inoltra le operazioni amministrative al backend condiviso verificando che la destinazione sia HTTPS. Conserva il bearer token Supabase e non inoltra cookie o chiavi riservate.

Nel progetto Vercel dell’Agenda configura:

| Variabile | Valore |
| --- | --- |
| `VITE_SUPABASE_URL` | URL del progetto Supabase già usato localmente |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chiave publishable del medesimo progetto |
| `VITE_PUBLIC_SITE_URL` | Dominio HTTPS del sito pubblico Makai, per il link privacy |
| `API_PROXY_TARGET` | Origine HTTPS del backend condiviso, senza `/api` o altri percorsi |
| `AGENDA_BACKEND_SECRET` | Chiave casuale condivisa con il backend, solo server, almeno 32 caratteri |

Le variabili `VITE_*` sono incluse nel browser: non contengono segreti. `API_PROXY_TARGET` è letto dalla funzione Vercel e non dal bundle. Dopo aver aggiornato le variabili pubbliche, esegui un nuovo deploy.

Nel backend condiviso pubblica gli aggiornamenti a `api/admin_auth.py` e `api/bookings/service.py`; imposta `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e aggiungi il dominio dell’Agenda ad `ALLOWED_ORIGINS`.

In Supabase Authentication → URL Configuration imposta come Site URL il dominio HTTPS dell’Agenda e aggiungi nei Redirect URLs il callback `https://DOMINIO-AGENDA/?setup=password`. Mantieni `http://localhost:5174/**` per lo sviluppo. Il calendario in produzione non dipende dal computer locale; le API devono essere pubblicate e raggiungibili.

## Account amministratore unico

Account amministratore: `makaistiki@gmail.com`. Crea/verifica questo utente in Supabase Auth e assegna `app_metadata.role = admin`. Non creare account con ruolo `staff`. Per gli inviti, configura in Supabase Auth l’URL del sito e autorizza il callback `/?setup=password` (per esempio `http://localhost:5174/?setup=password` in sviluppo). La pagina di login riconosce inviti e recupero password e permette di impostare la nuova password.

Per convertire l'account esistente, imposta `app_metadata.role = admin` dall'area amministrativa Supabase. Dopo la modifica del ruolo, esci e rientra per ottenere un token aggiornato. Applica una volta `supabase/admin-only.sql` in Supabase SQL Editor per restringere anche RLS e trigger; `supabase/calendar.sql` è lo script storico già applicato e non va rieseguito.

## Protezione delle API amministrative

Il gateway Vercel verifica il bearer token chiamando Supabase Auth, autorizza soltanto `app_metadata.role = admin` e inoltra solo le rotte amministrative previste. I ruoli `staff` e quelli dichiarati in `user_metadata` non concedono accesso. Solo dopo la verifica aggiunge `X-Agenda-Backend-Key`, usando `AGENDA_BACKEND_SECRET` dall'ambiente server. La chiave inviata dal browser viene ignorata; cookie e chiavi riservate non sono inoltrati al servizio Auth.

FastAPI protegge tutte le rotte `/api/admin/*` con la stessa chiave condivisa, confrontata senza scorciatoie basate sul primo carattere differente. Poi verifica separatamente la sessione dell’utente e richiede `app_metadata.role = admin`. Se la chiave manca o è troppo corta, il servizio rifiuta le richieste. La chiave autorizza il gateway, non sostituisce l’autenticazione dell’utente. Menu, chat e disponibilità pubblica continuano ad avere le rispettive regole esistenti.

Questa è protezione dell’accesso applicativo, non isolamento di rete: l’indirizzo HTTPS del servizio resta raggiungibile, ma le API admin respingono le chiamate dirette senza credenziale gateway.

Per attivarla online, configura **la stessa** `AGENDA_BACKEND_SECRET` nei progetti Vercel Agenda e backend. Non usare `VITE_`, non inserirla in Git e non inviarla in chat. I due `.env` locali sono già predisposti con la stessa chiave casuale. Dopo le modifiche riavvia i server locali per ricaricare l’ambiente. Sul backend pubblica anche `api/admin_auth.py` e `api/index.py`; poi pubblica il gateway dell’Agenda. Il login Supabase del browser resta diretto. Il vecchio login FastAPI non è inoltrato dal gateway Vercel.

La verifica locale comprende chiamate senza chiave, chiave errata, sessione non valida, ruolo falsificato, staff rifiutato e admin autorizzato. Questi test non inseriscono dati nel database. La verifica della protezione in produzione va eseguita dopo la configurazione delle variabili e il rilascio di entrambi i progetti.
