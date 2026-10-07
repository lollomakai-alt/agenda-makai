import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebPushHandler } from '../supabase/functions/web-push-admin/logic.js';

const admin = { id: 'admin-user', app_metadata: { role: 'admin' } };
const subscription = {
  user_id: admin.id,
  endpoint: 'https://push.example/subscription/1',
  p256dh: 'p256dh',
  auth: 'auth',
  expiration_time: null,
};
const vapid = { publicKey: 'public-key-only', privateKey: 'server-private-key', subject: 'mailto:admin@example.test' };

function makeHandler(overrides = {}) {
  const calls = [];
  const dependencies = {
    ...vapid,
    resolveUser: async token => { calls.push(['resolveUser', token]); return admin; },
    findSubscription: async (userId, endpoint) => { calls.push(['findSubscription', userId, endpoint]); return subscription; },
    deleteSubscription: async (userId, endpoint) => { calls.push(['deleteSubscription', userId, endpoint]); },
    sendNotification: async (row, payload, config) => { calls.push(['sendNotification', row, JSON.parse(payload), config]); },
    ...overrides,
  };
  return { handler: createWebPushHandler(dependencies), calls };
}

function request(body, { method = 'POST', authorization = 'Bearer verified-token' } = {}) {
  return new Request('https://supabase.example/functions/v1/web-push-admin', {
    method,
    headers: authorization ? { authorization, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

test('requires a valid bearer session and an ADMIN app_metadata role', async () => {
  const { handler } = makeHandler({ resolveUser: async () => null });
  assert.equal((await handler(request({ action: 'config' }, { authorization: '' }))).status, 401);
  assert.equal((await handler(request({ action: 'config' }))).status, 401);

  const nonAdmin = makeHandler({ resolveUser: async () => ({ id: 'customer', user_metadata: { role: 'admin' } }) });
  const response = await nonAdmin.handler(request({ action: 'config' }));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /staff/);
});

test('returns only the public VAPID key to an authenticated ADMIN', async () => {
  const { handler } = makeHandler();
  const response = await handler(request({ action: 'config' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { publicKey: vapid.publicKey });
  assert.equal(JSON.stringify(body).includes(vapid.privateKey), false);
});

test('test push scopes endpoint lookup to authenticated user and uses VAPID only server-side', async () => {
  const { handler, calls } = makeHandler();
  const response = await handler(request({ action: 'test', endpoint: subscription.endpoint }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: true });
  assert.deepEqual(calls.find(call => call[0] === 'findSubscription'), ['findSubscription', admin.id, subscription.endpoint]);
  const send = calls.find(call => call[0] === 'sendNotification');
  assert.equal(send[1], subscription);
  assert.deepEqual(send[2], {
    title: 'Agenda Makai · Test push',
    body: 'Notifica di prova inviata manualmente dall’area ADMIN.',
    url: '/prenotazioni',
  });
  assert.deepEqual(send[3], vapid);
});

test('rejects invalid endpoints and never sends for a missing or other-user subscription', async () => {
  const missing = makeHandler({ findSubscription: async () => null });
  assert.equal((await missing.handler(request({ action: 'test', endpoint: 'https://push.example/other' }))).status, 404);
  assert.equal(missing.calls.some(call => call[0] === 'sendNotification'), false);

  const invalid = makeHandler();
  assert.equal((await invalid.handler(request({ action: 'test', endpoint: 'http://push.example/endpoint' }))).status, 400);
  assert.equal(invalid.calls.some(call => call[0] === 'findSubscription'), false);
});

test('removes already expired subscriptions without sending', async () => {
  const expired = makeHandler({
    findSubscription: async () => ({ ...subscription, expiration_time: '2000-01-01T00:00:00.000Z' }),
  });
  const response = await expired.handler(request({ action: 'test', endpoint: subscription.endpoint }));
  assert.equal(response.status, 410);
  assert.equal(expired.calls.some(call => call[0] === 'deleteSubscription'), true);
  assert.equal(expired.calls.some(call => call[0] === 'sendNotification'), false);
});

test('removes push-service subscriptions returning 404 or 410 and reports other delivery errors', async () => {
  for (const status of [404, 410]) {
    const stale = makeHandler({ sendNotification: async () => { throw { statusCode: status }; } });
    const response = await stale.handler(request({ action: 'test', endpoint: subscription.endpoint }));
    assert.equal(response.status, 410);
    assert.equal(stale.calls.some(call => call[0] === 'deleteSubscription'), true);
  }
  const temporary = makeHandler({ sendNotification: async () => { throw { statusCode: 503 }; } });
  assert.equal((await temporary.handler(request({ action: 'test', endpoint: subscription.endpoint }))).status, 502);
  assert.equal(temporary.calls.some(call => call[0] === 'deleteSubscription'), false);
});

test('handles method, action, JSON, configuration, and database errors explicitly', async () => {
  const { handler } = makeHandler();
  assert.equal((await handler(request({}, { method: 'GET' }))).status, 405);
  assert.equal((await handler(request({ action: 'unknown' }))).status, 400);
  const malformed = new Request('https://supabase.example/functions/v1/web-push-admin', {
    method: 'POST', headers: { authorization: 'Bearer verified-token' }, body: '{',
  });
  assert.equal((await handler(malformed)).status, 400);

  const noPublicKey = makeHandler({ publicKey: '' });
  assert.equal((await noPublicKey.handler(request({ action: 'config' }))).status, 503);
  const incompleteVapid = makeHandler({ privateKey: '' });
  assert.equal((await incompleteVapid.handler(request({ action: 'test', endpoint: subscription.endpoint }))).status, 503);
  const databaseFailure = makeHandler({ findSubscription: async () => { throw new Error('database unavailable'); } });
  assert.equal((await databaseFailure.handler(request({ action: 'test', endpoint: subscription.endpoint }))).status, 500);
});
