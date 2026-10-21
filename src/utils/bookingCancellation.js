import { prepareCommunication, sendEmailTemplate } from './bookingCommunications.js';

export function cancellationWhatsAppAllowed(status) {
  return ['skipped', 'failed', 'bounced'].includes(status);
}

// Called only after a confirmed cancellation. Reuse its lifecycle event; never
// create a separate template or automatically retry a previous attempt.
export async function sendCancellationEmail(client, bookingId, request) {
  try {
    const row = await prepareCommunication(client, bookingId, 'email', request);
    if (!Number.isSafeInteger(row.id) || row.id < 1 || row.kind !== 'cancelled') {
      return { status: 'unknown' };
    }
    if (row.status !== 'queued' || (row.attempts ?? 0) !== 0) return { status: row.status };
    const result = await sendEmailTemplate(client, bookingId, row.id, request);
    if (result.bookingId !== bookingId || result.communicationId !== row.id) return { status: 'unknown' };
    return result;
  } catch {
    // A lost response can hide a successful send. Keep the cancellation and
    // require a log check instead of sending again or claiming success.
    return { status: 'unknown' };
  }
}

export function cancellationFeedback(status) {
  if (['accepted', 'delivered', 'delivery_delayed'].includes(status)) return 'Cancellazione confermata.';
  if (status === 'skipped') return 'Cancellazione confermata. Email assente o non valida: puoi usare WhatsApp.';
  if (['failed', 'bounced'].includes(status)) return 'Cancellazione confermata. Invio email non riuscito: puoi usare WhatsApp.';
  if (status === 'pending') return 'Cancellazione confermata. Invio email in corso…';
  return 'Cancellazione confermata. Esito email da verificare nel log prima di inviare altri messaggi.';
}
