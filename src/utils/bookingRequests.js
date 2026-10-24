import { prepareCommunication, sendEmailTemplate } from './bookingCommunications.js';

export const REQUEST_TYPES = Object.freeze({ data: 'Data', ora: 'Ora', persone: 'Persone', cancellazione: 'Cancellazione', note: 'Note' });
export const REQUEST_FIELDS = Object.freeze({ data: 'booking_date', ora: 'booking_time', persone: 'party_size', note: 'notes' });

export function requestValue(type, value) {
  if (!Object.hasOwn(REQUEST_TYPES, type)) throw new Error('Tipo richiesta non valido.');
  if (type === 'cancellazione') return null;
  if (type === 'persone') {
    if (!/^[1-6]$/.test(String(value))) throw new Error('Inserisci un numero intero da 1 a 6.');
    return Number(value);
  }
  if (typeof value !== 'string') throw new Error('Valore richiesta non valido.');
  if (type === 'data') {
    const date = new Date(`${value}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Data non valida.');
  }
  if (type === 'ora' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Ora non valida.');
  if (type === 'note' && value.length > 300) throw new Error('Note: massimo 300 caratteri.');
  return value;
}

function failure(error) {
  throw new Error(error.code === 'PGRST202' || error.code === '42P01'
    ? 'Richieste non configurate: applicare supabase/booking-requests.sql.'
    : error.message || 'Operazione non confermata.');
}

export async function loadBookingRequests(client) {
  const { data, error } = await client.from('booking_requests')
    .select('id,booking_id,request_type,requested_value,status,created_at,reviewed_at,alternative_note,origin,rejection_reason,decision_email_status,decision_email_error,booking:bookings!booking_requests_booking_id_fkey(id,name,email,phone,booking_date,booking_time,party_size,tables,status,booking_type)')
    .order('created_at', { ascending: false }).order('id', { ascending: false });
  if (error) failure(error);
  return data || [];
}

export async function loadPendingBookingRequestCount(client) {
  const { data, error } = await client.from('booking_requests').select('id').eq('status', 'pending');
  if (error) failure(error);
  return Array.isArray(data) ? data.length : 0;
}

export async function loadBookingRequestAlternatives(client, requestId) {
  const { data, error } = await client.rpc('admin_booking_request_alternatives', { request_id: requestId });
  if (error) failure(error);
  if (!Array.isArray(data)) throw new Error('Alternative non disponibili.');
  return data;
}

export async function createBookingRequest(client, bookingId, type, value) {
  const { data, error } = await client.rpc('admin_create_booking_request', {
    booking_id: bookingId, request_type: type, requested_value: requestValue(type, value),
  });
  if (error) failure(error);
  if (!data?.id || String(data.booking_id) !== String(bookingId) || data.status !== 'pending') throw new Error('Richiesta non confermata. Aggiorna prima di riprovare.');
  return data;
}

// Approval keeps its existing atomic RPC. A rejection always carries the reason
// the customer will read in the email, so it uses the dedicated path below.
export async function reviewBookingRequest(client, request, decision) {
  if (decision === 'rejected') throw new Error('Per rifiutare inserisci la motivazione nel pannello di rifiuto.');
  if (decision !== 'approved' || request.status !== 'pending') throw new Error('Decisione non valida o richiesta già gestita.');
  const { data, error } = await client.rpc('admin_review_booking_request', { request_id: request.id, decision });
  if (error) failure(error);
  if (String(data?.id) !== String(request.id) || data?.status !== decision) throw new Error('Decisione non confermata. Aggiorna prima di riprovare.');
  return data;
}

export async function rejectBookingRequest(client, request, reason, transport = globalThis.fetch) {
  if (!request?.id || request.status !== 'pending') throw new Error('Decisione non valida o richiesta già gestita.');
  const text = String(reason).trim();
  if (!text || text.length > 500 || text.includes('\0')) throw new Error('Inserisci una motivazione del rifiuto (massimo 500 caratteri).');
  const { data: { session } = {}, error } = await client.auth.getSession();
  if (error || !session?.access_token) throw new Error('Accedi per gestire le richieste.');
  let response, data;
  try {
    response = await transport(`/api/admin/bookings/requests/${encodeURIComponent(request.id)}/reject`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json', 'x-admin-request': '1' },
      body: JSON.stringify({ rejection_reason: text }),
    });
    data = await response.json();
  } catch {
    throw new Error('Esito non confermato: ricarica le richieste. Il rifiuto potrebbe essere già salvato; verifica l’esito email.');
  }
  if (!response.ok) throw new Error(data?.detail || 'Rifiuto non confermato. Ricarica le richieste.');
  if (String(data?.request_id) !== String(request.id) || data?.status !== 'rejected') {
    throw new Error('Esito non confermato. Aggiorna le richieste prima di riprovare.');
  }
  if (data.rejection_reason !== text) throw new Error('Motivazione non confermata. Aggiorna le richieste prima di contattare il cliente.');
  if (!Object.hasOwn(BOOKING_REQUEST_EMAIL_LABELS, data.email_status)) data.email_status = 'unknown';
  return data;
}

// The approval already queues one "updated" communication from the database
// trigger; the page only claims and sends that existing attempt.
export async function sendBookingUpdateEmail(client, bookingId, request) {
  try {
    const row = await prepareCommunication(client, bookingId, 'email', request);
    if (!Number.isSafeInteger(row.id) || row.id < 1 || row.kind !== 'updated') return { status: 'unknown' };
    // Only this approval's untouched attempt is sent; an older or already
    // attempted message leaves the outcome to the log instead of claiming it.
    if (row.status !== 'queued' || (row.attempts ?? 0) !== 0) return { status: 'unknown' };
    const result = await sendEmailTemplate(client, bookingId, row.id, request);
    if (result.bookingId !== bookingId || result.communicationId !== row.id) return { status: 'unknown' };
    return result;
  } catch {
    return { status: 'unknown' };
  }
}

export const BOOKING_REQUEST_EMAIL_LABELS = Object.freeze({
  queued: 'Email preparata · invio non confermato',
  sending: 'Invio email in corso o esito da verificare',
  accepted: 'Email accettata dal provider · consegna non verificata',
  failed: 'Invio email fallito · rifiuto conservato',
  unknown: 'Esito email incerto · verificare prima di contattare il cliente',
  skipped: 'Email non inviata · indirizzo assente o non valido',
});
export function bookingRequestEmailLabel(status) {
  return BOOKING_REQUEST_EMAIL_LABELS[status] || 'Invio email non confermato';
}

export function bookingUpdateEmailLabel(status) {
  if (['accepted', 'delivered', 'delivery_delayed'].includes(status)) return 'Email di conferma accettata dal provider · consegna non verificata.';
  if (status === 'skipped') return 'Email non inviata: indirizzo assente o non valido.';
  if (['failed', 'bounced'].includes(status)) return 'Invio email non riuscito.';
  if (['queued', 'sending', 'pending'].includes(status)) return 'Invio email in corso o esito da verificare nel log.';
  return 'Esito email da verificare nel log.';
}
