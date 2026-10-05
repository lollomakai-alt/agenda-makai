import test from 'node:test';
import assert from 'node:assert/strict';
import { communicationMessage, whatsappCommunicationUrl, prepareCommunication, sendCommunication } from '../src/utils/bookingCommunications.js';
import { sendQueuedEmail } from '../supabase/functions/agenda-communications/send.js';
const snapshot={name:'Mario Rossi',booking_date:'2026-10-15',booking_time:'20:00',party_size:2};
test('communication templates: confirmed, approved update and cancellation; manual WhatsApp encodes contacts safely',()=>{
 for(const kind of ['confirmation','updated','cancelled']) {
  const message=communicationMessage(snapshot,kind);
  assert.match(message.text,/15\/10\/2026/);assert.match(message.text,/20:00/);assert.match(message.text,/Persone: 2/);
  assert.doesNotMatch(message.text,/marketing|Seggiolone/);
 }
 assert.match(communicationMessage(snapshot,'updated').text,/approvata/);
 assert.match(communicationMessage(snapshot,'cancelled').text,/cancellata/);
 const url=whatsappCommunicationUrl({channel:'whatsapp',status:'opened',recipient:'+393331234567',kind:'cancelled',snapshot});
 assert.match(url,/^https:\/\/wa.me\/393331234567\?text=/);assert.match(decodeURIComponent(url),/cancellata/);
 assert.throws(()=>whatsappCommunicationUrl({channel:'whatsapp',status:'accepted'}));
 assert.throws(()=>communicationMessage(snapshot,'arbitrary'));
});
test('communications use only session-authenticated gateway routes and validate outcomes',async()=>{
 const { loadCommunications, emailSendBlocked } = await import('../src/utils/bookingCommunications.js');
 const calls=[];
 const client={auth:{getSession:async()=>({data:{session:{access_token:'session-token'}}})},
  from:()=>assert.fail('No direct table access'),rpc:()=>assert.fail('No browser RPC'),functions:{invoke:()=>assert.fail('No browser Edge')}};
 let payload={communication:{booking_id:42,channel:'whatsapp',status:'opened'}};
 let status=200;
 const request=async(url,options)=>{calls.push({url,options});return Response.json(payload,{status});};
 assert.equal((await prepareCommunication(client,42,'whatsapp',request)).status,'opened');
 assert.equal(calls[0].url,'/api/admin/bookings/42/communications/prepare');
 assert.equal(calls[0].options.headers.Authorization,'Bearer session-token');
 assert.equal(calls[0].options.headers['x-admin-request'],'1');
 assert.deepEqual(JSON.parse(calls[0].options.body),{channel:'whatsapp'});
 payload={communications:[{id:7,booking_id:42}]};
 assert.equal((await loadCommunications(client,42,request)).length,1);
 assert.equal(calls.at(-1).options.method,'GET');
 payload={bookingId:42,communicationId:7,type:'booking_confirmation',status:'accepted'};
 assert.equal((await sendCommunication(client,42,request)).status,'accepted');
 assert.equal(calls.at(-1).url,'/api/admin/bookings/42/send-confirmation-email');
 assert.deepEqual(JSON.parse(calls.at(-1).options.body),{});
 for(const outcome of ['failed','unknown']){status=502;payload.status=outcome;assert.equal((await sendCommunication(client,42,request)).status,outcome);}
 status=409;payload={detail:'Comunicazione già gestita'};
 await assert.rejects(sendCommunication(client,42,request),/già gestita/);
 status=200;payload={communication:{booking_id:43,channel:'email'}};
 await assert.rejects(prepareCommunication(client,42,'email',request),/non confermata/);
 payload={communications:[{booking_id:43}]};await assert.rejects(loadCommunications(client,42,request),/non confermate/);
 payload={bookingId:43,communicationId:7,type:'booking_confirmation',status:'accepted'};
 await assert.rejects(sendCommunication(client,42,request),/Esito non confermato/);
 await assert.rejects(sendCommunication({auth:{getSession:async()=>({data:{session:null}})}},42,()=>assert.fail('No anonymous fetch')),/Accedi/);
 const booking={...snapshot,email:'a@example.com',tables:''};
 const row={channel:'email',kind:'confirmation',recipient:booking.email,snapshot:booking,created_at:new Date().toISOString()};
 for(const state of ['accepted','unknown','sending']) assert.equal(emailSendBlocked(booking,[{...row,status:state}]),true);
 assert.equal(emailSendBlocked(booking,[{...row,status:'failed'}]),false);
 assert.equal(emailSendBlocked(booking,[{...row,status:'failed',created_at:'2020-01-01'}]),true);
 assert.equal(emailSendBlocked({...booking,booking_time:'21:00'},[{...row,status:'accepted'}]),false);
 assert.equal(emailSendBlocked({...booking,booking_time:'21:00'},[{...row,status:'sending'}]),true);
});
test('legacy email sender cannot claim, send or log through frontend calls', async () => {
 const client = { rpc: () => assert.fail('No legacy RPC calls') };
 await assert.rejects(sendQueuedEmail(client, 7, {apiKey:'private',from:'staff@example.com'},
   () => assert.fail('No legacy provider calls')), /Invio disabilitato/);
});
