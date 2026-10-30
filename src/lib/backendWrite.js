// Il Backend comune e' il percorso principale per le scritture di Agenda.
// Se e' irraggiungibile (rete, 502/503/504) il chiamante puo' usare le sole
// RPC autorizzate del database Agenda. Un errore applicativo (4xx) non attiva
// mai il fallback: eviterebbe scritture duplicate o non validate.
export class BackendUnavailable extends Error {
  constructor(message = 'Backend non disponibile.') {
    super(message);
    this.name = 'BackendUnavailable';
  }
}

const COOLDOWN_MS = 15000;
let downUntil = 0;
let adminFetchPromise = null;

function loadAdminFetch() {
  adminFetchPromise ??= import('./adminFetch.js').then(module => module.adminFetch);
  return adminFetchPromise;
}

export function isBackendUnavailable(error) {
  return error instanceof BackendUnavailable;
}

export function backendReachable() {
  return hasBrowserSession() && Date.now() >= downUntil;
}

export function markBackendDown() {
  downUntil = Date.now() + COOLDOWN_MS;
}

export function resetBackend() {
  downUntil = 0;
}

function hasBrowserSession() {
  try {
    return typeof globalThis.window !== 'undefined' && Boolean(globalThis.window.localStorage);
  } catch {
    return false;
  }
}

export async function backendJson(path, { method = 'POST', body, timeoutMs = 15000 } = {}) {
  if (!hasBrowserSession() || Date.now() < downUntil) throw new BackendUnavailable();
  let response;
  try {
    const adminFetch = await loadAdminFetch();
    response = await adminFetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (String(error?.message || '').includes('Accedi')) throw error;
    markBackendDown();
    throw new BackendUnavailable();
  }
  if ([502, 503, 504].includes(response.status)) {
    markBackendDown();
    throw new BackendUnavailable();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) window.location.replace('/');
    throw new Error(data?.detail || 'Operazione non salvata.');
  }
  resetBackend();
  return data;
}
