import { communicationMessage } from './messages.js';
export async function sendQueuedEmail(client, id, config, fetcher = fetch) {
  if (!config.apiKey || !config.from) throw new Error('Email non configurate: servono RESEND_API_KEY e AGENDA_EMAIL_FROM.');
  const { data: row, error: claimError } = await client.rpc('claim_booking_email', { p_id:id });
  if (claimError) throw new Error('Impossibile registrare il tentativo email.');
  if (!row) throw new Error('Comunicazione già gestita o invio in corso.');
  let outcome = 'unknown', providerId = null, errorCode = 'network_uncertain';
  try {
    const message = communicationMessage(row.snapshot,row.kind);
    const response = await fetcher('https://api.resend.com/emails', { method:'POST',
      headers:{ Authorization:`Bearer ${config.apiKey}`, 'Content-Type':'application/json', 'Idempotency-Key':`agenda-email-${row.id}` },
      body:JSON.stringify({ from:config.from, to:[row.recipient], ...message }), signal:AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => null);
    if (response.ok && typeof data?.id === 'string' && data.id) { outcome='accepted'; providerId=data.id; errorCode=null; }
    else if (response.status >= 400 && response.status < 500 && response.status !== 409) { outcome='failed'; errorCode=`provider_http_${response.status}`; }
    else errorCode=`provider_uncertain_${response.status}`;
  } catch { /* Non riprovare automaticamente un invio dall'esito incerto. */ }
  const { error } = await client.rpc('finish_booking_email', { p_id:row.id, p_status:outcome, p_provider_id:providerId, p_error_code:errorCode });
  if (error) throw new Error('Esito email non registrato: verifica prima di riprovare.');
  return { id:row.id, status:outcome };
}
