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
test('frontend communications check RPC identity and function outcome; errors never imply sent',async()=>{
 const client={rpc:async()=>({data:{booking_id:42,channel:'whatsapp',status:'opened'}}),functions:{invoke:async()=>({data:{id:3,status:'accepted'}})}};
 assert.equal((await prepareCommunication(client,42,'whatsapp')).status,'opened');
 assert.equal((await sendCommunication(client,3)).status,'accepted');
 await assert.rejects(prepareCommunication(client,43,'email'),/non confermata/);
 client.functions.invoke=async()=>({data:{id:3,status:'delivered'}});
 await assert.rejects(sendCommunication(client,3),/non confermato/);
 client.functions.invoke=async()=>({error:{message:'secret'}});
 await assert.rejects(sendCommunication(client,3),/Aggiorna il log/);
});
function setup() {
 const calls=[]; const client={rpc:async(name,args)=>{calls.push([name,args]);return name==='claim_booking_email'?{data:{id:7,recipient:'customer@example.com',snapshot,kind:'updated'}}:{};}};
 return {client,calls};
}
test('email sender requires config before claim, sends server template and idempotency key, logs provider acceptance',async()=>{
 const {client,calls}=setup();await assert.rejects(sendQueuedEmail(client,7,{}),/non configurate/);assert.equal(calls.length,0);
 const result=await sendQueuedEmail(client,7,{apiKey:'private',from:'Makai <staff@example.com>'},async(url,options)=>{
  assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'agenda-email-7');
  const body=JSON.parse(options.body);assert.deepEqual(body.to,['customer@example.com']);assert.match(body.text,/approvata/);
  return new Response(JSON.stringify({id:'provider123'}),{status:200});
 });
 assert.equal(result.status,'accepted');assert.equal(calls[1][1].p_provider_id,'provider123');
});
test('email failures: rejected, uncertain network/5xx, concurrent claims and failed result log',async()=>{
 for(const [fetcher,status] of [[async()=>new Response('{}',{status:422}),'failed'],[async()=>new Response('{}',{status:500}),'unknown'],[async()=>{throw new Error('network');},'unknown']]){
  const {client,calls}=setup();assert.equal((await sendQueuedEmail(client,7,{apiKey:'x',from:'staff@example.com'},fetcher)).status,status);
  assert.equal(calls.at(-1)[1].p_status,status);
 }
 const config={apiKey:'x',from:'staff@example.com'};
 await assert.rejects(sendQueuedEmail({rpc:async()=>({data:null})},7,config,()=>assert.fail('must not send')),/già gestita/);
 await assert.rejects(sendQueuedEmail({rpc:async name=>name==='claim_booking_email'?{data:{id:7,recipient:'c@example.com',snapshot,kind:'confirmation'}}:{error:{}}},7,config,async()=>new Response('{"id":"ok"}')),/non registrato/);
});
