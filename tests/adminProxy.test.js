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

test('communication routes forward only through the authenticated gateway', () => isolated(async () => {
  for (const [method,path] of [['GET','communications'], ['POST','communications/prepare'], ['POST','send-confirmation-email']]) {
    let calls = 0;
    globalThis.fetch = async (url,options) => {
      calls++;
      if (url.hostname === 'auth.invalid') return Response.json({ id:'admin', app_metadata:{ role:'admin' } });
      assert.equal(url.pathname, `/api/admin/bookings/42/${path}`);
      assert.equal(options.method, method);
      assert.equal(options.headers.origin, 'https://agenda-makai.vercel.app');
      assert.equal(options.headers['x-admin-request'], '1');
      assert.equal(options.headers['x-agenda-backend-key'], secret);
      return Response.json({ ok:true });
    };
    const res = response();
    await handler(request({url:`/api/admin/bookings/42/${path}`,method,
      headers:{authorization:'Bearer test-session',origin:'https://agenda-makai.vercel.app','x-admin-request':'1'}}),res);
    assert.equal(res.code,200); assert.equal(calls,2);
  }
}));

test('communication route allowlist rejects invalid ids, paths and methods', () => isolated(async () => {
  globalThis.fetch = () => { throw new Error('Unexpected network request'); };
  for (const [method,path] of [['POST','0/send-confirmation-email'],['POST','42/communications'],
    ['GET','42/send-confirmation-email'],['GET','42/communications/prepare'],['POST','42/send-email'],['DELETE','42/communications']]) {
    const res=response(); await handler(request({method,url:`/api/admin/bookings/${path}`}),res);
    assert.equal(res.code,404);
  }
}));


test('rewritten nested communication routes retain allowlist, auth and original query', () => isolated(async () => {
  let calls=0;
  globalThis.fetch=async (url,options)=>{
    calls++;
    if(url.hostname==='auth.invalid') return Response.json({id:'admin',app_metadata:{role:'admin'}});
    assert.equal(url.pathname,'/api/admin/bookings/42/communications');
    assert.equal(url.search,'?limit=5');
    assert.equal(options.headers['x-agenda-backend-key'],secret);
    return Response.json({communications:[]});
  };
  const res=response();await handler(request({url:'/api/agenda-gateway?__agenda_route=bookings/42/communications&limit=5'}),res);
  assert.equal(res.code,200);assert.equal(calls,2);
  for(const route of ['unknown','bookings/0/communications','../bookings','bookings/42/communications?x=1']){
    const res=response();await handler(request({url:'/api/agenda-gateway',query:{__agenda_route:route}}),res);assert.equal(res.code,404);
  }
  const denied=response();await handler(request({url:'/api/agenda-gateway',query:{__agenda_route:'bookings/42/communications'},headers:{}}),denied);
  assert.equal(denied.code,401);
}));
