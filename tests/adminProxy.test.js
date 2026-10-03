import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/admin/[...path].js';

function response() {
  return { headers: {}, status(value) { this.code = value; return this; }, setHeader(key, value) { this.headers[key] = value; }, json(value) { this.body = value; }, send(value) { this.body = value; } };
}

test('proxy requires an HTTPS backend and does not call it when unconfigured', async () => {
  const previous = process.env.API_PROXY_TARGET;
  try {
    for (const value of ['', 'http://localhost:8000', 'https://user:password@backend.invalid', 'https://backend.invalid/path']) {
      process.env.API_PROXY_TARGET = value;
      const res = response();
      await handler({ url: '/api/admin/bookings', method: 'GET', headers: {} }, res);
      assert.equal(res.code, 503);
    }
  } finally { if (previous === undefined) delete process.env.API_PROXY_TARGET; else process.env.API_PROXY_TARGET = previous; }
});

test('proxy forwards bearer, request fields and query; preserves backend errors', async () => {
  const previous = process.env.API_PROXY_TARGET;
  const previousFetch = globalThis.fetch;
  try {
    process.env.API_PROXY_TARGET = 'https://backend.invalid';
    globalThis.fetch = async (url, options) => {
      assert.equal(url.href, 'https://backend.invalid/api/admin/bookings?date=2026-10-03');
      assert.equal(options.headers.authorization, 'Bearer test-session');
      assert.equal(options.headers.cookie, undefined);
      assert.equal(options.headers['x-admin-request'], '1');
      assert.equal(options.body, '{"party_size":2}');
      return new Response('{"detail":"Disponibilità esaurita"}', { status: 409, headers: { 'Content-Type': 'application/json' } });
    };
    const res = response();
    await handler({ url: '/api/admin/bookings?date=2026-10-03', method: 'POST', headers: { authorization: 'Bearer test-session', cookie: 'ignored', 'x-admin-request': '1', 'content-type': 'application/json' }, body: { party_size: 2 } }, res);
    assert.equal(res.code, 409);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(JSON.parse(res.body.toString()).detail, 'Disponibilità esaurita');
  } finally { globalThis.fetch = previousFetch; if (previous === undefined) delete process.env.API_PROXY_TARGET; else process.env.API_PROXY_TARGET = previous; }
});
