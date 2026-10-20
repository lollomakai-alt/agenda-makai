import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sendDecisionEmail } from '../supabase/functions/send-booking-email/dopocena.js';
import { reviewOnlineDopocenaRequest, dopocenaEmailLabel } from '../src/utils/onlineDopocenaRequests.js';
const rid='11111111-1111-4111-8111-111111111111';
const managementUrl = `https://www.makaipigneto.it/prenotazioni/gestisci#token=${'a'.repeat(43)}`;
const row = decision => ({request_id:rid,decision,status:'sending',attempted_at:new Date().toISOString(),recipient:'test@example.com',booking_id:decision==='accepted'?7:null,
 snapshot:{name:'Ada',booking_date:'2026-10-25',booking_time:'23:00',party_size:2,tables:'',booking_type:'dopocena',status:decision,...(decision==='accepted'?{management_url:managementUrl}:{rejection_reason:'Siamo al completo.'})}});
const client = record => ({rpc:async()=>({data:record})});
test('server transport uses distinct acceptance/refusal templates, including no linked booking', async()=>{
 for (const decision of ['accepted','rejected']) {
  let sent=0;
  const response=await sendDecisionEmail(client(row(decision)),rid,'test-secret',async(url,options)=>{
   sent++; assert.equal(url,'https://api.resend.com/emails');
   assert.equal(options.headers['Idempotency-Key'],`dopocena-decision-${rid}`);
   const payload=JSON.parse(options.body);
   assert.deepEqual(payload.to,['test@example.com']);
   assert.match(payload.text,decision==='accepted'?/richiesta DOPOCENA è stata accettata/:/non possiamo accoglierti/);
   assert.doesNotMatch(payload.text,/tavol|assegnazion/i);
   if (decision === 'accepted') {
    assert.ok(payload.text.includes(managementUrl));
    assert.match(payload.text,/Gestisci o riconferma la prenotazione/);
   }
   if (decision === 'rejected') {
    assert.match(payload.text,/Motivazione: Siamo al completo\./);
    assert.ok(payload.text.includes('https://www.makaipigneto.it/prenotazioni'));
    assert.doesNotMatch(payload.text,/Gestisci o riconferma|gestisci#token/i);
   }
   return Response.json({id:'provider-id'});
  });
  assert.equal(response.status,'accepted');assert.equal(sent,1);
 }
});
test('failed, ambiguous, invalid and expired attempts never report success',async()=>{
 for(const [status,expected] of [[422,'failed'],[429,'failed'],[500,'unknown'],[409,'unknown']]) {
  assert.equal((await sendDecisionEmail(client(row('rejected')),rid,'key',async()=>Response.json({}, {status}))).status,expected);
 }
 assert.equal((await sendDecisionEmail(client(row('accepted')),rid,'key',async()=>{throw Error('network');})).status,'unknown');
 assert.equal((await sendDecisionEmail(client(row('accepted')),rid,'key',async()=>Response.json({}))).status,'unknown');
 for(const record of [{...row('accepted'),status:'accepted'}, {...row('rejected'),attempted_at:'2020-01-01'}, {...row('rejected'),recipient:'bad'}]) {
  let sends=0;await sendDecisionEmail(client(record),rid,'key',async()=>{sends++;});assert.equal(sends,0);
 }
});
test('client keeps saved decision on failed email and displays only confirmed provider outcomes',async()=>{
 const auth={getSession:async()=>({data:{session:{access_token:'admin-jwt'}}})};
 const result=await reviewOnlineDopocenaRequest({auth},{request_id:rid,status:'pending'},'rejected',async(url,options)=>{
  assert.equal(url,`/api/admin/bookings/dopocena-requests/${rid}/decision`);
  assert.deepEqual(JSON.parse(options.body),{decision:'rejected',rejection_reason:'Siamo al completo.'});
  return Response.json({request_id:rid,status:'rejected',booking_id:null,email_status:'failed',rejection_reason:'Siamo al completo.'});
 },'Siamo al completo.');
 assert.equal(result.status,'rejected');assert.match(dopocenaEmailLabel(result.email_status),/fallito/);
 assert.match(dopocenaEmailLabel('accepted'),/consegna non verificata/);
 assert.match(dopocenaEmailLabel('unexpected'),/non confermato/);
});
test('decision component never opens or navigates a window automatically',async()=>{
 const source=await readFile(new URL('../src/components/OnlineDopocenaRequests.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/window\.open|\.location\s*[.=]|about:blank/);
 assert.match(source,/Apri WhatsApp \(facoltativo\)/);
 assert.match(source,/target="_blank" rel="noopener noreferrer"/);
});

test('acceptance without a valid stored personal link cannot be sent',async()=>{
 for (const management_url of [undefined,'javascript:alert(1)','https://www.makaipigneto.it/prenotazioni']) {
  const record=row('accepted'); record.snapshot.management_url=management_url;
  let sends=0;
  const result=await sendDecisionEmail(client(record),rid,'key',async()=>{sends++;});
  assert.equal(result.status,'failed');assert.equal(sends,0);
 }
});

test('refusal without a reason is blocked before client transport and before Resend',async()=>{
 const record=row('rejected');delete record.snapshot.rejection_reason;
 let sends=0;
 assert.equal((await sendDecisionEmail(client(record),rid,'key',async()=>{sends++;})).status,'failed');
 for(const reason of ['', ' ', 'x'.repeat(501)]) {
  await assert.rejects(reviewOnlineDopocenaRequest({}, {request_id:rid,status:'pending'}, 'rejected', async()=>{sends++;}, reason),/motivazione/);
 }
 assert.equal(sends,0);
});
