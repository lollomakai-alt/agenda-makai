import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('decision email SQL: transactional queue, one claim, refusals without booking, permissions and retention',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 create table private.online_dopocena_requests(request_id text primary key,status text,booking_id bigint,name text,email text,booking_date text,booking_time text,party_size int);
 create table public.booking_communications(id bigint primary key,booking_id bigint,event_key text,channel text,status text,error_code text);
 create table public.booking_communication_logs(communication_id bigint,status text,error_code text);
 set request.jwt.claims='{"app_metadata":{"role":"admin"}}';`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261020111054_dopocena_decision_email.sql',import.meta.url),'utf8'));
 const operation=async(id,action,status=null,provider=null)=>(await db.query('select public.dopocena_email_operation($1,$2,$3,$4) r',[id,action,status,provider])).rows[0].r;
 await db.exec(`insert into private.online_dopocena_requests values('a','pending',null,'Ada','ada@example.com','2026-10-25','23:00',2),('r','pending',null,'Rita','rita@example.com','2026-10-25','23:00',3),('s','pending',null,'No mail',null,'2026-10-25','23:00',2);
 insert into booking_communications values(1,7,'created:7','email','queued',null);
 update private.online_dopocena_requests set status='accepted',booking_id=7 where request_id='a';
 update private.online_dopocena_requests set status='rejected' where request_id in ('r','s');`);
 assert.equal((await operation('r','read')).booking_id,null);
 assert.equal((await operation('s','read')).status,'skipped');
 assert.equal((await db.query('select status from booking_communications')).rows[0].status,'superseded');
 assert.equal((await db.query('select count(*)::int n from booking_communication_logs')).rows[0].n,1);
 // Repeated update cannot create or reopen an email.
 await db.exec(`update private.online_dopocena_requests set status='accepted' where request_id='a'`);
 for(const [id,outcome] of [['a','accepted'],['r','failed']]) {
  assert.equal((await operation(id,'claim')).status,'sending');
  assert.equal(await operation(id,'claim'),null);
  assert.equal((await operation(id,'finish',outcome,outcome==='accepted'?'provider-id':null)).status,outcome);
  assert.equal(await operation(id,'claim'),null);
 }
 await db.exec(`begin;insert into private.online_dopocena_requests values('rollback','pending',null,'A','a@example.com','2026-10-25','23:00',2);update private.online_dopocena_requests set status='rejected' where request_id='rollback';rollback;`);
 assert.equal(await operation('rollback','read'),null);
 await db.exec('set role authenticated');
 await assert.rejects(operation('a','claim'),/permission denied/);
 assert.equal((await db.query('select public.admin_dopocena_email_outcomes() r')).rows[0].r.length,3);
 await assert.rejects(db.query('select * from private.dopocena_decision_emails'),/permission denied/);
 await db.exec(`reset role;set request.jwt.claims='{"app_metadata":{"role":"customer"}}';set role authenticated;`);
 await assert.rejects(db.query('select public.admin_dopocena_email_outcomes()'),/Accesso riservato/);
 await db.exec(`reset role;delete from private.online_dopocena_requests where request_id='r'`);
 assert.equal(await operation('r','read'),null);
 } finally {await db.close();}
});
