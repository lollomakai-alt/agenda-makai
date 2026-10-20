import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('rejection reason is mandatory and atomic with the existing review, private, immutable on replay',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 create table private.online_dopocena_requests(request_id text primary key,status text,booking_id bigint,name text,email text,booking_date text,booking_time text,party_size int);
 create table public.booking_communications(id bigint primary key,booking_id bigint,event_key text,channel text,status text,error_code text);
 create table public.booking_communication_logs(communication_id bigint,status text,error_code text);
 create function public.admin_review_online_dopocena_request(p_request_id text,p_decision text) returns jsonb language plpgsql security definer set search_path='' as $$
 declare r private.online_dopocena_requests;
 begin update private.online_dopocena_requests set status=p_decision where request_id=p_request_id and status='pending' returning * into r;
 if r.request_id is null then raise exception 'Already handled';end if;return to_jsonb(r);end $$;
 set request.jwt.claims='{"app_metadata":{"role":"admin"}}';`);
 for(const migration of ['20261020111054_dopocena_decision_email.sql','20261020114339_dopocena_rejection_reason.sql'])
  await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 await db.exec(`insert into private.online_dopocena_requests values('r','pending',null,'Ada','a@example.com','2026-10-25','23:00',2),('rollback','pending',null,'A','a@example.com','2026-10-25','23:00',2);`);
 const review=async(id,reason)=>(await db.query("select public.admin_review_dopocena_with_reason($1,'rejected',$2) r",[id,reason])).rows[0].r;
 for(const reason of ['', ' ', '\t\n', 'x'.repeat(501)]) await assert.rejects(review('r',reason),/motivazione/);
 await assert.rejects(db.query("select public.admin_review_online_dopocena_request('r','rejected')"),/motivazione/);
 assert.equal((await db.query("select status from private.online_dopocena_requests where request_id='r'")).rows[0].status,'pending');
 await db.exec('set role authenticated');
 const reason='Siamo al completo. Puoi scegliere un’altra data.';
 assert.equal((await review('r','  '+reason+'  ')).status,'rejected');
 assert.equal((await review('r',reason)).status,'rejected');
 await assert.rejects(review('r','Un altro motivo'),/già gestita/);
 const outcomes=(await db.query('select public.admin_dopocena_email_outcomes() r')).rows[0].r;
 assert.equal(outcomes[0].rejection_reason,reason);
 await assert.rejects(db.query('select * from private.dopocena_decision_emails'),/permission denied/);
 await db.exec(`reset role;alter table private.dopocena_decision_emails add constraint synthetic_failure check(request_id<>'rollback') not valid;set role authenticated;`);
 await assert.rejects(review('rollback',reason),/synthetic_failure/);
 await db.exec(`reset role;`);
 assert.equal((await db.query("select status from private.online_dopocena_requests where request_id='rollback'")).rows[0].status,'pending');
 assert.equal((await db.query("select count(*)::int n from private.dopocena_decision_emails")).rows[0].n,1);
 await db.exec(`set request.jwt.claims='{"app_metadata":{"role":"customer"}}';set role authenticated;`);
 await assert.rejects(review('r',reason),/Accesso riservato/);
 }finally{await db.close();}
});
