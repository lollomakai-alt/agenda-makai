# Makai Agenda

Applicazione Vite + React autonoma, con dipendenze, stili e build propri. Non importa file dal sito Makai.

## Avvio locale

```bash
npm ci
npm run dev
```

Apri http://localhost:5174. Il file `.env` locale è già predisposto; per una nuova copia usa `cp .env.example .env`.

- `/`: login con le credenziali amministrative esistenti.
- `/prenotazioni`: calendario mensile.
- `/prenotazioni/giorno?date=AAAA-MM-GG`: agenda del giorno.

Il backend FastAPI deve essere raggiungibile su `API_PROXY_TARGET` (default http://127.0.0.1:8000). Nel repository del backend si avvia con:

```bash
.venv/bin/python -m uvicorn index:app --app-dir api --host 127.0.0.1 --port 8000 --reload
```

## API e autenticazione

Questa estrazione separa il frontend e il suo rilascio. Il servizio dati resta il backend condiviso con la chat del sito: `/api/admin/*`. Sono conservati sessioni con cookie HttpOnly, controlli di accesso, validazione, conferme WhatsApp/email manuali e consensi. Nessuna credenziale amministrativa è inclusa nel frontend.

`@supabase/supabase-js` è disponibile come richiesto e `.env` contiene i campi per URL e chiave publishable. Non sono usati dal flusso corrente: aggiungerli non sostituisce l'autenticazione FastAPI. Le chiavi riservate rimangono nel backend.

## Verifiche e build

```bash
npm test
npm run build
npm run preview
```

Preview: http://localhost:4174. Nessun test inserisce prenotazioni nel database.

## Dominio dedicato

Pubblica `dist/` sul dominio dell'agenda e configura il server di hosting così:

1. `/api/admin/*` deve essere inoltrato al backend FastAPI, conservando percorso, query, cookie, header `Origin`, `X-Admin-Request` e risposte `Set-Cookie`. Questo proxy deve avere la precedenza sul fallback SPA.
2. Ogni altro percorso deve servire `index.html` (anche aprendo direttamente la pagina del giorno).
3. Nel backend aggiungi il vero dominio HTTPS dell'agenda ad `ALLOWED_ORIGINS` e imposta `ADMIN_COOKIE_SECURE=true`.
4. Prima della build imposta `VITE_PUBLIC_SITE_URL` al dominio del sito pubblico: il link privacy deve portare al sito, non all'agenda.

Il proxy Vite è per sviluppo/preview: non viene incluso nei file statici di `dist/`. Dominio e proxy di produzione vanno configurati nell'hosting scelto. Il database e le API restano necessari anche dopo la separazione.
