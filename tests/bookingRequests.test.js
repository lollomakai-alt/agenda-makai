import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookingRequest, reviewBookingRequest, loadBookingRequests, requestValue } from '../src/utils/bookingRequests.js';
import { historyChanges } from '../src/utils/bookingHistory.js';

test('five request types validate values before writing; no unrelated field accepted', () => {
  assert.equal(requestValue('data','2026-10-10'), '2026-10-10');
  assert.equal(requestValue('ora','21:30'), '21:30');
  assert.equal(requestValue('persone','6'), 6);
  assert.equal(requestValue('note',''), '');
  assert.equal(requestValue('cancellazione','ignored'), null);
  for (const [type,value] of [['tables','12'],['data','2026-02-30'],['data','x'],['ora','24:00'],['persone','0'],['persone','7'],['persone','2.5'],['persone',''],['note','x'.repeat(301)]]) assert.throws(() => requestValue(type,value));
});

test('creating a request calls only request RPC, never edits booking', async () => {
  const calls = [];
  const client = { rpc: async (name,args) => { calls.push([name,args]); return { data: { id: 9, booking_id: 42, status: 'pending' } }; } };
  await createBookingRequest(client,42,'persone','3');
  assert.deepEqual(calls, [['admin_create_booking_request',{ booking_id:42,request_type:'persone',requested_value:3 }]]);
  await createBookingRequest(client,42,'cancellazione','');
  assert.equal(calls[1][1].requested_value, null);
});

test('review sends decision to atomic database RPC; duplicate and invalid decisions rejected', async () => {
  const request = { id: 9, status: 'pending' };
  const calls = [];
  const client = { rpc: async (name,args) => { calls.push([name,args]); return { data:{ id:9,status:args.decision } }; } };
  for (const decision of ['approved','rejected']) await reviewBookingRequest(client,request,decision);
  assert.deepEqual(calls.map(x => x[0]), ['admin_review_booking_request','admin_review_booking_request']);
  assert.deepEqual(calls[0][1], { request_id:9,decision:'approved' });
  await assert.rejects(reviewBookingRequest(client,{...request,status:'approved'},'rejected'));
  await assert.rejects(reviewBookingRequest(client,request,'pending'));
});

test('errors and unconfirmed responses are surfaced', async () => {
  await assert.rejects(createBookingRequest({rpc:async()=>({error:{code:'PGRST202'}})},42,'note','x'), /booking-requests.sql/);
  await assert.rejects(createBookingRequest({rpc:async()=>({data:{id:9,booking_id:43,status:'pending'}})},42,'note','x'), /non confermata/);
  await assert.rejects(reviewBookingRequest({rpc:async()=>({error:{message:'Prenotazione cambiata'}})},{id:9,status:'pending'},'approved'), /cambiata/);
  await assert.rejects(reviewBookingRequest({rpc:async()=>({data:{id:8,status:'approved'}})},{id:9,status:'pending'},'approved'), /non confermata/);
  const chain = {select(){return this;},order(){return this;},then(resolve){return Promise.resolve({error:{code:'42P01'}}).then(resolve);}};
  await assert.rejects(loadBookingRequests({from:()=>chain}), /booking-requests.sql/);
});

test('history displays lifecycle including requested value and rejection without booking changes', () => {
  for (const status of ['pending','approved','rejected']) {
    const changes = historyChanges({action:'customer_request_created',new_data:{request_id:9,request_type:'persone',requested_value:3,request_status:status}});
    assert.equal(changes[0], 'Richiesta #9: Persone → 3');
    assert.equal(changes.length,2);
  }
});
