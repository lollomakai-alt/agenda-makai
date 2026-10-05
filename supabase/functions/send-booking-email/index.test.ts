import { handler } from './index.ts';
import { handler as legacyHandler } from '../agenda-communications/index.ts';

Deno.test('claimed email transport: server auth, immutable content and provider outcomes', async t => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const diagnosticMessages: string[] = [];
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'];
  const originalEnv = keys.map(key => Deno.env.get(key));
  const assert = (value: unknown, message = 'Assertion failed') => { if (!value) throw new Error(message); };
  const snapshot = { name: 'Ada <script>', booking_date: '2026-10-10', booking_time: '20:00', party_size: 2, tables: '12' };
  let booking: Record<string, unknown> | null;
  let row: Record<string, unknown> | null;
  let sends = 0, dbReads = 0, providerStatus = 200, malformedProvider = false, networkFail = false, databaseFail = false;
  let credentialProbes = 0, probeStatus = 401;
  let payload: Record<string, unknown> = {};
  const reset = () => {
    booking = { id: 7, ...snapshot, email: 'ada@example.com', status: 'confirmed' };
    row = { id: 21, booking_id: 7, channel: 'email', kind: 'confirmation', status: 'sending',
      recipient: 'ada@example.com', snapshot: { ...snapshot }, attempted_at: new Date().toISOString() };
    sends = dbReads = 0; providerStatus = 200; malformedProvider = networkFail = databaseFail = false;
  };
  const valid = { bookingId: 7, type: 'booking_confirmation', communicationId: 21 };
  const call = (body: unknown = valid, options: { method?: string; token?: string; raw?: string } = {}) => handler(new Request('https://example.com', {
    method: options.method || 'POST', headers: { 'Content-Type': 'application/json',
      ...(options.token === '' ? {} : { Authorization: `Bearer ${options.token || 'test-service-secret'}` }) },
    ...(options.method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(body) }),
  }));
  const result = async () => (await call()).json();
  try {
    console.warn = (...messages: unknown[]) => { diagnosticMessages.push(messages.join(' ')); };
    Deno.env.set(keys[0], 'https://example.supabase.co');
    Deno.env.set(keys[1], 'test-service-secret');
    Deno.env.set(keys[2], 'test-resend-secret');
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      assert(!url.includes('/auth/v1/user') && !url.includes('/rpc/'), 'Edge must never authenticate user JWT or claim/finish');
      if (url.includes('/booking_communications?select=id&limit=0')) {
        credentialProbes++;
        const headers = new Headers(init?.headers);
        assert(headers.get('Authorization') === `Bearer ${headers.get('apikey')}`);
        assert(init?.redirect === 'error');
        return Response.json(probeStatus === 200 ? [] : { message: 'rejected' }, { status: probeStatus });
      }
      if (url.includes('/rest/v1/')) {
        dbReads++;
        assert(new Headers(init?.headers).get('Authorization') === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`);
        assert(new Headers(init?.headers).get('apikey') === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
        if (url.includes('/booking_communications')) {
          assert(url.includes('id=eq.21') && url.includes('booking_id=eq.7'));
          return Response.json(databaseFail ? { message: 'test-service-secret' } : row, { status: databaseFail ? 400 : 200 });
        }
        assert(url.includes('/bookings') && url.includes('id=eq.7'));
        return Response.json(booking);
      }
      assert(url === 'https://api.resend.com/emails');
      sends++;
      payload = JSON.parse(String(init?.body));
      assert(new Headers(init?.headers).get('Idempotency-Key') === 'agenda-email-21');
      assert(new Headers(init?.headers).get('Authorization') === 'Bearer test-resend-secret');
      if (networkFail) throw new Error('test-resend-secret');
      if (malformedProvider) return new Response('bad json', { status: providerStatus });
      return Response.json(providerStatus === 200 ? { id: 'email-id' } : { message: 'test-resend-secret' }, { status: providerStatus });
    };
    await t.step('service-only auth, method and strict payload; old frontend payload refused', async () => {
      reset();
      assert((await call(valid, { method: 'OPTIONS', token: '' })).status === 204);
      assert((await call(valid, { method: 'GET' })).status === 405);
      for (const token of ['', 'admin-session-jwt', 'staff-session-jwt', 'publishable-key']) {
        const response = await call(valid, { token }); assert(response.status === 401);
        assert(!(await response.text()).includes('test-service-secret'));
      }
      for (const body of [null, [], { bookingId: 7, type: 'booking_confirmation' },
        { ...valid, communicationId: 0 }, { ...valid, communicationId: '21' }, { ...valid, bookingId: -1 },
        { ...valid, type: 'other' }, { ...valid, to: 'attacker@example.com' }, { ...valid, subject: 'custom' }, { ...valid, html: '<b>custom</b>' }]) {
        assert((await call(body)).status === 400);
      }
      assert((await call(valid, { raw: '{' })).status === 400);
      assert((await call(valid, { raw: 'x'.repeat(1025) })).status === 413);
      assert(dbReads === 0 && sends === 0);
    });
    await t.step('claimed confirmation uses stored recipient, template and communication idempotency key', async () => {
      reset();
      const body = await result();
      assert(body.status === 'accepted' && body.emailId === 'email-id' && body.communicationId === 21 && sends === 1);
      assert(payload.from === 'Makai Pigneto <prenotazioni@makaipigneto.it>');
      assert(JSON.stringify(payload.to) === '["ada@example.com"]');
      assert(!Object.hasOwn(payload, 'html') && String(payload.text).includes('Ada <script>'));
      assert(!JSON.stringify(body).includes('test-service-secret') && !JSON.stringify(body).includes('test-resend-secret'));
    });
    await t.step('credential diagnostics never expose keys or authorize forged service claims', async () => {
      reset(); diagnosticMessages.length = 0; credentialProbes = 0; probeStatus = 401;
      const forged = `${btoa('{}')}.${btoa(JSON.stringify({ role: 'service_role', ref: 'example', secret: 'do-not-log' }))}.fake-signature`;
      const response = await call(valid, { token: forged });
      assert(response.status === 401 && sends === 0 && dbReads === 0);
      assert(credentialProbes === 1);
      const diagnostic = JSON.parse(diagnosticMessages[0]);
      assert(diagnostic.event === 'booking_email_credential_mismatch');
      assert(diagnostic.supplied.serviceRole === true && diagnostic.supplied.projectMatches === true);
      assert(!diagnosticMessages.join('').includes(forged));
      assert(!diagnosticMessages.join('').includes('do-not-log'));
      assert(!diagnosticMessages.join('').includes('test-service-secret'));
    });
    await t.step('legacy service key with injected secret key requires Supabase verification; empty body cannot send', async () => {
      reset(); credentialProbes = 0; probeStatus = 200;
      Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_injected');
      try {
        const jwt = (claims: Record<string, unknown>) => `${btoa('{}')}.${btoa(JSON.stringify(claims))}.signature`;
        for (const claims of [{ role: 'anon', ref: 'example' }, { role: 'authenticated', ref: 'example' },
          { role: 'service_role', ref: 'other-project' }]) {
          assert((await call({}, { token: jwt(claims) })).status === 401);
        }
        assert(credentialProbes === 0);
        const token = jwt({ role: 'service_role', ref: 'example' });
        assert((await call({}, { token })).status === 400 && credentialProbes === 1);
        const accepted = await (await call(valid, { token })).json();
        assert(accepted.status === 'accepted' && sends === 1 && dbReads === 2);
        reset();
        probeStatus = 401;
        assert((await call({}, { token })).status === 401);
        assert(sends === 0 && dbReads === 0);
      } finally { Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-secret'); probeStatus = 401; }
    });
    await t.step('latest updated communication uses updated template with the same flow', async () => {
      reset(); row!.kind = 'updated';
      assert((await result()).status === 'accepted');
      assert(String(payload.subject).includes('modificata'));
    });
    await t.step('missing or unclaimed communication and database error never send', async () => {
      for (const status of ['queued', 'accepted', 'failed', 'unknown', 'superseded']) {
        reset(); row!.status = status; assert((await result()).status === 'failed' && sends === 0);
      }
      reset(); row = null; assert((await result()).status === 'failed' && sends === 0);
      reset(); databaseFail = true; assert((await result()).status === 'failed' && sends === 0);
      reset(); row!.kind = 'cancelled'; assert((await result()).status === 'failed' && sends === 0);
    });
    await t.step('booking state, snapshot and email rechecked after claim', async () => {
      for (const status of ['arrived', 'completed', 'no_show', 'cancelled']) {
        reset(); booking!.status = status; assert((await result()).errorCode === 'stale_booking' && sends === 0);
      }
      reset(); booking = null; assert((await result()).status === 'failed' && sends === 0);
      reset(); booking!.booking_time = '20:30'; assert((await result()).errorCode === 'stale_booking' && sends === 0);
      reset(); booking!.email = 'other@example.com'; assert((await result()).errorCode === 'stale_booking' && sends === 0);
      reset(); booking!.email = ''; row!.recipient = ''; assert((await result()).errorCode === 'invalid_email' && sends === 0);
    });
    await t.step('stuck attempt cannot replay beyond provider idempotency window', async () => {
      reset(); row!.attempted_at = new Date(Date.now() - 24 * 3600000).toISOString();
      assert((await result()).status === 'unknown' && sends === 0);
      reset(); row!.attempted_at = null; assert((await result()).status === 'unknown' && sends === 0);
    });
    await t.step('explicit provider rejection failed; 408/409/5xx or lost response unknown', async () => {
      for (const [http, expected] of [[422, 'failed'], [429, 'failed'], [408, 'unknown'], [409, 'unknown'], [500, 'unknown']]) {
        reset(); providerStatus = Number(http);
        const response = await result();
        assert(response.status === expected && sends === 1);
        assert(!JSON.stringify(response).includes('test-resend-secret'));
      }
      reset(); networkFail = true; assert((await result()).status === 'unknown' && sends === 1);
      reset(); malformedProvider = true; assert((await result()).status === 'unknown' && sends === 1);
    });
    await t.step('missing provider configuration fails before transport', async () => {
      reset(); Deno.env.delete('RESEND_API_KEY');
      assert((await result()).errorCode === 'email_not_configured' && sends === 0);
    });
    await t.step('legacy endpoint disabled without database, provider or RPC access', async () => {
      reset();
      assert(legacyHandler(new Request('https://example.com', { method: 'POST' })).status === 410);
      assert(dbReads === 0 && sends === 0);
    });
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => originalEnv[index] === undefined ? Deno.env.delete(key) : Deno.env.set(key, originalEnv[index]!));
  }
});
