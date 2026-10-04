import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

test('activity SQL records admin actor, creation and essential booking updates', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
      create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
      create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
      create table booking_history(id bigint generated always as identity primary key, booking_id bigint not null,
        action text not null, old_data jsonb, new_data jsonb, created_at timestamptz not null default now());
      create table waitlist_history(id bigint generated always as identity primary key, waitlist_id bigint,
        action text, old_data jsonb, new_data jsonb, actor_id uuid, created_at timestamptz default now());
      create table bookings(id bigint primary key, booking_date text, booking_time text, party_size integer,
        tables text, notes text, status text, booking_type text);
      grant select, insert on booking_history to authenticated;
      set request.jwt.claims='{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}';`);
    await db.exec(await readFile(new URL('../supabase/admin-activity-log.sql', import.meta.url), 'utf8'));
    await db.query(`insert into bookings values(42,'2026-10-15','20:00',2,'','private note','confirmed','normale')`);
    await db.query(`update bookings set status='cancelled',notes='changed private note' where id=42`);
    const rows = (await db.query('select * from booking_history order by id')).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].action, 'booking_created');
    assert.equal(rows[0].actor_id, '11111111-1111-1111-1111-111111111111');
    assert.deepEqual(rows[0].new_data, {
      booking_date: '2026-10-15', booking_time: '20:00', party_size: 2,
      tables: '', status: 'confirmed', booking_type: 'normale',
    });
    assert.equal(rows[1].action, 'booking_updated');
    assert.deepEqual(rows[1].old_data, { status: 'confirmed', notes: 'private note' });
    assert.ok(rows[1].created_at);
    assert.equal(rows[1].actor_id, '11111111-1111-1111-1111-111111111111');
    await db.query('select admin_record_booking_creation(42)');
    assert.equal((await db.query("select count(*)::integer as count from booking_history where booking_id=42 and action='booking_created'")).rows[0].count, 1);
  } finally {
    await db.close();
  }
});