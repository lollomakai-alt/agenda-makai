import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  decodeApplicationServerKey,
  notificationPermissionState,
  pushSubscriptionRecord,
  removePushSubscription,
  requestNotificationPermission,
  savePushSubscription,
  sendTestPush,
  subscribeAdminPush,
  unsubscribeAdminPush,
} from '../src/utils/webPush.js';

function browser({ permission = 'default', userAgent = 'Mozilla/5.0', platform = 'MacIntel', maxTouchPoints = 0, standalone = false, secure = true } = {}) {
  let requestCount = 0;
  const environment = {
    isSecureContext: secure,
    navigator: {
      userAgent,
      platform,
      maxTouchPoints,
      standalone,
      serviceWorker: {},
    },
    PushManager: function PushManager() {},
    Notification: {
      permission,
      requestPermission() {
        requestCount++;
        return Promise.resolve(permission);
      },
    },
    matchMedia: () => ({ matches: false }),
  };
  return { environment, requestCount: () => requestCount };
}

test('reports granted, denied, and default browser permission states', () => {
  for (const permission of ['granted', 'denied', 'default']) {
    const mock = browser({ permission });
    assert.equal(notificationPermissionState(mock.environment), permission);
  }
});

test('does not offer notification permission outside a secure context or supported API', () => {
  assert.equal(notificationPermissionState(browser({ secure: false }).environment), 'unsupported');
  const mock = browser();
  delete mock.environment.Notification;
  assert.equal(notificationPermissionState(mock.environment), 'unsupported');
});

test('requires iOS Safari to run as an installed standalone PWA', () => {
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone' };
  assert.equal(notificationPermissionState(browser({ ...iphone }).environment), 'standalone-required');
  assert.equal(notificationPermissionState(browser({ ...iphone, standalone: true }).environment), 'default');

  const ipadOS = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5 };
  assert.equal(notificationPermissionState(browser({ ...ipadOS }).environment), 'standalone-required');
});

test('requests permission only when explicitly invoked from the enabled action', async () => {
  const mock = browser();
  assert.equal(mock.requestCount(), 0);
  assert.equal(await requestNotificationPermission(mock.environment), 'default');
  assert.equal(mock.requestCount(), 1);
});

test('does not request permission again after it was denied', () => {
  const mock = browser({ permission: 'denied' });
  assert.throws(() => requestNotificationPermission(mock.environment), /non può essere richiesto/);
  assert.equal(mock.requestCount(), 0);
});

test('service worker shows push payloads and rejects off-origin notification links', async () => {
  const listeners = new Map();
  let shown;
  const self = {
    location: { origin: 'https://agenda.test' },
    registration: { showNotification: (title, options) => { shown = { title, options }; } },
    addEventListener: (name, listener) => listeners.set(name, listener),
    clients: { openWindow: () => Promise.resolve() },
  };
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { self, URL, JSON, SyntaxError, TypeError });

  const pending = [];
  listeners.get('push')({
    data: { text: () => JSON.stringify({ title: 'Nuova', body: 'Da controllare', url: 'https://altro.test' }) },
    waitUntil: promise => pending.push(promise),
  });
  await Promise.all(pending);
  assert.equal(shown.title, 'Nuova');
  assert.equal(shown.options.body, 'Da controllare');
  assert.equal(shown.options.data.url, '/prenotazioni');
});

test('service worker safely displays non-JSON push payloads', async () => {
  const listeners = new Map();
  let shown;
  const self = {
    location: { origin: 'https://agenda.test' },
    registration: { showNotification: (title, options) => { shown = { title, options }; } },
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { self, URL, JSON, SyntaxError, TypeError });

  const pending = [];
  listeners.get('push')({
    data: { text: () => 'Notifica semplice' },
    waitUntil: promise => pending.push(promise),
  });
  await Promise.all(pending);
  assert.equal(shown.title, 'Agenda Makai');
  assert.equal(shown.options.body, 'Notifica semplice');
});

test('decodes only an uncompressed P-256 public application server key', () => {
  const bytes = new Uint8Array(65);
  bytes[0] = 4;
  const key = Buffer.from(bytes).toString('base64url');
  assert.deepEqual([...decodeApplicationServerKey(key)], [...bytes]);
  assert.throws(() => decodeApplicationServerKey('invalid'), /non è valida/);
  assert.throws(() => decodeApplicationServerKey(Buffer.from([1, 2, 3]).toString('base64url')), /non è valida/);
});

