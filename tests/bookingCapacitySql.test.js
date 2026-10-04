import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

async function capacityGuard(file) {
  const sql = await readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8');
  const match = sql.match(/  if new\.status='confirmed' and[\s\S]*?\n  end if;\n  if new\.source='booking'/);
  assert.ok(match, `${file} contains the daily capacity guard`);
  return match[0]
    .replace(/\n  if new\.source='booking'$/, '')
    .replace('    perform pg_advisory_xact_lock(734512);\n', '');
}

test('database trigger blocks the 26th confirmed cover and keeps both SQL definitions aligned', async () => {
  const [calendarGuard, adminGuard] = await Promise.all([
    capacityGuard('calendar.sql'),
    capacityGuard('admin-only.sql'),
  ]);
  assert.equal(calendarGuard, adminGuard);

  const db = new PGlite();
  try {
    await db.exec(`create table bookings(id integer primary key, booking_date text, party_size integer, status text);
      create function guard_capacity() returns trigger language plpgsql as $$
      begin
        ${calendarGuard}
        return new;
      end $$;
      create trigger guard_capacity before insert or update on bookings
      for each row execute function guard_capacity();`);
    await db.query(`insert into bookings values
      (1,'2026-10-15',20,'confirmed'),(2,'2026-10-15',4,'confirmed'),
      (3,'2026-10-15',8,'cancelled'),(4,'2026-10-16',8,'confirmed')`);
    await db.query(`insert into bookings values (5,'2026-10-15',1,'confirmed')`);
    await assert.rejects(
      db.query(`insert into bookings values (6,'2026-10-15',1,'confirmed')`),
      /Limite giornaliero di 25 coperti raggiunto/,
    );
  } finally {
    await db.close();
  }
});