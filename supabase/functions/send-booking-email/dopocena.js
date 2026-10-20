import { communicationMessage } from '../agenda-communications/messages.js';

// Called only after the existing Edge server-credential check. No arbitrary
// recipient/content from callers. Claim belongs to the authenticated backend.
export async function sendDecisionEmail(client, requestId, apiKey, transport = fetch) {
  const result = (status, emailId = null) => ({ requestId, type: 'dopocena_decision', status, emailId });
  const { data: row, error } = await client.rpc('dopocena_email_operation', {
    p_request_id: requestId, p_action: 'read',
  });
  if (error || !row || row.request_id !== requestId || row.status !== 'sending'
    || !['accepted','rejected'].includes(row.decision)) return result('failed');
  const attempted = Date.parse(row.attempted_at);
  if (!Number.isFinite(attempted) || attempted > Date.now() + 60000
    || Date.now() - attempted >= 23 * 3600000) return result('unknown');
  if (!apiKey || typeof row.recipient !== 'string' || row.recipient.length > 120
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.recipient)) return result('failed');
  const snapshot = row.snapshot;
  if (!snapshot || snapshot.status !== row.decision || snapshot.booking_type !== 'dopocena'
    || typeof snapshot.name !== 'string' || !snapshot.name.trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.booking_date)
    || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(snapshot.booking_time)
    || !Number.isSafeInteger(snapshot.party_size) || snapshot.party_size < 1 || snapshot.party_size > 25
    || snapshot.tables !== '') return result('failed');
  if (row.decision === 'accepted' && (typeof snapshot.management_url !== 'string'
    || !/^https:\/\/[^\s]+\/prenotazioni\/gestisci#token=[A-Za-z0-9_-]{43}$/.test(snapshot.management_url))) return result('failed');
  const message = communicationMessage(snapshot, row.decision === 'accepted' ? 'confirmation' : 'rejected');
  try {
    const response = await transport('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `dopocena-decision-${requestId}` },
      body: JSON.stringify({ from: 'Makai Pigneto <prenotazioni@makaipigneto.it>', to: [row.recipient], ...message }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && typeof data?.id === 'string' && data.id) return result('accepted', data.id);
    if (response.status >= 400 && response.status < 500 && ![408,409].includes(response.status)) return result('failed');
    return result('unknown');
  } catch { return result('unknown'); }
}
