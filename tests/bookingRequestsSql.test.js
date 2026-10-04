import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Database isolato: ruoli/RLS reali, auth simulata; nessun dato di produzione.
test('SQL requests: RLS, five types, immutable lifecycle, existing edits and transactional rollback', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema private;
      create function auth.jwt() returns jsonb language sql as $$ select current_setting('request.jwt.claims',true)::jsonb $$;
      create function auth.uid() returns uuid language sql as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
      grant usage on schema auth,private to authenticated;
      create table public.bookings(id bigint primary key, booking_date text, booking_time text, party_size integer, tables text, notes text, status text, booking_type text);
      create table public.booking_history(id bigint generated always as identity primary key,booking_id bigint,action text,old_data jsonb,new_data jsonb,created_at timestamptz default now());
      grant select,update on bookings to authenticated;
      set request.jwt.claims = '{"app_metadata":{"role":"admin"}}';
    `);
    for (const file of ['booking-status.sql','booking-history.sql','booking-edit.sql','table-conflicts.sql','booking-requests.sql']) {
      await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
    }
    // Idempotent application keeps data/schema intact.
    await db.exec(await readFile(new URL('../supabase/booking-requests.sql',import.meta.url),'utf8'));
    const day = (await db.query(`select to_char(d,'YYYY-MM-DD') as day from generate_series(current_date+1,current_date+7,'1 day') d where extract(isodow from d) <> 1 limit 1`)).rows[0].day;
    await db.query(`insert into bookings values(42,$1,'20:00',2,'','', 'confirmed','normale')`,[day]);
    await db.exec('set role authenticated');
    const create = async (type,value) => (await db.query(`select public.admin_create_booking_request(42,$1,$2::jsonb) as r`,[type,JSON.stringify(value)])).rows[0].r;
    const review = async (id,decision) => (await db.query(`select public.admin_review_booking_request($1,$2) as r`,[id,decision])).rows[0].r;
    const booking = async () => (await db.query('select * from bookings where id=42')).rows[0];
    const historyCount = async () => Number((await db.query('select count(*) as n from booking_history')).rows[0].n);
    const pending = await create('note','Seggiolone');
    assert.equal((await booking()).notes,'');
    assert.equal(await historyCount(),1);
    await review(pending.id,'rejected');
    assert.equal((await booking()).notes,'');
    assert.equal(await historyCount(),2);
    await assert.rejects(review(pending.id,'approved'), /già gestita/);
    for (const [type,value,field] of [['note','Terrazza','notes'],['ora','21:00','booking_time'],['persone',3,'party_size']]) {
      const r = await create(type,value);
      assert.equal((await review(r.id,'approved')).status,'approved');
      assert.equal((await booking())[field],value);
    }
    const nextDay = (await db.query(`select to_char(d,'YYYY-MM-DD') as day from generate_series($1::date+1,$1::date+7,'1 day') d where extract(isodow from d) <> 1 limit 1`,[day])).rows[0].day;
    const dateRequest = await create('data',nextDay);
    await review(dateRequest.id,'approved');
    assert.equal((await booking()).booking_date,nextDay);
    const stale = await create('note','Vecchia');
    const original = await booking();
    await db.query(`select admin_update_booking(42,'{"notes":"Nuova"}', $1::jsonb)`,[JSON.stringify(Object.fromEntries(['booking_date','booking_time','party_size','tables','notes'].map(k=>[k,original[k]])))]);
    await assert.rejects(review(stale.id,'approved'), /cambiata/);
    await review(stale.id,'rejected');
    const invalidTime = await create('ora','03:00');
    const count = await historyCount();
    await assert.rejects(review(invalidTime.id,'approved'), /Orario non disponibile/);
    assert.equal(await historyCount(),count);
    assert.equal((await db.query('select status from booking_requests where id=$1',[invalidTime.id])).rows[0].status,'pending');
    await assert.rejects(db.query(`update booking_requests set requested_value='"hack"',status='rejected' where id=$1`,[invalidTime.id]), /immutabile/);
    await review(invalidTime.id,'rejected');
    for (const [type,value] of [['persone',7],['data','2026-02-30'],['ora','25:00'],['note','x'.repeat(301)],['tables','12']]) await assert.rejects(create(type,value));
    // A history write failure must roll back both booking and request decision.
    const rollback = await create('note','Rollback');
    const beforeRollback = await booking();
    const beforeHistory = await historyCount();
    await db.exec(`reset role; alter table booking_history add constraint fail_approval check(action <> 'customer_request_approved') not valid; set role authenticated`);
    await assert.rejects(review(rollback.id,'approved'), /fail_approval/);
    assert.deepEqual(await booking(),beforeRollback);
    assert.equal(await historyCount(),beforeHistory);
    assert.equal((await db.query('select status from booking_requests where id=$1',[rollback.id])).rows[0].status,'pending');
    await db.exec(`reset role; alter table booking_history drop constraint fail_approval; set role authenticated`);
    await review(rollback.id,'rejected');
    await assert.rejects(db.query('delete from booking_requests where id=$1',[rollback.id]), /permission denied/);
    // Existing table capacity validation is invoked at approval, not at intake.
    await db.exec(`reset role; update bookings set tables='12',party_size=2 where id=42; set role authenticated`);
    const capacity = await create('persone',3);
    await assert.rejects(review(capacity.id,'approved'), /Capienza/);
    assert.equal((await booking()).party_size,2);
    await review(capacity.id,'rejected');
    const cancel = await create('cancellazione',null);
    await review(cancel.id,'approved');
    assert.equal((await booking()).status,'cancelled');
    await assert.rejects(create('note','x'), /non più modificabile/);
    const events = (await db.query('select action from booking_history')).rows.map(r=>r.action);
    for (const action of ['customer_request_created','customer_request_approved','customer_request_rejected','booking_updated','status_changed']) assert.ok(events.includes(action));
    await db.exec(`set request.jwt.claims = '{"user_metadata":{"role":"admin"}}'`);
    assert.equal((await db.query('select * from booking_requests')).rows.length,0);
    await assert.rejects(create('note','x'), /staff/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from booking_requests'), /permission denied/);
    await assert.rejects(create('note','x'), /permission denied/);
  } finally { await db.close(); }
});
