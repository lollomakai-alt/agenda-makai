import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

test('automatic online confirmation: initial site event only, atomic claim and no automatic retries', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema private;
      create table bookings(id bigint primary key,name text,phone text,email text,booking_date text,
        booking_time text,party_size integer,tables text,notes text,status text,source text);
      create table booking_requests(id bigint primary key,booking_id bigint,status text,request_type text);
      grant select,update on bookings to service_role;`);
    await db.exec(await readFile(new URL('../supabase/agenda-communications.sql', import.meta.url), 'utf8'));
    const migration = await readFile(new URL('../supabase/migrations/20261005141443_automatic_online_confirmation.sql', import.meta.url), 'utf8');
    const insert = (id, source = 'booking', email = 'client@example.com') => db.query(`insert into bookings
      values($1,'Mario Rossi','+393331234567',$2,'2026-10-15','20:00',2,'','','confirmed',$3)`, [id,email,source]);
    await insert(1); await insert(2,'agenda'); await insert(3,'booking','');
    const before = (await db.query('select * from bookings order by id')).rows;
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual((await db.query('select * from bookings order by id')).rows, before);
    assert.equal((await db.query(`select count(*)::int n from booking_communications where status='sending'`)).rows[0].n,0);
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select claim_new_online_booking_email(1)'), /permission denied/);
      await db.exec('reset role');
    }
    const claim = async id => {
      await db.exec('set role service_role');
      try { return (await db.query('select claim_new_online_booking_email($1) r',[id])).rows[0].r; }
      finally { await db.exec('reset role'); }
    };
    assert.equal(await claim(2),null); assert.equal(await claim(3),null); assert.equal(await claim(9999),null);
    const created = await claim(1);
    assert.equal(created.status,'sending'); assert.equal(created.attempts,1);
    assert.equal(await claim(1),null);
    await db.query(`select finish_booking_email($1,'failed',null,'provider_http_422')`,[created.id]);
    assert.equal(await claim(1),null); // A failed first attempt never triggers an automatic retry.
    assert.equal((await db.query('select attempts from booking_communications where id=$1',[created.id])).rows[0].attempts,1);
    // Manual retry still uses the same communication and idempotency key.
    assert.equal((await db.query('select claim_booking_email($1) r',[created.id])).rows[0].r.id,created.id);
    await db.query(`select finish_booking_email($1,'accepted','provider-id',null)`,[created.id]);
    assert.equal(await claim(1),null);
    await insert(4); await db.exec(`update bookings set booking_time='20:30' where id=4`);
    assert.equal(await claim(4),null); // Updated/cancelled notifications remain manual.
    await insert(5); await db.exec(`update bookings set status='cancelled' where id=5`);
    assert.equal(await claim(5),null);
    await insert(6);
    const manual = (await db.query(`select admin_prepare_booking_communication(6,'email') r`)).rows[0].r;
    await db.query('select claim_booking_email($1)',[manual.id]);
    assert.equal(await claim(6),null); // An Agenda send winning the claim blocks the automatic send.
    assert.deepEqual((await db.query('select * from bookings where id<=3 order by id')).rows,before);
  } finally { await db.close(); }
});
