// Keep the existing FastAPI operations behind the Agenda's own origin.
// API_PROXY_TARGET is a server-only Vercel environment variable.
export default async function handler(request, response) {
  const target = process.env.API_PROXY_TARGET;
  if (!target) return response.status(503).json({ detail: 'Configura API_PROXY_TARGET con l’URL pubblico del backend Makai.' });
  let base;
  try {
    base = new URL(target);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error();
  } catch {
    return response.status(503).json({ detail: 'API_PROXY_TARGET deve essere l’origine HTTPS del backend Makai.' });
  }
  const incoming = new URL(request.url, 'https://agenda.invalid');
  if (!incoming.pathname.startsWith('/api/admin/')) return response.status(404).json({ detail: 'Percorso non disponibile.' });
  const headers = {};
  for (const name of ['authorization', 'content-type', 'origin', 'x-admin-request', 'sec-fetch-site']) {
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  const options = { method: request.method, headers, signal: AbortSignal.timeout(15000), redirect: 'error' };
  if (!['GET', 'HEAD'].includes(request.method) && request.body !== undefined) {
    options.body = typeof request.body === 'string' || Buffer.isBuffer(request.body) ? request.body : JSON.stringify(request.body);
  }
  try {
    const upstream = await fetch(new URL(incoming.pathname + incoming.search, base), options);
    response.setHeader('Cache-Control', 'no-store');
    for (const name of ['content-type', 'retry-after']) {
      const value = upstream.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    return response.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    return response.status(502).json({ detail: 'Backend Makai non raggiungibile. Riprova.' });
  }
}
