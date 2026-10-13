import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bookingDatabase } from './helpers/bookingDatabase.js';

async function setup() {
  const db = await bookingDatabase();
  await db.exec(await readFile(new URL('../supabase/admin-manual-booking-edits.sql', import.meta.url), 'utf8'));
  const day = (await db.query(`select to_char(d,'YYYY-MM-DD') booking_day from generate_series(
    (now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d
    where extract(isodow from d)<>1 limit 1`)).rows[0].booking_day;
  return { db, day };
}

let phone = 0;
async function online(db, day, partySize, type = 'dopocena') {
  const time = type === 'dopocena' ? '22:30' : '20:00';
  return (await db.query(`insert into bookings(name,phone,email,booking_date,booking_time,party_size,
    source,booking_type,privacy_accepted_at,privacy_version)
    values('Cliente Online',$1,'',$2,$3,$4,'booking',$5,now(),'2026-10-12-online-v2') returning *`,
  [`+3933399${String(++phone).padStart(6, '0')}`,day,time,partySize,type])).rows[0];
}

test('ADMIN 23 on 22+23 is physical; online CENA retains standard unit limits', async () => {
  const { db, day } = await setup();
  try {
    const row = (await db.query(`insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type)
      values($1,'20:00',23,'','agenda','normale') returning *`, [day])).rows[0];
    const expected = Object.fromEntries(['booking_date','booking_time','party_size','tables','notes'].map(k => [k,row[k]]));
    await db.exec('set role authenticated');
    const assigned = (await db.query('select public.admin_assign_booking_tables($1,$2,$3) result',
      [row.id,{tables:'22+23'},expected])).rows[0].result.booking;
    assert.equal(assigned.party_size,23);
    assert.equal(assigned.tables,'22+23');
    await db.exec('reset role');
    const capacity = (await db.query("select private.service_capacity($1,'20:00') result",[day])).rows[0].result;
    assert.equal(capacity.total,26);
    assert.equal(capacity.occupied,4);
    assert.equal(capacity.people_reserved,23);
    assert.equal(capacity.people_remaining,2);
    assert.equal(capacity.verified,true);
    await db.exec('set role service_role');
    assert.equal((await db.query("select private.online_slot_status($1,'20:00',2,'normale') status",[day])).rows[0].status,'available');
    assert.equal((await db.query("select private.online_slot_status($1,'20:00',3,'normale') status",[day])).rows[0].status,'full');
    assert.equal((await db.query("select private.online_slot_status($1,'22:30',2,'dopocena') status",[day])).rows[0].status,'available');
    await db.exec('reset role');
    const autoTwo = await online(db,day,2,'normale');
    assert.notEqual(autoTwo.tables,'22+23');
    assert.equal((await db.query("select private.online_slot_status($1,'20:00',1,'normale') status",[day])).rows[0].status,'full');
    assert.equal((await db.query("select private.online_slot_status($1,'20:00',4,'normale') status",[day])).rows[0].status,'full');
    await assert.rejects(online(db,day,23,'normale'),/non validi/);
    await assert.rejects(db.query(`insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type)
      values($1,'20:00',2,'22','agenda','normale')`,[day]),/Tavolo già assegnato/);
    await assert.rejects(db.query(`insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type)
      values($1,'20:00',2,'22+24','agenda','normale')`,[day]),/configurazione fisica/);
  } finally { await db.close(); }
});

test('DOPOCENA 25 quota includes manual edits, excludes inactive rows, and serializes saves', async () => {
  const { db, day } = await setup();
  try {
    const manual = (await db.query(`insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type)
      values($1,'22:30',23,'','agenda','dopocena') returning *`,[day])).rows[0];
    assert.equal((await db.query("select private.online_slot_status($1,'22:30',2,'dopocena') status",[day])).rows[0].status,'available');
    assert.equal((await db.query("select private.online_slot_status($1,'22:30',3,'dopocena') status",[day])).rows[0].status,'full');
    await assert.rejects(online(db,day,3),/25 persone|Disponibilità cambiata/);
    const two = await online(db,day,2);
    assert.equal(two.booking_type,'dopocena');
    await assert.rejects(online(db,day,1),/25 persone|Disponibilità cambiata/);
    const current = (await db.query('select * from bookings where id=$1',[manual.id])).rows[0];
    const expected = Object.fromEntries(['booking_date','booking_time','party_size','tables','notes'].map(k => [k,current[k]]));
    await db.exec('set role authenticated');
    const edited = (await db.query('select public.admin_update_booking($1,$2,$3) result',
      [manual.id,{party_size:27},expected])).rows[0].result.booking;
    assert.equal(edited.party_size,27);
    await db.exec('reset role');
    assert.equal((await db.query("select private.online_slot_status($1,'22:30',1,'dopocena') status",[day])).rows[0].status,'full');
    assert.equal((await db.query("select private.service_capacity_for_type($1,'22:30','dopocena') result",[day])).rows[0].result.people_reserved,29);
    await db.query("update bookings set status='cancelled' where id=$1",[manual.id]);
    await db.query("update bookings set status='cancelled' where id=$1",[two.id]);
    await db.query(`insert into bookings(booking_date,booking_time,party_size,source,booking_type,status)
      values($1,'22:30',20,'agenda','dopocena','no_show')`,[day]);
    assert.equal((await db.query("select private.online_slot_status($1,'22:30',6,'dopocena') status",[day])).rows[0].status,'available');
    const dinner = await online(db,day,2,'normale');
    assert.equal(dinner.booking_type,'normale');
    const holder = (await db.query(`insert into bookings(booking_date,booking_time,party_size,source,booking_type)
      values($1,'22:30',24,'agenda','dopocena') returning *`,[day])).rows[0];
    const outcomes = await Promise.allSettled([online(db,day,1),online(db,day,1)]);
    assert.equal(outcomes.filter(x => x.status === 'fulfilled').length,1);
    assert.equal(outcomes.filter(x => x.status === 'rejected').length,1);
    assert.equal((await db.query("select sum(party_size)::int covers from bookings where booking_date=$1 and booking_type='dopocena' and status not in ('cancelled','no_show')",[day])).rows[0].covers,25);
    assert.ok(holder.id);
  } finally { await db.close(); }
});

test('ADMIN DOPOCENA creation accepts over-quota group but rejects duplicate or occupied tables', async () => {
  const { db, day } = await setup();
  try {
    await db.exec('set role authenticated');
    const create = (people, tables) => db.query(`select public.admin_create_after_dinner_booking(
      'Cliente Manuale','+393331234567','',$1,'22:30',$2,'',$3) result`,[day,people,tables]);
    const saved = (await create(27,'22+23')).rows[0].result;
    assert.equal(saved.party_size,27);
    assert.equal(saved.tables,'22+23');
    await assert.rejects(create(2,'22'),/Tavolo già assegnato/);
    await assert.rejects(create(2,'22+23,22'),/non configurata o duplicata/);
    await db.exec('reset role');
    assert.equal((await db.query("select private.online_slot_status($1,'22:30',1,'dopocena') status",[day])).rows[0].status,'full');
  } finally { await db.close(); }
});
