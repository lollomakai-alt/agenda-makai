import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bookingDatabase } from './helpers/bookingDatabase.js';
import { TABLE_ASSIGNMENTS } from '../src/config/tableAssignments.js';

test('ADMIN manual assignment/edit permits over-capacity, keeps physical conflicts and never moves another booking', async () => {
  const db = await bookingDatabase();
  try {
    assert.equal(TABLE_ASSIGNMENTS['13+14'], 3);
    assert.equal(TABLE_ASSIGNMENTS['22+23'], 4);
    assert.equal(TABLE_ASSIGNMENTS['22'], 2);
    assert.equal(TABLE_ASSIGNMENTS['23'], 2);
    await db.exec(await readFile(new URL('../supabase/admin-manual-booking-edits.sql', import.meta.url), 'utf8'));
    const day = (await db.query(`select to_char(d,'YYYY-MM-DD') as booking_day from generate_series(
      (now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d
      where extract(isodow from d)<>1 limit 1`)).rows[0].booking_day;
    const insert = async (tables = '', party_size = 2) => (await db.query(
      `insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type,status)
       values($1,'20:00',$2,$3,'agenda','normale','confirmed') returning *`, [day, party_size, tables]
    )).rows[0];
    const snapshot = row => Object.fromEntries(['booking_date','booking_time','party_size','tables','notes'].map(key => [key, row[key]]));
    const rpc = async (name, row, changes, expected = snapshot(row)) =>
      (await db.query(`select public.${name}($1,$2,$3) result`, [row.id, changes, expected])).rows[0].result.booking;

    const booked = await insert('', 7);
    const unrelated = await insert('12', 2);
    const unrelatedBefore = (await db.query('select * from bookings where id=$1', [unrelated.id])).rows[0];
    await db.exec('set role authenticated');

    const assigned1314 = await rpc('admin_assign_booking_tables', booked, { tables: '13+14' });
    assert.equal(assigned1314.tables, '13+14'); // Two standard seats; over-capacity stays a manual staff decision.
    assert.equal((await db.query('select party_size from bookings where id=$1', [booked.id])).rows[0].party_size, 7);

    const seven = (await db.query('select * from bookings where id=$1', [booked.id])).rows[0];
    const edited = await rpc('admin_update_booking', seven, { party_size: 12 });
    assert.equal(edited.party_size, 12); // No automatic six-person cap on ADMIN edits.
    assert.equal(edited.tables, '13+14');

    const twelve = (await db.query('select * from bookings where id=$1', [booked.id])).rows[0];
    const twentyThree = await rpc('admin_update_booking', twelve, { party_size: 23 });
    assert.equal(twentyThree.party_size, 23);
    const asTwentyThree = (await db.query('select * from bookings where id=$1', [booked.id])).rows[0];
    const assigned2223 = await rpc('admin_assign_booking_tables', asTwentyThree, { tables: '22+23' });
    assert.equal(assigned2223.tables, '22+23'); // Authorized four-cover physical group.
    assert.equal(assigned2223.party_size, 23);
    const afterGroup = (await db.query('select * from bookings where id=$1', [booked.id])).rows[0];
    await rpc('admin_assign_booking_tables', afterGroup, { tables: '' });
    const assignedSeparateSingles = await insert('', 9);
    const assigned22and23 = await rpc('admin_assign_booking_tables', assignedSeparateSingles, { tables: '22,23' });
    assert.equal(assigned22and23.tables, '22,23');

    assert.equal((await db.query('select tables from bookings where id=$1', [unrelated.id])).rows[0].tables, '12');
    const conflictTarget = await insert('', 4);
    await assert.rejects(rpc('admin_assign_booking_tables', conflictTarget, { tables: '12' }), /già assegnato/);
    const invalid = await insert('', 4);
    await assert.rejects(rpc('admin_assign_booking_tables', invalid, { tables: '22+24' }), /non configurata/);

    const unrelatedAfter = (await db.query('select * from bookings where id=$1', [unrelated.id])).rows[0];
    assert.deepEqual(unrelatedAfter, unrelatedBefore);
    await db.exec('reset role');
    await db.exec(`set request.jwt.claims='{"app_metadata":{"role":"staff"}}'; set role authenticated`);
    const denied = (await db.query('select * from bookings where id=$1', [invalid.id])).rows[0];
    await assert.rejects(rpc('admin_assign_booking_tables', denied, { tables: '10+11' }), /Accesso riservato/);
    await assert.rejects(rpc('admin_update_booking', denied, { party_size: 100 }), /Accesso riservato/);
  } finally {
    await db.close();
  }
});
