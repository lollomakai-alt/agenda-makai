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

Il login usa Supabase Auth con email/password. Il ruolo staff deve essere assegnato da un amministratore in `app_metadata.role` (`staff` o `admin`), mai in `user_metadata`. Nessuna chiave service_role entra nel frontend.

`useAppointments('agenda' | 'booking' | 'all')` restituisce `appointments`, `loading`, `error`, `refresh`. `all` serve al calendario staff unificato. Le query filtrano per source; le notifiche realtime ascoltano la tabella per intercettare anche cancellazioni e cambi di source, quindi ricaricano attraverso RLS. Il calendario mensile usa direttamente l’hook; la pagina del giorno conserva le informazioni marketing delle API FastAPI e le ricarica quando cambiano i record.

RLS: staff CRUD completo; utenti autenticati CRUD soltanto su `source='booking' AND user_id=auth.uid()`; guest nessun accesso diretto. Il trigger protegge i campi staff e assegna i tavoli rispettando le regole attuali (120 minuti, massimo 6 persone, anticipo 30 minuti, 60 giorni, lunedì chiuso e massimo 2 prenotazioni attive per telefono). La disposizione tavoli proviene dal backend attuale: aggiornare entrambi se cambia la sala. Il trigger usa lo stesso advisory lock `734512` del backend.

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

Le variabili `VITE_*` sono incluse nel browser: non contengono segreti. `API_PROXY_TARGET` è letto dalla funzione Vercel e non dal bundle. Dopo aver aggiornato le variabili pubbliche, esegui un nuovo deploy.

Nel backend condiviso pubblica gli aggiornamenti a `api/admin_auth.py` e `api/bookings/service.py`; imposta `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e aggiungi il dominio dell’Agenda ad `ALLOWED_ORIGINS`.

In Supabase Authentication → URL Configuration imposta come Site URL il dominio HTTPS dell’Agenda e aggiungi nei Redirect URLs il callback `https://DOMINIO-AGENDA/?setup=password`. Mantieni `http://localhost:5174/**` per lo sviluppo. Il calendario in produzione non dipende dal computer locale; le API devono essere pubblicate e raggiungibili.

## Account staff

Account staff: `makaistiki@gmail.com`. Dopo la creazione dell’utente Auth, un amministratore assegna `app_metadata.role = staff`. Per gli inviti, configura in Supabase Auth l’URL del sito e autorizza il callback `/?setup=password` (per esempio `http://localhost:5174/?setup=password` in sviluppo). La pagina di login riconosce inviti e recupero password e permette di impostare la nuova password.

Account verificato e ruolo `staff` assegnato a `makaistiki@gmail.com`. Dopo la modifica del ruolo, esci e rientra per ottenere un token aggiornato.
