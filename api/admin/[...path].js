const routes = {
  GET: /^\/api\/admin\/(?:session|bookings(?:\/month)?)$/,
  POST: /^\/api\/admin\/bookings(?:\/[1-9][0-9]*\/(?:arrived|cancel|marketing-consent(?:\/revoke)?))?$/,
};

// Server-only gateway: authenticated staff + a credential shared with FastAPI.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Authorization');
  const incoming = new URL(request.url, 'https://agenda.invalid');
  if (!routes[request.method]?.test(incoming.pathname)) return response.status(404).json({ detail: 'Percorso non disponibile.' });
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || !/^Bearer \S+$/.test(authorization) || authorization.length > 8192) {
    return response.status(401).json({ detail: 'Accedi per consultare l’agenda.' });
  }
  const target = process.env.API_PROXY_TARGET;
  const secret = process.env.AGENDA_BACKEND_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!target || !secret || secret.length < 32 || !supabaseUrl || !publishableKey) {
    return response.status(503).json({ detail: 'Collegamento sicuro dell’Agenda non configurato.' });
  }
  let base, authBase;
  try {
    base = new URL(target);
    authBase = new URL(supabaseUrl);
    for (const url of [base, authBase]) {
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    }
  } catch {
    return response.status(503).json({ detail: 'Gli indirizzi dei servizi devono essere origini HTTPS.' });
  }
  try {
    const auth = await fetch(new URL('/auth/v1/user', authBase), {
      headers: { Authorization: authorization, apikey: publishableKey },
      signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if (auth.status === 401 || auth.status === 403) return response.status(401).json({ detail: 'Sessione non valida. Accedi di nuovo.' });
    if (!auth.ok) return response.status(503).json({ detail: 'Verifica dell’accesso momentaneamente non disponibile.' });
    const user = await auth.json();
    if (!user.id || !['staff', 'admin'].includes(user.app_metadata?.role)) {
      return response.status(403).json({ detail: 'Accesso riservato allo staff.' });
    }
  } catch {
    return response.status(503).json({ detail: 'Verifica dell’accesso momentaneamente non disponibile.' });
  }
  const headers = { authorization, 'x-agenda-backend-key': secret };
  for (const name of ['content-type', 'origin', 'x-admin-request', 'sec-fetch-site']) {
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  const options = { method: request.method, headers, signal: AbortSignal.timeout(15000), redirect: 'error' };
  if (request.method === 'POST' && request.body !== undefined) {
    options.body = typeof request.body === 'string' || Buffer.isBuffer(request.body) ? request.body : JSON.stringify(request.body);
  }
  try {
    const upstream = await fetch(new URL(incoming.pathname + incoming.search, base), options);
    for (const name of ['content-type', 'retry-after']) {
      const value = upstream.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    return response.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    return response.status(502).json({ detail: 'Backend Makai non raggiungibile. Riprova.' });
  }
}
