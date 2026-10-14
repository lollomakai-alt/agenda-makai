import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOnlineDopocenaRequests, reviewOnlineDopocenaRequest } from '../src/utils/onlineDopocenaRequests.js';

test('loads the private DOPOCENA queue through its admin RPC', async () => {
  const rows=[{request_id:'r1',status:'pending'}];
  const calls=[];
  const result=await loadOnlineDopocenaRequests({rpc:async name=>{calls.push(name);return {data:rows};}});
  assert.deepEqual(result,rows);
  assert.deepEqual(calls,['admin_list_online_dopocena_requests']);
});

test('accept and reject use the admin review RPC with the exact request ID', async () => {
  const request={request_id:'r1',status:'pending'};
  const calls=[];
  const client={rpc:async(name,args)=>{
    calls.push([name,args]);
    return {data:{request_id:args.p_request_id,status:args.p_decision,...(args.p_decision==='accepted'?{booking_id:73}:{})}};
  }};
  await reviewOnlineDopocenaRequest(client,request,'accepted');
  await reviewOnlineDopocenaRequest(client,request,'rejected');
  assert.deepEqual(calls,[
    ['admin_review_online_dopocena_request',{p_request_id:'r1',p_decision:'accepted'}],
    ['admin_review_online_dopocena_request',{p_request_id:'r1',p_decision:'rejected'}],
  ]);
  await assert.rejects(reviewOnlineDopocenaRequest(client,{...request,status:'accepted'},'rejected'));
  await assert.rejects(reviewOnlineDopocenaRequest(client,request,'pending'));
});

test('rejects unconfirmed admin outcomes and reports a missing live SQL contract', async () => {
  await assert.rejects(reviewOnlineDopocenaRequest({rpc:async()=>({data:{request_id:'other',status:'accepted',booking_id:73}})},
    {request_id:'r1',status:'pending'},'accepted'),/non confermato/);
  await assert.rejects(reviewOnlineDopocenaRequest({rpc:async()=>({error:{code:'PGRST202'}})},
    {request_id:'r1',status:'pending'},'rejected'),/non configurata/);
  await assert.rejects(loadOnlineDopocenaRequests({rpc:async()=>({data:{}})}),/non confermato/);
});
