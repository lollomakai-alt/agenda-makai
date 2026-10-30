import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sendRejectionEmail } from '../supabase/functions/send-booking-email/bookingRequest.js';
import {
  bookingRequestEmailLabel,
  bookingUpdateEmailLabel,
  loadPendingBookingRequestCount,
  rejectBookingRequest,
  reviewBookingRequest,
  sendBookingUpdateEmail,
} from '../src/utils/bookingRequests.js';

const row = (overrides = {}) => ({
  id: 7,
  status: 'rejected',
  decision_email_status: 'sending',
  decision_email_attempted_at: new Date().toISOString(),
  decision_email: {
    name: 'Ada',
    booking_date: '2026-10-25',
    booking_time: '20:00',
    party_size: 2,
    tables: '',
    request_type: 'ora',
    requested_value: '21:00',
    rejection_reason: 'Siamo al completo.',
    recipient: 'test@example.com',
  },
  ...overrides,
});
const client = record => ({ rpc: async (name, payload) => {
  assert.equal(name, 'admin_booking_request_email_operation');
  assert.deepEqual(payload, { p_request_id: 7, p_action: 'read' });
  return { data: record };
} });

test('rejection email carries the saved reason, requested change and site calendar only', async () => {
  let sent = 0;
  const result = await sendRejectionEmail(client(row()), 7, 'test-secret', async (url, options) => {
    sent++;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers['Idempotency-Key'], 'booking-request-rejected-7');
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.to, ['test@example.com']);
    assert.match(payload.text, /Motivazione: Siamo al completo\./);
    assert.match(payload.text, /Richiesta: Orario → 21:00/);
    assert.ok(payload.text.includes('https://www.makaipigneto.it/prenotazioni'));
    assert.doesNotMatch(payload.text, /gestisci#token|Gestisci o riconferma/i);
    assert.doesNotMatch(payload.text, /tavol|assegnazion/i);
    return Response.json({ id: 'provider-id' });
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.type, 'booking_request_rejected');
  assert.equal(sent, 1);
});

test('provider outcomes are reported without inventing a delivery', async () => {
  for (const [status, expected] of [[422, 'failed'], [429, 'failed'], [500, 'unknown'], [409, 'unknown']]) {
    assert.equal((await sendRejectionEmail(client(row()), 7, 'key', async () => Response.json({}, { status }))).status, expected);
  }
  assert.equal((await sendRejectionEmail(client(row()), 7, 'key', async () => { throw Error('network'); })).status, 'unknown');
  assert.equal((await sendRejectionEmail(client(row()), 7, 'key', async () => Response.json({}))).status, 'unknown');
  assert.equal((await sendRejectionEmail(client(row()), 7, '', async () => Response.json({ id: 'x' }))).status, 'failed');
});

test('unclaimed, expired or incomplete records never reach Resend', async () => {
  const invalid = [
    row({ decision_email_status: 'queued' }),
    row({ id: 8 }),
    row({ status: 'approved' }),
    row({ decision_email: { ...row().decision_email, rejection_reason: ' ' } }),
    row({ decision_email: { ...row().decision_email, rejection_reason: 'x'.repeat(501) } }),
    row({ decision_email: { ...row().decision_email, recipient: 'non-valida' } }),
    row({ decision_email: { ...row().decision_email, request_type: 'sconosciuto' } }),
    row({ decision_email: { ...row().decision_email, booking_date: 'domani' } }),
    row({ decision_email: null }),
  ];
  for (const record of invalid) {
    let sent = 0;
    const result = await sendRejectionEmail(client(record), 7, 'key', async () => { sent++; });
    assert.equal(result.status, 'failed');
    assert.equal(sent, 0);
  }
  // Un tentativo scaduto resta incerto: non viene riaperto dopo la finestra del provider.
  let sent = 0;
  const expired = await sendRejectionEmail(client(row({ decision_email_attempted_at: '2020-01-01T00:00:00Z' })), 7, 'key', async () => { sent++; });
  assert.equal(expired.status, 'unknown');
  assert.equal(sent, 0);
});

