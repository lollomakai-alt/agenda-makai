export const DOPOCENA_DECISIONS = Object.freeze(['accepted', 'rejected']);
import { bookingWhatsAppConfirmationUrl, whatsappCommunicationUrl } from './bookingCommunications.js';
import { normalizePhone } from './bookingValidation.js';

export function onlineDopocenaWhatsAppUrl(request, decision, bookingId) {
  if (decision === 'accepted') {
    return bookingWhatsAppConfirmationUrl({ ...request, id: bookingId, status: 'confirmed', tables: '' });
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

export async function loadOnlineDopocenaRequests(client) {
  const { data, error } = await client.rpc('admin_list_online_dopocena_requests');
  if (error) failure(error);
  if (!Array.isArray(data)) throw new Error('Elenco richieste DOPOCENA non confermato.');
  return data;
}

export async function reviewOnlineDopocenaRequest(client, request, decision) {
  if (!request?.request_id || request.status !== 'pending' || !DOPOCENA_DECISIONS.includes(decision)) {
    throw new Error('Decisione non valida o richiesta già gestita.');
  }
  const { data, error } = await client.rpc('admin_review_online_dopocena_request', {
    p_request_id: request.request_id,
    p_decision: decision,
  });
  if (error) failure(error);
  if (data?.request_id !== request.request_id || data?.status !== decision) {
    throw new Error('Esito non confermato. Aggiorna la coda prima di riprovare.');
  }
  if (decision === 'accepted' && (!Number.isSafeInteger(data.booking_id) || data.booking_id < 1)) {
    throw new Error('Prenotazione DOPOCENA non confermata dal database.');
  }
  return data;
}
