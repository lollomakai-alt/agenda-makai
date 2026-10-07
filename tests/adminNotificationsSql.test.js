import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('SQL notification feed: thresholds, priority, personal persisted reads, RLS, resolution and schedule changes', async t => {
  // Freeze the local PGlite clock just after Rome midnight to exercise date rollover.
  const now = Date.parse('2026-10-06T00:20:00+02:00');
  t.mock.timers.enable({ apis: ['Date'], now });
  const db = new PGlite();
  try {
    assert.equal((await db.query('select now() as time')).rows[0].time.getTime(), now);
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.jwt() returns jsonb language sql as $$ select current_setting('request.jwt.claims',true)::jsonb $$;
      create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to authenticated;
      create table bookings(id bigint primary key,booking_date text,booking_time text,status text,source text default 'agenda',tables text default '',created_at timestamptz default now());
      create table booking_requests(id bigint primary key,booking_id bigint references bookings(id),request_type text,status text,created_at timestamptz default now());
      alter table bookings enable row level security;
      alter table booking_requests enable row level security;
      grant select on bookings,booking_requests to authenticated;
      create policy admin_bookings_select on bookings for select to authenticated using(auth.jwt()->'app_metadata'->>'role'='admin');
      create policy admin_requests_select on booking_requests for select to authenticated using(auth.jwt()->'app_metadata'->>'role'='admin');
      set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}';
    `);
    const sql = await readFile(new URL('../supabase/admin-notifications.sql',import.meta.url),'utf8');
    await db.exec(sql);
    await db.exec(sql); // Safe reapplication.
    await db.exec(`begin;
      insert into bookings(id,booking_date,booking_time,status) select id, to_char((now() at time zone 'Europe/Rome') - late,'YYYY-MM-DD'),to_char((now() at time zone 'Europe/Rome')-late,'HH24:MI:SS'),status
      from (values (1,interval '14 minutes 59 seconds','confirmed'),(2,interval '15 minutes','confirmed'),(3,interval '30 minutes','confirmed'),
        (4,interval '30 minutes','arrived'),(5,interval '30 minutes','cancelled'),(6,interval '30 minutes','completed'),(7,interval '30 minutes','no_show'),
        (8,interval '25 hours','confirmed'),(9,interval '-1 hour','confirmed'),(10,interval '20 minutes','CONFIRMED')) as x(id,late,status);
      insert into bookings(id,booking_date,booking_time,status) values(11,'2026-02-30','20:00','confirmed');
      insert into booking_requests(id,booking_id,request_type,status) values(1,1,'note','pending'),(2,1,'cancellazione','pending'),(3,1,'data','approved'),(4,1,'ora','rejected');
      set local role authenticated;
    `);
    const feed = async () => (await db.query('select * from admin_list_notifications()')).rows;
    const mark = async id => (await db.query('select admin_mark_notification_read($1) as r',[id])).rows[0].r;
    async function reject(action, pattern) {
      await db.exec('savepoint expected_failure');
      try { await assert.rejects(action, pattern); }
      finally { await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure'); }
    }
    let rows = await feed();
    assert.equal(rows.length,5); // 3 delays + 2 requests; excluded statuses/old/future skipped.
    assert.equal(rows.find(x=>x.booking_id===2 && x.kind==='delay').priority,'normal');
    assert.equal(rows.find(x=>x.booking_id===3 && x.kind==='delay').priority,'high');
    assert.equal(rows.find(x=>x.id==='request:2').priority,'high');
    assert.equal(rows.find(x=>x.id==='request:1').priority,'normal');
    const delayId=rows.find(x=>x.booking_id===2 && x.kind==='delay').id;
    const first=await mark(delayId);
    assert.deepEqual(await mark(delayId),first); // Idempotent; timestamp unchanged.
    assert.ok((await feed()).find(x=>x.id===delayId).read_at);
    assert.equal((await feed()).filter(x=>!x.read_at).length,4);
    assert.ok((await feed()).at(-1).read_at); // Read sorts after unread, regardless of priority.
    await mark('request:1');
    await reject(() => mark('request:999'),/risolta o non accessibile/);
    await reject(() => db.query(`insert into admin_notification_reads(user_id,notification_id) values('22222222-2222-2222-2222-222222222222','request:1')`),/row-level security/);
    await reject(() => db.query('update admin_notification_reads set read_at=now()'),/permission denied/);
    await reject(() => db.query('delete from admin_notification_reads'),/permission denied/);
    await db.exec(`set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"role":"admin"}}'`);
    assert.equal((await feed()).filter(x=>!x.read_at).length,5); // Another admin does not inherit reads.
    assert.equal((await db.query('select * from admin_notification_reads')).rows.length,0);
    await db.exec(`set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}'; reset role;
      update booking_requests set status='approved' where id=1;
      update bookings set status='arrived' where id=3;
      update bookings set
        booking_date=to_char((now() at time zone 'Europe/Rome')-interval '40 minutes','YYYY-MM-DD'),
        booking_time=to_char((now() at time zone 'Europe/Rome')-interval '40 minutes','HH24:MI:SS') where id=2;
      set local role authenticated;`);
    rows=await feed();
    assert.ok(!rows.some(x=>x.id==='request:1' || x.id===delayId || x.booking_id===3));
    const changed=rows.find(x=>x.booking_id===2 && x.kind==='delay');
    assert.ok(changed);
    assert.equal(changed.booking_date,'2026-10-05'); // 23:40 on the previous Rome day.
    assert.ok(changed.id!==delayId && !changed.read_at);
    assert.equal(changed.priority,'high');
    await reject(() => mark('request:1'),/risolta/);
    await db.exec(`set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","user_metadata":{"role":"admin"}}'`);
    await reject(feed,/staff/);
    await reject(() => mark('request:2'),/staff/);
    assert.equal((await db.query('select * from admin_notification_reads')).rows.length,0);
    await reject(() => db.query(`insert into admin_notification_reads(notification_id) values('request:2')`),/row-level security/);
    await db.exec('reset role; set local role anon');
    await reject(feed,/permission denied/);
    await reject(() => mark('request:2'),/permission denied/);
    await reject(() => db.query('select * from admin_notification_reads'),/permission denied/);
    await db.exec(`reset role;
      set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}';
      insert into bookings(id,booking_date,booking_time,status,source,tables)
        values(12,to_char((now() at time zone 'Europe/Rome')::date+1,'YYYY-MM-DD'),'20:00','confirmed','booking','');
      set local role authenticated;`);
    assert.equal((await feed()).find(x=>x.id==='online:12').kind,'online_booking');
    await mark('online:12');
    assert.ok((await feed()).find(x=>x.id==='online:12').read_at);
    await db.exec(`reset role;update bookings set tables='12' where id=12;set local role authenticated;`);
    assert.ok(!(await feed()).some(x=>x.id==='online:12'));
    await db.exec('rollback');
  } finally { await db.close(); }
});
