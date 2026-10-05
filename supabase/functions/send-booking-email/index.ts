import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { communicationMessage } from '../agenda-communications/messages.js';

const FROM = 'Makai Pigneto <prenotazioni@makaipigneto.it>';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(status === 405 ? { Allow: 'POST' } : {}) },
});

async function sameCredential(supplied: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([supplied, expected].map(value =>
    crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

// Diagnostic claims are unverified and never participate in authorization.
function credentialShape(value: string, url: string) {
  let claims: Record<string, unknown> = {};
  try {
    const encoded = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(encoded));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) claims = parsed;
  } catch { /* Report only booleans, never credential contents or parser errors. */ }
  return {
    format: value.startsWith('sb_secret_') ? 'secret_key' : value.split('.').length === 3 ? 'jwt' : 'other',
    whitespace: /\s/.test(value),
    serviceRole: claims.role === 'service_role',
    projectMatches: typeof claims.ref === 'string' && new URL(url).hostname === `${claims.ref}.supabase.co`,
  };
}

async function validLegacyServiceCredential(token: string, url: string): Promise<boolean> {
  const shape = credentialShape(token, url);
  if (shape.format !== 'jwt' || shape.whitespace || !shape.serviceRole || !shape.projectMatches) return false;
  // Decoded claims alone are never trusted. PostgREST verifies the signature and
  // permission on a table explicitly denied to anon/authenticated. limit=0 reads no rows.
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/booking_communications?select=id&limit=0`, {
      headers: { Authorization: `Bearer ${token}`, apikey: token },
      redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const rows = await response.json();
    return Array.isArray(rows) && rows.length === 0;
  } catch { return false; }
}

// Server-only: the backend checks the admin session before using service_role.
export async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Metodo non consentito' }, 405);
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || token.length > 8192) return respond({ error: 'Credenziale server richiesta' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!url || !serviceKey) return respond({ error: 'Email non configurate' }, 503);

  try {
    if (!await sameCredential(token, serviceKey) && !await validLegacyServiceCredential(token, url)) {
      console.warn(JSON.stringify({ event: 'booking_email_credential_mismatch',
        supplied: credentialShape(token, url), expected: credentialShape(serviceKey, url) }));
      return respond({ error: 'Credenziale server non valida' }, 401);
    }
    const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return respond({ error: 'Content-Type richiesto: application/json' }, 415);
    }
    // Bound the actual stream, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return respond({ error: 'JSON richiesto' }, 400);
    let raw = '';
    let size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        return respond({ error: 'Richiesta troppo grande' }, 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    let body;
    try { body = JSON.parse(raw); } catch { return respond({ error: 'JSON non valido' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['bookingId', 'type', 'communicationId'].includes(key))
      || !Number.isSafeInteger(body.bookingId) || body.bookingId < 1
      || !Number.isSafeInteger(body.communicationId) || body.communicationId < 1
      || body.type !== 'booking_confirmation') {
      return respond({ error: 'Sono richiesti bookingId, communicationId e type booking_confirmation, senza altri campi' }, 400);
    }
    const outcome = (status: 'accepted' | 'failed' | 'unknown', errorCode: string | null, emailId: string | null = null) =>
      respond({ bookingId: body.bookingId, type: body.type, communicationId: body.communicationId, status, emailId, errorCode });
    if (!apiKey) return outcome('failed', 'email_not_configured');
    // Backend owns prepare/claim/finish. Edge only transports an already claimed row.
    const { data: row, error: rowError } = await client.from('booking_communications')
      .select('id,booking_id,channel,kind,status,snapshot,recipient,attempted_at')
      .eq('id', body.communicationId).eq('booking_id', body.bookingId).maybeSingle();
    if (rowError || !row || row.status !== 'sending' || row.channel !== 'email'
      || !['confirmation', 'updated'].includes(row.kind)) return outcome('failed', 'communication_unavailable');
    // A stuck attempt cannot replay after the provider idempotency window expires.
    const attempted = Date.parse(row.attempted_at);
    if (!Number.isFinite(attempted) || attempted > Date.now() + 60000
      || Date.now() - attempted >= 23 * 3600000) return outcome('unknown', 'communication_unavailable');
    const { data: booking, error } = await client.from('bookings')
      .select('id,name,email,booking_date,booking_time,party_size,tables,status')
      .eq('id', body.bookingId).maybeSingle();
    if (error) return outcome('failed', 'communication_unavailable');
    if (!booking || booking.status !== 'confirmed' || row.recipient !== booking.email
      || !row.snapshot || typeof row.snapshot !== 'object'
      || (['name', 'booking_date', 'booking_time', 'party_size', 'tables'] as const).some(key => row.snapshot[key] !== booking[key])) {
      return outcome('failed', 'stale_booking');
    }
    if (typeof row.recipient !== 'string' || row.recipient.length > 120
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.recipient)) return outcome('failed', 'invalid_email');
    const snapshot = row.snapshot;
    if (typeof snapshot.name !== 'string' || !snapshot.name.trim()
      || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.booking_date)
      || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(snapshot.booking_time)
      || !Number.isSafeInteger(snapshot.party_size) || snapshot.party_size < 1) {
      return outcome('failed', 'invalid_booking');
    }
    const message = communicationMessage(snapshot, row.kind);
    let response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
          'Idempotency-Key': `agenda-email-${row.id}` },
        body: JSON.stringify({ from: FROM, to: [row.recipient], ...message }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      return outcome('unknown', 'network_uncertain');
    }
    const result = await response.json().catch(() => null);
    if (response.ok && typeof result?.id === 'string' && result.id) return outcome('accepted', null, result.id);
    if (response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status)) {
      return outcome('failed', `provider_http_${response.status}`);
    }
    return outcome('unknown', `provider_uncertain_${response.status}`);
  } catch {
    // Never return exception details, database errors, credentials or provider bodies.
    return respond({ error: 'Errore interno' }, 500);
  }
}

if (import.meta.main) Deno.serve(handler);
