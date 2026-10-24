import { communicationMessage } from '../agenda-communications/messages.js';

const REQUEST_TYPES = ['data', 'ora', 'persone', 'note', 'cancellazione'];

// Called only after the existing Edge server-credential check. The backend
// owns claim and finish; this transports one already claimed rejection.
export async function sendRejectionEmail(client, requestId, apiKey, transport = fetch) {
  const result = (status, emailId = null) => ({ requestId, type: 'booking_request_rejected', status, emailId });
  const { data: row, error } = await client.rpc('admin_booking_request_email_operation', {
    p_request_id: requestId, p_action: 'read',
  });
  if (error || !row || typeof row !== 'object' || Array.isArray(row)) return result('failed');
  if (row.id !== requestId || row.status !== 'rejected' || row.decision_email_status !== 'sending') return result('failed');
  const attempted = Date.parse(row.decision_email_attempted_at);
  if (!Number.isFinite(attempted) || attempted > Date.now() + 60000
    || Date.now() - attempted >= 23 * 3600000) return result('unknown');
  if (!apiKey) return result('failed');
  const snapshot = row.decision_email;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || !REQUEST_TYPES.includes(snapshot.request_type)
    || typeof snapshot.name !== 'string' || !snapshot.name.trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.booking_date)
    || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(snapshot.booking_time)
    || !Number.isSafeInteger(snapshot.party_size) || snapshot.party_size < 1 || snapshot.party_size > 50
    || typeof snapshot.rejection_reason !== 'string' || !snapshot.rejection_reason.trim()
    || snapshot.rejection_reason.length > 500
    || typeof snapshot.recipient !== 'string' || snapshot.recipient.length > 120
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.recipient)) return result('failed');
  const message = communicationMessage(snapshot, 'request_rejected');
  try {
    const response = await transport('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `booking-request-rejected-${requestId}` },
      body: JSON.stringify({ from: 'Makai Pigneto <prenotazioni@makaipigneto.it>', to: [snapshot.recipient], ...message }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && typeof data?.id === 'string' && data.id) return result('accepted', data.id);
    if (response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status)) return result('failed');
    return result('unknown');
  } catch { return result('unknown'); }
}
