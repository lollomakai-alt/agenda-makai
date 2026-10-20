import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bookingDatabase } from './helpers/bookingDatabase.js';

test('targeted staff email migration installs the missing private function', async () => {
 const db=await bookingDatabase();
 try {
  await db.exec('drop function private.prepare_staff_email(bigint,text,text,text,text)');
  assert.equal((await db.query("select to_regprocedure('private.prepare_staff_email(bigint,text,text,text,text)') as fn")).rows[0].fn,null);
  await db.exec(await readFile(new URL('../supabase/migrations/20261019132636_prepare_staff_reconfirmation.sql',import.meta.url),'utf8'));
  assert.ok((await db.query("select to_regprocedure('private.prepare_staff_email(bigint,text,text,text,text)') as fn")).rows[0].fn);
 } finally { await db.close(); }
});

test('complete system SQL: physical dinner, midnight, independent quota, explicit release and protected arrival',async()=>{
 const db=await bookingDatabase();
 try {
 const day=(await db.query(`select to_char(d,'YYYY-MM-DD') as booking_day from generate_series((now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d where extract(isodow from d)<>1 limit 1`)).rows[0].booking_day;
 let phone=0;
 const insert=async(people,time='20:00',type='normale',source='booking',tables='')=>(await db.query(`insert into bookings(name,phone,email,booking_date,booking_time,party_size,tables,source,booking_type,privacy_accepted_at,privacy_version) values('Cliente Makai',$1,'',$2,$3,$4,$5,$6,$7,now(),'2026-10-12-online-v2') returning *`,[`+39333123${String(phone++).padStart(4,'0')}`,day,time,people,tables,source,type])).rows[0];
 assert.equal((await db.query('select private.dinner_physical_capacity() capacity')).rows[0].capacity,26);
 assert.equal((await db.query("select capacity from private.online_table_groups() where group_id='13+14'")).rows[0].capacity,3);
 assert.ok((await db.query("select 1 from private.online_table_candidates(4) where group_id='22+23'")).rows.length);
 assert.ok((await db.query('select group_id from private.online_table_candidates(4)')).rows.some(row=>row.group_id==='22+23'));
 const dinner=await insert(3);assert.equal(dinner.tables,'10+11');
 for(const people of [1,2,4,5]) {const row=await insert(people);assert.equal((await db.query('select capacity from private.online_table_groups() where group_id=$1',[row.tables])).rows[0].capacity,people===1?2:people===5?6:people);}
 assert.equal((await db.query("select private.online_slot_status($1,'00:00',6,'dopocena') status",[day])).rows[0].status,'available');
 assert.equal((await db.query("select private.valid_service_slot('dopocena','22:47') valid")).rows[0].valid,true);
 assert.equal((await db.query("select private.online_slot_status($1,'22:47',3,'dopocena') status",[day])).rows[0].status,'available');
 const midnight=await insert(6,'00:00','dopocena');assert.equal(midnight.tables,'');
 assert.equal((await db.query("select (private.booking_scheduled_at($1,'00:00') at time zone 'Europe/Rome')::date=$1::date+1 ok",[day])).rows[0].ok,true);
 await assert.rejects(db.query("update bookings set status='arrived' where id=$1",[midnight.id]),/Arrivo DOPOCENA/);
 for(let i=0;i<3;i++) await insert(6,'22:30','dopocena');
 await assert.rejects(insert(2,'22:30','dopocena'),/25 persone/);
 assert.equal((await db.query("select private.online_slot_status($1,'20:00',1,'normale') status",[day])).rows[0].status,'available');
 await db.exec('delete from bookings;delete from booking_history;');
 const late=await insert(2,'23:30','dopocena');const minute=await insert(3,'22:47','dopocena');const early=await insert(2,'22:30','dopocena');const occupied=await insert(2,'20:30','normale','agenda','12');
 assert.equal(minute.booking_time,'22:47');
 await db.query("update bookings set status='arrived' where id=$1",[occupied.id]);
 await assert.rejects(db.query("update bookings set status='cancelled' where id=$1",[occupied.id]),/Tavolo ancora occupato/);
 await db.query("update bookings set status='completed' where id=$1",[occupied.id]);
 assert.equal((await db.query('select tables from bookings where id=$1',[early.id])).rows[0].tables,'');
 const released=(await db.query('select public.admin_release_booking_table($1) r',[occupied.id])).rows[0].r;
 assert.equal(released.tables,'');
 assert.equal((await db.query('select tables from bookings where id=$1',[early.id])).rows[0].tables,'12');
 assert.equal((await db.query('select tables from bookings where id=$1',[late.id])).rows[0].tables,'');
 assert.equal((await db.query("select private.dinner_after_dinner_compatible($1,'20:30','normale',$1,'22:30','dopocena') ok",[day])).rows[0].ok,true);
 await assert.rejects(insert(2,'18:00'),/non validi/);
 await assert.rejects(db.query(`insert into bookings(name,phone,email,booking_date,booking_time,party_size,source,booking_type,privacy_accepted_at,privacy_version) values(null,null,'',$1,'20:00',2,'booking','normale',now(),'2026-10-12-online-v2')`,[day]),/Contatti non validi/);
 const preserved=(await db.query('select to_jsonb(b) row from bookings b order by id')).rows;
 await db.exec(await readFile(new URL('../supabase/complete-booking-system.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('select to_jsonb(b) row from bookings b order by id')).rows,preserved);
 }finally{await db.close();}
});

test('optimizer moves multiple future online bookings atomically and preserves equal plans and frozen assignments',async()=>{
 const db=await bookingDatabase();
 try{
 const day=(await db.query(`select to_char(d,'YYYY-MM-DD') as booking_day from generate_series((now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d where extract(isodow from d)<>1 limit 1`)).rows[0].booking_day;
 await db.exec("select set_config('makai.rebalancing','on',false)");
 const seeded=(await db.query(`insert into bookings(name,phone,email,booking_date,booking_time,party_size,tables,source,booking_type,privacy_accepted_at,privacy_version) values('Uno Makai','+393331234567','',$1,'20:00',2,'15+16','booking','normale',now(),'2026-10-12-online-v2'),('Due Makai','+393339876543','',$1,'20:00',2,'17','booking','normale',now(),'2026-10-12-online-v2') returning id,tables`,[day])).rows;
 await db.exec("select set_config('makai.rebalancing','',false)");
 const row=(await db.query(`insert into bookings(name,phone,email,booking_date,booking_time,party_size,source,booking_type,privacy_accepted_at,privacy_version) values('Sei Makai','+393330000001','',$1,'20:00',6,'booking','normale',now(),'2026-10-12-online-v2') returning *`,[day])).rows[0];
 assert.equal(row.tables,'15+16+17');
 for(const original of seeded){assert.notEqual((await db.query('select tables from bookings where id=$1',[original.id])).rows[0].tables,original.tables);}
 const before=(await db.query('select id,tables from bookings order by id')).rows;
 await db.query("update bookings set notes='Nota cliente' where id=$1",[row.id]);
 assert.deepEqual((await db.query('select id,tables from bookings order by id')).rows,before);
 assert.equal((await db.query("select count(*)::int n from booking_communications where kind='updated' and booking_id=any($1::bigint[])",[seeded.map(r=>r.id)])).rows[0].n,0);
 const frozen=before.find(b=>b.id!==row.id);
 await db.query('select public.admin_set_booking_frozen($1,true)',[frozen.id]);
 await db.query("update bookings set status='cancelled' where id=$1",[row.id]);
 assert.equal((await db.query('select tables from bookings where id=$1',[frozen.id])).rows[0].tables,frozen.tables);
 await assert.rejects(db.query(`insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type) values($1,'21:00',6,'15+16+17','agenda','normale'),($1,'21:00',2,'18','agenda','normale')`,[day]),/configurazione|Capienza/i);
 }finally{await db.close();}
});

test('customer token hashes, requests, approval, alternatives, reconfirmation and permission boundaries',async()=>{
 const db=await bookingDatabase();
 try{
 const day=(await db.query(`select to_char(d,'YYYY-MM-DD') as booking_day from generate_series((now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d where extract(isodow from d)<>1 limit 1`)).rows[0].booking_day;
 const b=(await db.query(`insert into bookings(name,phone,email,booking_date,booking_time,party_size,source,booking_type) values('Cliente Test','','',$1,'20:00',2,'agenda','normale') returning *`,[day])).rows[0];
 const hash='a'.repeat(64),expired='b'.repeat(64);
 await db.query("insert into private.booking_customer_tokens(token_hash,booking_id,expires_at) values($1,$2,now()+interval '10 days'),($3,$2,now()-interval '1 second')",[hash,b.id,expired]);
 assert.equal((await db.query('select private.customer_booking($1) r',[expired])).rows[0].r,null);
 const view=(await db.query('select private.customer_booking($1) r',[hash])).rows[0].r;
 assert.equal(view.name,b.name);assert.equal(view.id,undefined);assert.equal(view.phone,undefined);
 await db.exec("set request.jwt.claims='{}'");
 const req=(await db.query("select private.customer_booking_request($1,'ora','\"21:00\"'::jsonb) r",[hash])).rows[0].r;
 assert.equal((await db.query('select booking_time from bookings where id=$1',[b.id])).rows[0].booking_time,'20:00');
 await assert.rejects(db.query("select private.customer_booking_request($1,'ora','\"22:00\"'::jsonb)",[hash]),/già in attesa/);
 await db.exec(`set request.jwt.claims='{"app_metadata":{"role":"admin"}}';set role authenticated;`);
 await assert.rejects(db.query('select * from private.booking_customer_tokens'),/permission denied/);
 await assert.rejects(db.query('select private.customer_booking($1)',[hash]),/permission denied/);
 await db.query("select public.admin_propose_booking_alternative($1,'Possiamo accogliervi alle 21:00')",[req.request_id]);
 await db.query("select public.admin_review_booking_request($1,'approved')",[req.request_id]);
 assert.equal((await db.query('select booking_time from bookings where id=$1',[b.id])).rows[0].booking_time,'21:00');
 await db.exec('reset role');
 await db.query('select private.reconfirm_customer_booking($1)',[hash]);
 await db.query('select private.reconfirm_customer_booking($1)',[hash]);
 assert.equal((await db.query("select count(*)::int n from booking_history where booking_id=$1 and action='customer_reconfirmed'",[b.id])).rows[0].n,1);
 assert.equal((await db.query('select reconfirmation_status from bookings where id=$1',[b.id])).rows[0].reconfirmation_status,'reconfirmed');
 assert.equal((await db.query('select private.customer_booking($1) r',[hash])).rows[0].r.requests[0].alternative,'Possiamo accogliervi alle 21:00');
 await db.exec(`set request.jwt.claims='{"app_metadata":{"role":"customer"}}';set role authenticated;`);
 await assert.rejects(db.query('select public.admin_list_notifications()'),/Accesso riservato/);
 await assert.rejects(db.query('select public.admin_release_booking_table($1)',[b.id]),/Accesso riservato/);
 await db.exec('reset role');
 }finally{await db.close();}
});

test('online confirmation with a management token can be claimed for sending',async()=>{
 const db=await bookingDatabase();
 try{
  const migration=await readFile(new URL('../supabase/migrations/20261017125249_booking_email_management_link_claim.sql',import.meta.url),'utf8');
  await db.exec(migration);
  const day=(await db.query(`select to_char(d,'YYYY-MM-DD') as booking_day from generate_series((now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d where extract(isodow from d)<>1 limit 1`)).rows[0].booking_day;
  const booking=(await db.query(`insert into bookings(name,phone,email,booking_date,booking_time,party_size,source,booking_type,privacy_accepted_at,privacy_version) values('Cliente Test','+393331234567','guest@example.invalid',$1,'20:00',2,'booking','normale',now(),'2026-10-12-online-v2') returning *`,[day])).rows[0];
  const url='https://www.makaipigneto.it/prenotazioni/gestisci#token='+'a'.repeat(43);
  await db.query("update booking_communications set snapshot=jsonb_set(snapshot,'{management_url}',to_jsonb($1::text)) where booking_id=$2 and kind='confirmation'",[url,booking.id]);
  const claimed=(await db.query('select public.claim_new_online_booking_email($1) r',[booking.id])).rows[0].r;
  assert.equal(claimed.kind,'confirmation');
  assert.equal(claimed.status,'sending');
  assert.equal(claimed.snapshot.management_url,url);
  assert.equal((await db.query('select attempts from booking_communications where id=$1',[claimed.id])).rows[0].attempts,1);
  assert.equal((await db.query('select public.claim_new_online_booking_email($1) r',[booking.id])).rows[0].r,null);
 }finally{await db.close();}
});

test('reminder queue is idempotent, archive is personal and midnight delay uses the service day',async()=>{
 const db=await bookingDatabase();
 try{
 const day=(await db.query("select to_char((now() at time zone 'Europe/Rome')::date+1,'YYYY-MM-DD') as booking_day")).rows[0].booking_day;
 // Seed without normal day validation: reminder behavior is independent of weekly closing.
 await db.exec("select set_config('makai.rebalancing','on',false)");
 const b=(await db.query(`insert into bookings(name,phone,email,booking_date,booking_time,party_size,tables,source,booking_type) values('Cliente Reminder','+393331234567','guest@example.invalid',$1,'20:00',2,'12','booking','normale') returning *`,[day])).rows[0];
 await db.exec("select set_config('makai.rebalancing','',false)");
 const url='https://www.makaipigneto.it/prenotazioni/gestisci#token='+'a'.repeat(43);
 const manual=(await db.query("select private.prepare_staff_email($1,'reconfirmation',$2,'') r",[b.id,url])).rows[0].r;
 assert.equal(manual.kind,'reconfirmation');
 assert.equal(manual.snapshot.management_url,url);
 const repeatedManual=(await db.query("select private.prepare_staff_email($1,'reconfirmation',$2,'') r",[b.id,url])).rows[0].r;
 assert.notEqual(repeatedManual.id,manual.id,'lo staff può richiedere di nuovo la riconferma');
 assert.equal((await db.query('select status from booking_communications where id=$1',[manual.id])).rows[0].status,'superseded');
 const scheduled=(await db.query("select private.prepare_staff_email($1,'reconfirmation',$2,'','scheduled') r",[b.id,url])).rows[0].r;
 assert.match(scheduled.event_key,/^scheduled:reconfirmation:/);
 assert.equal((await db.query('select status from booking_communications where id=$1',[repeatedManual.id])).rows[0].status,'superseded');
 assert.equal((await db.query("select private.prepare_staff_email($1,'reconfirmation',$2,'','scheduled') r",[b.id,url])).rows[0].r.id,scheduled.id);
 await db.query("update bookings set reconfirmation_status='reconfirmed',reconfirmed_at=now() where id=$1",[b.id]);
 await assert.rejects(db.query("select private.prepare_staff_email($1,'reconfirmation',$2,'','scheduled')",[b.id,url]),/Riconferma automatica non prevista/);
 await assert.rejects(db.query("select private.prepare_staff_email($1,'delay',$2,'')",[b.id,url]),/Ritardo non ancora/);
 const first=(await db.query('select private.prepare_booking_reminder($1,$2) r',[b.id,url])).rows[0].r;
 assert.equal(first.kind,'reminder');assert.equal(first.status,'queued');
 assert.equal((await db.query('select private.prepare_booking_reminder($1,$2) r',[b.id,url])).rows[0].r,null);
 const claimed=(await db.query('select public.claim_booking_email($1) r',[first.id])).rows[0].r;
 assert.equal(claimed.status,'sending');
 assert.equal((await db.query('select public.claim_booking_email($1) r',[first.id])).rows[0].r,null);
 await db.query("select public.finish_booking_email($1,'unknown',null,'network_uncertain')",[first.id]);
 await db.exec('set role authenticated');
 let notices=(await db.query('select * from public.admin_list_notifications()')).rows;
 const failure=notices.find(n=>n.kind==='communication_failed');assert.ok(failure);
 await db.query('select public.admin_mark_notification_read($1)',[failure.id]);
 assert.ok((await db.query('select * from public.admin_list_notifications() where id=$1',[failure.id])).rows[0].read_at);
 await db.query('select public.admin_archive_notification($1)',[failure.id]);
 assert.equal((await db.query('select * from public.admin_list_notifications() where id=$1',[failure.id])).rows.length,0);
 await db.exec('reset role');
 assert.equal((await db.query("select private.operational_day('2026-10-10T22:30:00Z') r")).rows[0].r,'2026-10-10');
 assert.equal((await db.query("select private.operational_day('2026-10-11T00:00:00Z') r")).rows[0].r,'2026-10-11');
 assert.equal((await db.query('select reconfirmation_status,status from bookings where id=$1',[b.id])).rows[0].status,'confirmed');
 }finally{await db.close();}
});

test('future ADMIN edits keep the record and preserve a manually over-capacity unit',async()=>{
 const db=await bookingDatabase();try{
 const day=(await db.query(`select to_char(d,'YYYY-MM-DD') as booking_day from generate_series((now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d where extract(isodow from d)<>1 limit 1`)).rows[0].booking_day;
 let b=(await db.query(`insert into bookings(name,phone,email,booking_date,booking_time,party_size,source,booking_type,privacy_accepted_at,privacy_version) values('Cliente Edit','+393331234567','',$1,'20:00',2,'booking','normale',now(),'2026-10-12-online-v2') returning *`,[day])).rows[0];
 const expected=Object.fromEntries(['booking_date','booking_time','party_size','tables','notes'].map(k=>[k,b[k]]));
 await db.exec('set role authenticated');
 const result=(await db.query('select public.admin_update_booking($1,$2,$3) r',[b.id,{party_size:6},expected])).rows[0].r.booking;
 assert.equal(result.id,b.id);assert.equal(result.tables,'12');
 await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int n from bookings')).rows[0].n,1);
 await db.query("update bookings set tables='' where id=$1",[b.id]);
 const released=(await db.query('select tables,table_released_at from bookings where id=$1',[b.id])).rows[0];assert.equal(released.tables,'');assert.ok(released.table_released_at);
 }finally{await db.close();}
});
