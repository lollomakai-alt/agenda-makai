import test from 'node:test';
import assert from 'node:assert/strict';
import { dopocenaWhatsAppFallbackAllowed, loadOnlineDopocenaRequests, loadPendingOnlineDopocenaCount, onlineDopocenaWhatsAppUrl, reviewOnlineDopocenaRequest } from '../src/utils/onlineDopocenaRequests.js';

test('loads the private DOPOCENA queue through its admin RPC', async () => {
  const rows=[{request_id:'r1',status:'pending'}];
  const calls=[];
  const result=await loadOnlineDopocenaRequests({rpc:async name=>{calls.push(name);return {data:rows};}}, false);
  assert.deepEqual(result,rows);
  assert.deepEqual(calls,['admin_list_online_dopocena_requests']);
});

test('loads the queue when the email-outcome RPC is a thenable without catch', async () => {
  const rows=[{request_id:'r1',status:'pending'},{request_id:'r2',status:'accepted'}];
  const thenable=value=>({then(resolve){resolve(value);}});
  const client={rpc:name=>name==='admin_list_online_dopocena_requests'
    ? Promise.resolve({data:rows})
    : thenable({data:[{request_id:'r2',status:'accepted'}]})};
  const result=await loadOnlineDopocenaRequests(client);
  assert.deepEqual(result,[
    {request_id:'r1',status:'pending',email_status:'unknown',rejection_reason:''},
    {request_id:'r2',status:'accepted',email_status:'accepted',rejection_reason:''},
  ]);
});

test('loads the queue when the email-outcome RPC fails', async () => {
  const rows=[{request_id:'r1',status:'pending'}];
  const client={rpc:async name=>name==='admin_list_online_dopocena_requests'
    ? {data:rows} : {data:null,error:{message:'non disponibile'}}};
  const result=await loadOnlineDopocenaRequests(client);
  assert.deepEqual(result,[{request_id:'r1',status:'pending',email_status:'unknown',rejection_reason:''}]);
});

test('dedicated DOPOCENA badge counts only requests waiting for staff', async () => {
  const count = await loadPendingOnlineDopocenaCount({rpc:async name=>{
    assert.equal(name,'admin_list_online_dopocena_requests');
    return {data:[{status:'pending'},{status:'accepted'},{status:'pending'},{status:'rejected'}]};
  }});
  assert.equal(count,2);
});

test('accept and reject use the protected server endpoint and validate outcomes', async () => {
  const request={request_id:'r1',status:'pending'};
  const client={auth:{getSession:async()=>({data:{session:{access_token:'jwt'}}})}};
  for (const decision of ['accepted','rejected']) {
    const result = await reviewOnlineDopocenaRequest(client,request,decision,async(url,options)=>{
      assert.equal(url,'/api/admin/bookings/dopocena-requests/r1/decision');
      assert.deepEqual(JSON.parse(options.body),{decision,...(decision==='rejected'?{rejection_reason:'Al completo.'}:{})});
      return Response.json({request_id:'r1',status:decision,booking_id:decision==='accepted'?73:null,email_status:'accepted',rejection_reason:decision==='rejected'?'Al completo.':''});
    },decision==='rejected'?'Al completo.':'');
    assert.equal(result.status,decision);
  }
  await assert.rejects(reviewOnlineDopocenaRequest(client,{...request,status:'accepted'},'rejected'));
  await assert.rejects(reviewOnlineDopocenaRequest(client,request,'pending'));
  await assert.rejects(reviewOnlineDopocenaRequest(client,request,'accepted',async()=>Response.json({request_id:'other'})),/non confermato/);
  await assert.rejects(loadOnlineDopocenaRequests({rpc:async()=>({data:{}})}),/non confermato/);
});

test('WhatsApp is a fallback only when the email did not reach a valid address', () => {
  assert.equal(dopocenaWhatsAppFallbackAllowed('skipped'), true);
  assert.equal(dopocenaWhatsAppFallbackAllowed('failed'), true);
  for (const status of ['queued', 'sending', 'accepted', 'unknown', undefined]) {
    assert.equal(dopocenaWhatsAppFallbackAllowed(status), false);
  }
});

test('prepares confirmation and pirate rejection WhatsApp links for the request phone', () => {
  const request = { name: 'Luca Rossi', phone: '333 1234567', booking_date: '2026-10-15', booking_time: '23:00:00', party_size: 2 };
  const accepted = new URL(onlineDopocenaWhatsAppUrl(request, 'accepted', 73));
  assert.equal(accepted.pathname, '/393331234567');
  assert.match(accepted.searchParams.get('text'), /richiesta DOPOCENA è stata accettata/);
  const rejected = new URL(onlineDopocenaWhatsAppUrl(request, 'rejected'));
  assert.equal(rejected.pathname, '/393331234567');
  const text = rejected.searchParams.get('text');
  assert.match(text, /Ahoy Luca Rossi! 🏴‍☠️/);
  assert.match(text, /15\/10\/2026/);
  assert.match(text, /23:00/);
  assert.match(text, /non possiamo accoglierti/);
  assert.equal(onlineDopocenaWhatsAppUrl({ ...request, phone: 'invalid' }, 'rejected'), null);
  assert.equal(onlineDopocenaWhatsAppUrl(request, 'pending'), null);
});