test('subscription records contain the owning user and only valid endpoint key material', () => {
  const subscription = {
    toJSON: () => ({
      endpoint: 'https://push.example/subscription/123',
      expirationTime: null,
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }),
  };
  assert.deepEqual(pushSubscriptionRecord(subscription, 'admin-1', 'iPhone'), {
    user_id: 'admin-1',
    endpoint: 'https://push.example/subscription/123',
    p256dh: 'public-key',
    auth: 'auth-secret',
    expiration_time: null,
  });
  assert.throws(() => pushSubscriptionRecord({ toJSON: () => ({ endpoint: 'http://invalid' }) }, 'admin-1'), /non è valida/);
  assert.equal(pushSubscriptionRecord({
    toJSON: () => ({ endpoint: 'https://push.example/expired', expirationTime: 0, keys: { p256dh: 'p', auth: 'a' } }),
  }, 'admin-1').expiration_time, '1970-01-01T00:00:00.000Z');
});

test('saving and removing a subscription are scoped to the authenticated admin and endpoint', async () => {
  const calls = [];
  const client = {
    from: table => {
      calls.push(['from', table]);
      return {
        upsert: async (record, options) => { calls.push(['upsert', record, options]); return { error: null }; },
        delete() {
          return {
            eq(column, value) {
              calls.push(['eq', column, value]);
              return { eq: async (nextColumn, nextValue) => { calls.push(['eq', nextColumn, nextValue]); return { error: null }; } };
            },
          };
        },
      };
    },
  };
  const subscription = {
    endpoint: 'https://push.example/endpoint',
    toJSON: () => ({ endpoint: 'https://push.example/endpoint', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: async () => true,
  };
  await savePushSubscription(client, 'admin-1', subscription);
  await removePushSubscription(client, 'admin-1', subscription);
  assert.deepEqual(calls[0], ['from', 'admin_push_subscriptions']);
  assert.equal(calls[1][1].user_id, 'admin-1');
  assert.deepEqual(calls[1][2], { onConflict: 'endpoint' });
  assert.deepEqual(calls.slice(2), [
    ['from', 'admin_push_subscriptions'],
    ['eq', 'user_id', 'admin-1'],
    ['eq', 'endpoint', 'https://push.example/endpoint'],
  ]);
});

test('subscribe obtains the public key only when needed and saves after authenticated subscription creation', async () => {
  const bytes = new Uint8Array(65);
  bytes[0] = 4;
  const publicKey = Buffer.from(bytes).toString('base64url');
  const subscription = {
    toJSON: () => ({ endpoint: 'https://push.example/endpoint', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
  };
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1', app_metadata: { role: 'admin' } } } }) },
    functions: { invoke: async (_name, { body }) => { calls.push(['invoke', body]); return { data: { publicKey } }; } },
    from: () => ({ upsert: async (record) => { calls.push(['upsert', record]); return { error: null }; } }),
  };
  const navigatorObject = {
    userAgent: 'iPhone',
    serviceWorker: { ready: Promise.resolve({ pushManager: {
      getSubscription: async () => null,
      subscribe: async options => { calls.push(['subscribe', options]); return subscription; },
    } }) },
  };
  await subscribeAdminPush(client, navigatorObject);
  assert.deepEqual(calls.map(call => call[0]), ['invoke', 'subscribe', 'upsert']);
  assert.deepEqual([...calls[1][1].applicationServerKey], [...bytes]);
  assert.equal(calls[2][1].user_id, 'admin-1');
});

test('subscription helpers reject non-admin identities and report persistence failures', async () => {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'not-admin', app_metadata: { role: 'customer' } } } }) },
  };
  await assert.rejects(subscribeAdminPush(client, {}), /riservato allo staff/);
  await assert.rejects(savePushSubscription({
    from: () => ({ upsert: async () => ({ error: { message: 'RLS denied' } }) }),
  }, 'admin-1', {
    toJSON: () => ({ endpoint: 'https://push.example/endpoint', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
  }, ''), /RLS denied/);
});

test('unsubscribe removes the owned server record before removing the browser subscription', async () => {
  const calls = [];
  const subscription = { endpoint: 'https://push.example/endpoint', unsubscribe: async () => { calls.push('unsubscribe'); return true; } };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1', app_metadata: { role: 'admin' } } } }) },
    from: () => ({ delete: () => ({ eq: () => ({ eq: async () => { calls.push('delete'); return { error: null }; } }) }) }),
  };
  await unsubscribeAdminPush(client, {
    serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }) },
  });
  assert.deepEqual(calls, ['delete', 'unsubscribe']);
});

test('test push explains when the server has already removed a stale subscription', async () => {
  await assert.rejects(sendTestPush({
    functions: { invoke: async () => ({ error: { context: { status: 410 }, message: 'Gone' } }) },
  }, 'https://push.example/expired'), error => {
    assert.equal(error.name, 'InvalidPushSubscriptionError');
    assert.match(error.message, /Attiva di nuovo/);
    return true;
  });
});
