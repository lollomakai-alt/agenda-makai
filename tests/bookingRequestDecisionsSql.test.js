import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Database isolato: ruoli reali, auth simulata; nessun dato di produzione.
test('richieste cliente: rifiuto motivato, email unica e approvazione invariata', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      create function auth.jwt() returns jsonb language sql as $$ select current_setting('request.jwt.claims',true)::jsonb $$;
      create function auth.uid() returns uuid language sql as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.bookings(id bigint primary key, name text, booking_date text, booking_time text, party_size integer, tables text, notes text, status text, booking_type text, source text default 'agenda', email text);
      create table public.booking_history(id bigint generated always as identity primary key,booking_id bigint,action text,old_data jsonb,new_data jsonb,created_at timestamptz default now());
      grant select,update on bookings to authenticated;
      set request.jwt.claims = '{"app_metadata":{"role":"admin"}}';
    `);
    for (const file of ['booking-status.sql','booking-history.sql','booking-edit.sql','table-conflicts.sql','booking-requests.sql']) {
      await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
    }
    const migration = await readFile(new URL('../supabase/migrations/20261024120000_booking_request_decisions.sql',import.meta.url),'utf8');
    const publicDefiner = await readFile(new URL('../supabase/migrations/20261030160000_booking_request_public_definer.sql',import.meta.url),'utf8');
    // Colonne introdotte dalla gestione cliente già distribuita prima di questa migrazione.
    await db.exec(`alter table public.booking_requests add column if not exists alternative_note text not null default '';
      alter table public.booking_requests add column if not exists origin text not null default 'staff';`);
    await db.exec(migration);
    await db.exec(publicDefiner);
    // Idempotent application preserves schema and data.
    await db.exec(migration);
    await db.exec(publicDefiner);
    const day = (await db.query(`select to_char(d,'YYYY-MM-DD') as day from generate_series(current_date+1,current_date+7,'1 day') d where extract(isodow from d) <> 1 limit 1`)).rows[0].day;
    await db.query(`insert into bookings values(42,'Ada',$1,'20:00',2,'','', 'confirmed','normale','agenda','cliente@example.com')`,[day]);
    await db.query(`insert into bookings values(43,'Bob',$1,'20:30',2,'','', 'confirmed','normale','agenda','non-valida')`,[day]);
    await db.exec('set role authenticated');
    const create = async (type,value,booking=42) => (await db.query(`select public.admin_create_booking_request($1,$2,$3::jsonb) as r`,[booking,type,JSON.stringify(value)])).rows[0].r;
    const reject = async (id,reason) => (await db.query(`select public.admin_review_booking_request_with_reason($1,'rejected',$2) as r`,[id,reason])).rows[0].r;
    const approve = async (id) => (await db.query(`select public.admin_review_booking_request_with_reason($1,'approved','') as r`,[id])).rows[0].r;
    const row = async (id) => (await db.query('select * from booking_requests where id=$1',[id])).rows[0];

    const pending = await create('data',day);
    for (const reason of ['', ' ', '\t\n', 'x'.repeat(501)]) await assert.rejects(reject(pending.id,reason),/motivazione/);
    await assert.rejects(db.query(`select public.admin_review_booking_request($1,'rejected')`,[pending.id]),/motivazione/);
    assert.equal((await row(pending.id)).status,'pending');

    const reason = 'Siamo al completo per quella data: scegli un altro giorno.';
    const rejected = await reject(pending.id,`  ${reason}  `);
    assert.equal(rejected.status,'rejected');
    assert.equal(rejected.rejection_reason,reason);
    assert.equal(rejected.decision_email_status,'queued');
    assert.equal(rejected.decision_email.rejection_reason,reason);
    assert.equal(rejected.decision_email.recipient,'cliente@example.com');
    assert.equal(rejected.decision_email.request_type,'data');
    assert.equal(rejected.decision_email.booking_date,day);
    await assert.rejects(reject(pending.id,reason),/già gestita/);
    await assert.rejects(approve(pending.id),/già gestita/);
    assert.equal((await row(pending.id)).rejection_reason,reason);
    await assert.rejects(db.query(`update booking_requests set decision_email='{}'::jsonb where id=$1`,[pending.id]),/già gestita|immutabile/);

    // Invalid recipient: decision saved, no email attempts.
    const invalid = await create('ora','21:00',43);
    const skipped = await reject(invalid.id,'Orario non disponibile.');
    assert.equal(skipped.decision_email_status,'skipped');
    assert.equal(skipped.decision_email_error,'invalid_email');
    await db.exec('set role service_role');
    assert.equal((await db.query(`select public.admin_booking_request_email_operation($1,'claim') as r`,[invalid.id])).rows[0].r,null);

    // One atomic claim; a second claim or a finish without accepted provider fails.
    const claim = async (id) => (await db.query(`select public.admin_booking_request_email_operation($1,'claim') as r`,[id])).rows[0].r;
    const finish = async (id,status,provider=null) => (await db.query(`select public.admin_booking_request_email_operation($1,'finish',$2,$3) as r`,[id,status,provider])).rows[0].r;
    const claimed = await claim(pending.id);
    assert.equal(claimed.decision_email_status,'sending');
    assert.equal(await claim(pending.id),null);
    await assert.rejects(finish(pending.id,'accepted',null),/Esito non valido/);
    const accepted = await finish(pending.id,'accepted','provider-1');
    assert.equal(accepted.decision_email_status,'accepted');
    assert.equal(accepted.decision_email_provider_id,'provider-1');
    await db.exec('set role authenticated');

    // The existing approval path still applies the change; no decision email is queued.
    const change = await create('ora','21:30');
    const approved = await approve(change.id);
    assert.equal(approved.status,'approved');
    assert.equal(approved.decision_email,null);
    assert.equal((await db.query('select booking_time from bookings where id=42')).rows[0].booking_time,'21:30');
    const reasoned = await create('ora','22:00');
    await assert.rejects(db.query(`select public.admin_review_booking_request_with_reason($1,'approved','Motivo')`,[reasoned.id]),/soltanto per il rifiuto/);

    // A failure in the same transaction rolls back decision and reason.
    const rollback = await create('note','Terrazza');
    await db.exec(`reset role; alter table booking_requests add constraint synthetic_failure check (id<>${rollback.id}) not valid; set role authenticated`);
    await assert.rejects(reject(rollback.id,'Non disponibile.'),/synthetic_failure/);
    assert.equal((await row(rollback.id)).status,'pending');
    assert.equal((await row(rollback.id)).rejection_reason,'');
    await db.exec('reset role; alter table booking_requests drop constraint synthetic_failure; set role authenticated');

    // Authorization and server-only claim.
    await db.exec(`set request.jwt.claims = '{"app_metadata":{"role":"customer"}}'`);
    await assert.rejects(reject(rollback.id,'Motivo.'),/Accesso riservato/);
    await assert.rejects(db.query(`select public.admin_booking_request_email_operation($1,'read') as r`,[pending.id]),/permission denied/);
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query(`select public.admin_booking_request_email_operation($1,'read') as r`,[pending.id])).rows[0].r.rejection_reason,reason);
    await db.exec('reset role');
  } finally { await db.close(); }
});
