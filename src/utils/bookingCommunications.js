import { whatsappCommunicationUrl } from '../../supabase/functions/agenda-communications/messages.js';
import { normalizePhone } from './bookingValidation.js';
export { communicationMessage, whatsappCommunicationUrl } from '../../supabase/functions/agenda-communications/messages.js';
export const COMMUNICATION_STATUSES = Object.freeze({ queued:'Email preparata · da inviare',sending:'Invio in corso · esito da verificare',accepted:'Accettata dal provider · consegna non verificata',failed:'Invio fallito · nessuna consegna confermata',unknown:'Invio incerto · verificare prima di riprovare',skipped:'Invio non disponibile · email assente o non valida',superseded:'Messaggio superato da un aggiornamento',opened:'Chat preparata · invio manuale, consegna non verificata',delivered:'Consegna confermata dal provider',delivery_delayed:'Consegna in ritardo secondo il provider',bounced:'Email respinta secondo il provider',complained:'Segnalazione del destinatario registrata dal provider' });
async function communicationRequest(client, bookingId, suffix, body, request = globalThis.fetch) {
 if (!Number.isSafeInteger(bookingId) || bookingId < 1) throw new Error('Prenotazione non valida.');
 const { data: { session } = {}, error } = await client.auth.getSession();
 if (error || !session?.access_token) throw new Error('Accedi per consultare l’agenda.');
 const response = await request(`/api/admin/bookings/${bookingId}/${suffix}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Authorization: `Bearer ${session.access_token}`, 'x-admin-request': '1',
   ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
 });
 const result = await response.json().catch(() => null);
 if (!response.ok && !(['send-confirmation-email','send-template-email'].includes(suffix) && response.status === 502
   && ['failed', 'unknown'].includes(result?.status))) {
  throw new Error(typeof result?.detail === 'string' ? result.detail : 'Operazione non confermata. Aggiorna il log prima di riprovare.');
 }
 return result;
}
export async function loadCommunications(client, bookingId, request) {
 const result = await communicationRequest(client, bookingId, 'communications', undefined, request);
 if (!Array.isArray(result?.communications) || result.communications.some(row => String(row?.booking_id) !== String(bookingId))) {
  throw new Error('Elenco comunicazioni non confermato. Aggiorna il log prima di intervenire.');
 }
 return result.communications;
}
export async function prepareCommunication(client, bookingId, channel, request) {
 const result = await communicationRequest(client, bookingId, 'communications/prepare', { channel }, request);
 const row = result?.communication;
 if (String(row?.booking_id) !== String(bookingId) || row.channel !== channel) throw new Error('Comunicazione non confermata.');
 return row;
}
export async function sendCommunication(client, bookingId, request) {
 const result = await communicationRequest(client, bookingId, 'send-confirmation-email', {}, request);
 if (result?.bookingId !== bookingId || !Number.isSafeInteger(result.communicationId)
   || result.communicationId < 1 || result.type !== 'booking_confirmation'
   || !['accepted', 'failed', 'unknown'].includes(result.status)) {
  throw new Error('Esito non confermato. Aggiorna il log prima di riprovare.');
 }
 return result;
}
export function emailSendBlocked(booking, rows) {
 if (rows.some(row => row.channel === 'email' && row.status === 'sending')) return true;
 const current = rows.find(row => row.channel === 'email' && row.status !== 'superseded'
  && row.recipient === booking.email && ['confirmation', 'updated'].includes(row.kind)
  && ['name', 'booking_date', 'booking_time', 'party_size', 'tables'].every(key => row.snapshot?.[key] === booking[key]));
 return Boolean(current && (['accepted', 'unknown', 'sending'].includes(current.status)
  || (current.status === 'failed' && !(Date.parse(current.created_at) > Date.now() - 23 * 3600000))));
}

export function bookingWhatsAppConfirmationUrl(booking) {
 const recipient = typeof booking.phone === 'string' ? normalizePhone(booking.phone) : null;
 if (!recipient) return null;
 return whatsappCommunicationUrl({ channel: 'whatsapp', status: 'opened', kind: 'confirmation', recipient, snapshot: booking });
}

export function usesDirectWhatsAppConfirmation(booking, compact) {
 return Boolean(compact && booking?.status !== 'cancelled');
}

export async function openBookingWhatsApp(client, booking, confirmation = false, openWindow = (...args) => window.open(...args)) {
 const url = confirmation ? bookingWhatsAppConfirmationUrl(booking) : null;
 if (confirmation && !url) throw new Error('Numero di telefono mancante o non valido.');
 // Aprire durante il click evita i blocchi popup dopo la chiamata asincrona.
 const chat = openWindow(url || 'about:blank', '_blank');
 if (!chat) throw new Error('Il browser ha bloccato la chat. Consenti l’apertura e riprova.');
 chat.opener = null;
 try {
  const row = await prepareCommunication(client, booking.id, 'whatsapp');
  if (!confirmation) chat.location.href = whatsappCommunicationUrl(row);
 } catch (failure) {
  if (!confirmation) { chat.close(); throw failure; }
  throw new Error('Chat WhatsApp aperta: invio manuale richiesto. Registrazione nel log non riuscita; consegna non verificata.');
 }
}

export async function prepareEmailTemplate(client,bookingId,kind,proposal='',request) {
 const result=await communicationRequest(client,bookingId,'communications/prepare-template',{kind,proposal},request);
 if(!result?.communication?.id) throw new Error('Preparazione del messaggio non confermata. Aggiorna il log prima di riprovare.');
 return result.communication;
}
export async function sendEmailTemplate(client,bookingId,communicationId,request) {
 const result=await communicationRequest(client,bookingId,'send-template-email',{communication_id:communicationId},request);
 if(!['accepted','failed','unknown'].includes(result?.status)) throw new Error('Esito non confermato. Aggiorna il log prima di riprovare: non risulta una consegna verificata.');
 return result;
}
