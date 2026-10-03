import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/admin/[...path].js';

const secret = 'test-only-server-key-'.repeat(3);
const config = { API_PROXY_TARGET: 'https://backend.invalid', AGENDA_BACKEND_SECRET: secret,
  VITE_SUPABASE_URL: 'https://auth.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'public-test-key' };
function response() {
  return { headers: {}, status(value) { this.code = value; return this; }, setHeader(key, value) { this.headers[key] = value; }, json(value) { this.body = value; }, send(value) { this.body = value; } };
}
function request(change = {}) { return { url: '/api/admin/bookings', method: 'GET', headers: { authorization: 'Bearer test-session' }, ...change }; }
async function isolated(run) {
  const keys = [...Object.keys(config), 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  try {
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_PUBLISHABLE_KEY;
    Object.assign(process.env, config);
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
}

test('unauthenticated callers and legacy or unknown routes never reach any service', () => isolated(async () => {
  globalThis.fetch = () => { throw new Error('Unexpected network request'); };
  for (const [req, status] of [[request({ headers: {} }),401], [request({ url:'/api/admin/login', method:'POST' }),404],
    [request({ url:'/api/admin/unknown' }),404], [request({ method:'DELETE' }),404]]) {
    const res = response(); await handler(req,res); assert.equal(res.code,status);
  }
}));

test('missing secret and malformed destinations deny access without network calls', () => isolated(async () => {
  globalThis.fetch = () => { throw new Error('Unexpected network request'); };
  for (const [key,value] of [['AGENDA_BACKEND_SECRET',''], ['AGENDA_BACKEND_SECRET','short'],
    ['API_PROXY_TARGET','http://localhost:8000'], ['API_PROXY_TARGET','https://backend.invalid/path'], ['API_PROXY_TARGET','https://name:pass@backend.invalid']]) {
    Object.assign(process.env,config); process.env[key]=value;
    const res=response(); await handler(request(),res); assert.equal(res.code,503);
  }
}));

test('invalid sessions, auth outages and user_metadata staff cannot reach backend', () => isolated(async () => {
  for (const [authStatus,user,expected] of [[401,{},401],[500,{},503],
    [200,{ id:'customer',user_metadata:{role:'admin'},app_metadata:{} },403],
    [200,{ id:'legacy-staff',app_metadata:{role:'staff'} },403]]) {
    let calls=0;
    globalThis.fetch=async url => { calls++; assert.equal(url.hostname,'auth.invalid'); return Response.json(user,{status:authStatus}); };
    const res=response(); await handler(request(),res); assert.equal(res.code,expected); assert.equal(calls,1);
  }
}));

test('verified admin forwards only server key, bearer and request fields; preserves errors', () => isolated(async () => {
  let calls=0;
  globalThis.fetch=async (url,options) => {
    calls++;
    if (url.hostname==='auth.invalid') {
      assert.equal(options.headers.Authorization,'Bearer test-session');
      assert.equal(options.headers['x-agenda-backend-key'],undefined);
      return Response.json({id:'admin-id',app_metadata:{role:'admin'}});
    }
    assert.equal(url.href,'https://backend.invalid/api/admin/bookings?date=2026-10-03');
    assert.equal(options.headers.authorization,'Bearer test-session');
    assert.equal(options.headers['x-agenda-backend-key'],secret);
    assert.equal(options.headers.cookie,undefined);
    assert.equal(options.body,'{"party_size":2}');
    assert.equal(options.redirect,'error');
    return Response.json({detail:'Disponibilità esaurita'},{status:409});
  };
  const res=response();
  await handler(request({url:'/api/admin/bookings?date=2026-10-03',method:'POST',headers:{authorization:'Bearer test-session',cookie:'ignored','x-agenda-backend-key':'attacker-key','x-admin-request':'1','content-type':'application/json'},body:{party_size:2}}),res);
  assert.equal(calls,2); assert.equal(res.code,409); assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(JSON.parse(res.body.toString()).detail,'Disponibilità esaurita');
  assert.ok(!res.body.toString().includes(secret));
}));