test('client rejection sends only the reason and keeps the saved decision on unclear outcomes', async () => {
  const auth = { getSession: async () => ({ data: { session: { access_token: 'admin-jwt' } } }) };
  const calls = [];
  const result = await rejectBookingRequest({ auth }, { id: 7, status: 'pending' }, '  Siamo al completo.  ', async (url, options) => {
    calls.push([url, JSON.parse(options.body)]);
    return Response.json({ request_id: 7, status: 'rejected', booking_id: 42, email_status: 'failed', rejection_reason: 'Siamo al completo.' });
  });
  assert.deepEqual(calls, [['/api/admin/bookings/requests/7/reject', { rejection_reason: 'Siamo al completo.' }]]);
  assert.equal(result.email_status, 'failed');
  assert.match(bookingRequestEmailLabel(result.email_status), /fallito/);
  assert.match(bookingRequestEmailLabel('accepted'), /consegna non verificata/);
  assert.match(bookingRequestEmailLabel('inesistente'), /non confermato/);
  for (const reason of ['', '   ', 'x'.repeat(501)]) {
    await assert.rejects(rejectBookingRequest({}, { id: 7, status: 'pending' }, reason, async () => { calls.push('inviato'); }), /motivazione/);
  }
  assert.equal(calls.length, 1);
  await assert.rejects(rejectBookingRequest({ auth }, { id: 7, status: 'pending' }, 'Motivo', async () => {
    throw new Error('network');
  }), /ricarica le richieste/);
  await assert.rejects(rejectBookingRequest({ auth }, { id: 7, status: 'pending' }, 'Motivo', async () => Response.json({
    request_id: 7, status: 'rejected', email_status: 'accepted', rejection_reason: 'Un altro motivo',
  })), /Motivazione non confermata/);
});

test('rejection is never sent through the approval RPC', async () => {
  const calls = [];
  const rpc = { rpc: async (name, args) => { calls.push([name, args]); return { data: { id: 7, status: args.p_decision } }; } };
  await reviewBookingRequest(rpc, { id: 7, status: 'pending' }, 'approved');
  assert.deepEqual(calls, [['admin_review_booking_request_with_reason', { p_request_id: 7, p_decision: 'approved', p_reason: '' }]]);
  await assert.rejects(reviewBookingRequest(rpc, { id: 7, status: 'pending' }, 'rejected'), /motivazione/);
  assert.equal(calls.length, 1);
});

test('acceptance sends only the update already queued for the changed booking', async () => {
  const auth = { getSession: async () => ({ data: { session: { access_token: 'admin-jwt' } } }) };
  const urls = [];
  const transport = async (url, options) => {
    urls.push(url);
    if (url.endsWith('/communications/prepare')) {
      return Response.json({ communication: { id: 9, booking_id: 42, channel: 'email', kind: 'updated', status: 'queued', attempts: 0 } });
    }
    assert.deepEqual(JSON.parse(options.body), { communication_id: 9 });
    return Response.json({ status: 'accepted', bookingId: 42, communicationId: 9 });
  };
  const result = await sendBookingUpdateEmail({ auth }, 42, transport);
  assert.equal(result.status, 'accepted');
  assert.deepEqual(urls, ['/api/admin/bookings/42/communications/prepare', '/api/admin/bookings/42/send-template-email']);
  assert.match(bookingUpdateEmailLabel('accepted'), /consegna non verificata/);
  assert.match(bookingUpdateEmailLabel('skipped'), /indirizzo assente/);
  const alreadySent = await sendBookingUpdateEmail({ auth }, 42, async () => Response.json({
    communication: { id: 9, booking_id: 42, channel: 'email', kind: 'updated', status: 'sending', attempts: 1 },
  }));
  assert.equal(alreadySent.status, 'unknown');
  const cancelled = await sendBookingUpdateEmail({ auth }, 42, async () => Response.json({
    communication: { id: 9, booking_id: 42, channel: 'email', kind: 'cancelled', status: 'queued', attempts: 0 },
  }));
  assert.equal(cancelled.status, 'unknown');
});

test('pending badge counts only requests awaiting the staff', async () => {
  const chain = { select() { return this; }, eq(column, value) { assert.deepEqual([column, value], ['status', 'pending']); return this; }, then(resolve) {
    return Promise.resolve({ error: null, data: [{ id: 1 }, { id: 2 }] }).then(resolve);
  } };
  assert.equal(await loadPendingBookingRequestCount({ from: () => chain }), 2);
});

test('the requests page never opens or navigates a window automatically', async () => {
  const source = await readFile(new URL('../src/components/BookingRequests.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /window\.open|window\.location\s*=|location\.(assign|replace)\(|about:blank/);
  assert.match(source, /Questo testo sarà scritto nell’email di rifiuto/);
  assert.match(source, /link al calendario del sito/);
  assert.match(source, /Conferma rifiuto e invia email/);
});
