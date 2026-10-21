import test from 'node:test';
import assert from 'node:assert/strict';
import { sendCancellationEmail, cancellationWhatsAppAllowed, cancellationFeedback } from '../src/utils/bookingCancellation.js';

const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-session' } } }) } };
const communication = { id: 7, booking_id: 42, channel: 'email', kind: 'cancelled', status: 'queued', attempts: 0 };

test('automatic cancellation sends the existing event once through the authenticated gateway', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return Response.json(calls.length === 1 ? { communication } : { status: 'accepted', bookingId: 42, communicationId: 7 });
  };
  assert.equal((await sendCancellationEmail(client, 42, request)).status, 'accepted');
  assert.deepEqual(calls.map(c => c.url), ['/api/admin/bookings/42/communications/prepare', '/api/admin/bookings/42/send-template-email']);
  assert.deepEqual(calls.map(c => JSON.parse(c.options.body)), [{ channel: 'email' }, { communication_id: 7 }]);
  assert.ok(calls.every(c => c.options.headers.Authorization === 'Bearer test-session'));
  assert.equal(cancellationFeedback('accepted'), 'Cancellazione confermata.');
});

test('missing email, previous attempts and non-queued outcomes never trigger an automatic retry', async () => {
  for (const status of ['skipped','failed','unknown','sending','accepted','delivered','bounced','superseded']) {
    let calls = 0;
    const result = await sendCancellationEmail(client, 42, async () => { calls++; return Response.json({ communication: { ...communication, status } }); });
    assert.equal(result.status, status);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await sendCancellationEmail(client, 42, async () => { calls++; return Response.json({ communication: { ...communication, attempts: 1 } }); });
  assert.equal(calls, 1);
});

test('failed and uncertain sends preserve cancellation feedback without claiming email delivery', async () => {
  for (const status of ['failed', 'unknown']) {
    let calls = 0;
    const result = await sendCancellationEmail(client, 42, async () => ++calls === 1
      ? Response.json({ communication }) : Response.json({ status, bookingId: 42, communicationId: 7 }, { status: 502 }));
    assert.equal(result.status, status);
    assert.match(cancellationFeedback(status), /^Cancellazione confermata\./);
    assert.doesNotMatch(cancellationFeedback(status), /email inviata|consegnata/i);
  }
  for (const failureAt of [1, 2]) {
    let calls = 0;
    const result = await sendCancellationEmail(client, 42, async () => {
      if (++calls === failureAt) throw Error('network');
      return Response.json({ communication });
    });
    assert.equal(result.status, 'unknown');
    assert.equal(calls, failureAt);
  }
});

test('unrelated or malformed communication cannot send an email; fallback only on known email problems', async () => {
  for (const row of [{ ...communication, kind: 'confirmation' }, { ...communication, booking_id: 99 }, { ...communication, id: null }]) {
    let calls = 0;
    assert.equal((await sendCancellationEmail(client, 42, async () => { calls++; return Response.json({ communication: row }); })).status, 'unknown');
    assert.equal(calls, 1);
  }
  for (const status of ['skipped','failed','bounced']) assert.equal(cancellationWhatsAppAllowed(status), true);
  for (const status of ['pending','queued','sending','accepted','unknown','delivered',null]) assert.equal(cancellationWhatsAppAllowed(status), false);
});
