export const DOPOCENA_DECISIONS = Object.freeze(['accepted', 'rejected']);
import { bookingWhatsAppConfirmationUrl, whatsappCommunicationUrl } from './bookingCommunications.js';
import { normalizePhone } from './bookingValidation.js';

export function onlineDopocenaWhatsAppUrl(request, decision, bookingId) {
  if (decision === 'accepted') {
    // Service context for the text only; the RPC and its payload stay unchanged.
    return bookingWhatsAppConfirmationUrl({ ...request, id: bookingId, status: 'confirmed', tables: '', booking_type: 'dopocena' });
  }
  if (decision !== 'rejected') return null;
  const recipient = normalizePhone(request?.phone);
  if (!recipient) return null;
  return whatsappCommunicationUrl({ channel: 'whatsapp', status: 'opened', kind: 'rejected', recipient, snapshot: request });
}

function failure(error) {
  throw new Error(error.code === 'PGRST202' || error.code === '42883'
    ? 'Coda DOPOCENA non configurata. Aggiorna il database prima di gestire le richieste.'
    : error.message || 'Richieste DOPOCENA non disponibili.');
}

export async function loadOnlineDopocenaRequests(client, includeEmailOutcomes = true) {
  const { data, error } = await client.rpc('admin_list_online_dopocena_requests');
  if (error) failure(error);
  if (!Array.isArray(data)) throw new Error('Elenco richieste DOPOCENA non confermato.');
  if (!includeEmailOutcomes) return data;
  const outcomes = await client.rpc('admin_dopocena_email_outcomes').catch(() => ({ error: true }));
  const statuses = !outcomes.error && Array.isArray(outcomes.data) ? outcomes.data : [];
  return data.map(row => ({ ...row, email_status: statuses.find(outcome => outcome.request_id === row.request_id)?.status || 'unknown' }));
}

export async function loadPendingOnlineDopocenaCount(client) {
  const requests = await loadOnlineDopocenaRequests(client, false);
  return requests.filter(request => request.status === 'pending').length;
}

export async function reviewOnlineDopocenaRequest(client, request, decision, transport = globalThis.fetch) {
  if (!request?.request_id || request.status !== 'pending' || !DOPOCENA_DECISIONS.includes(decision)) {
    throw new Error('Decisione non valida o richiesta già gestita.');
  }
  const { data: { session } = {}, error } = await client.auth.getSession();
  if (error || !session?.access_token) throw new Error('Accedi per gestire le richieste.');
  let response, data;
  try {
    response = await transport(`/api/admin/bookings/dopocena-requests/${encodeURIComponent(request.request_id)}/decision`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json', 'x-admin-request': '1' }, body: JSON.stringify({ decision }),
    });
    data = await response.json();
  } catch {
    throw new Error('Esito non confermato: ricarica la coda. La decisione potrebbe essere già salvata; verifica l’esito email in archivio.');
  }
  if (!response.ok) throw new Error(data?.detail || 'Decisione non confermata. Ricarica la coda.');
  if (data?.request_id !== request.request_id || data?.status !== decision) {
    throw new Error('Esito non confermato. Aggiorna la coda prima di riprovare.');
  }
  if (decision === 'accepted' && (!Number.isSafeInteger(data.booking_id) || data.booking_id < 1)) {
    throw new Error('Prenotazione DOPOCENA non confermata dal database.');
  }
  if (!Object.hasOwn(DOPOCENA_EMAIL_LABELS, data.email_status)) data.email_status = 'unknown';
  return data;
}

export const DOPOCENA_EMAIL_LABELS = Object.freeze({
  queued: 'Email preparata · invio non confermato',
  sending: 'Invio email in corso o esito da verificare',
  accepted: 'Email accettata da Resend · consegna non verificata',
  failed: 'Invio email fallito · decisione conservata',
  unknown: 'Esito email incerto · verificare prima di riprovare',
  skipped: 'Email non inviata · indirizzo assente o non valido',
});
export function dopocenaEmailLabel(status) {
  return DOPOCENA_EMAIL_LABELS[status] || 'Invio email non confermato';
}
