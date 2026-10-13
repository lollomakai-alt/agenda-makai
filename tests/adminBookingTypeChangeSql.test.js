import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bookingDatabase } from './helpers/bookingDatabase.js';

test('ADMIN changes service atomically with server capacity, tables, conflicts and concurrency checks', async () => {
  const db = await bookingDatabase();
  try {
    for (const path of ['../supabase/admin-manual-booking-edits.sql', '../supabase/migrations/20261013150000_admin_booking_type_change.sql']) {
      await db.exec(await readFile(new URL(path, import.meta.url), 'utf8'));
    }
    const day = (await db.query(`select to_char(d,'YYYY-MM-DD') booking_day from generate_series(
      (now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d
      where extract(isodow from d)<>1 limit 1`)).rows[0].booking_day;
    const add = async (type, time, size, tables = '') => (await db.query(
      `insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type,status)
       values($1,$2,$3,$4,'agenda',$5,'confirmed') returning *`, [day,time,size,tables,type]
    )).rows[0];
    const snapshot = row => Object.fromEntries(['booking_type','booking_date','booking_time','party_size','tables','notes'].map(key => [key,row[key]]));
    const change = async (row, changes, expected = snapshot(row)) => (await db.query(
      'select public.admin_change_booking_type($1,$2,$3) result', [row.id,changes,expected]
    )).rows[0].result.booking;

    const dinner = await add('normale','20:00',2,'12');
    const otherDinner = await add('normale','20:00',3,'13+14');
    const after = await add('dopocena','23:00',3);
    await db.exec('set role authenticated');

    const movedToDinner = await change(after,{booking_type:'normale',booking_time:'19:00',tables:'17'});
    assert.equal(movedToDinner.id,after.id);
    assert.equal(movedToDinner.booking_type,'normale');
    assert.equal(movedToDinner.tables,'17');
    assert.notEqual(movedToDinner.tables,'12');
    assert.notEqual(movedToDinner.tables,'13+14');
    assert.equal((await db.query('select tables from bookings where id=$1',[dinner.id])).rows[0].tables,'12');
    assert.equal((await db.query('select tables from bookings where id=$1',[otherDinner.id])).rows[0].tables,'13+14');

    const movedToAfter = await change(dinner,{booking_type:'dopocena',booking_time:'22:30'});
    assert.equal(movedToAfter.booking_type,'dopocena');
    assert.equal(movedToAfter.tables,'');
    assert.equal((await db.query('select table_released_at from bookings where id=$1',[dinner.id])).rows[0].table_released_at,null);
    assert.equal((await db.query('select count(*)::int count from bookings where id=$1',[dinner.id])).rows[0].count,1);
    await assert.rejects(change(dinner,{booking_type:'dopocena',booking_time:'22:30'}),/cambiata nel frattempo/);

    const fullAfter = await add('dopocena','23:30',24);
    const smallDinner = await add('normale','20:30',2,'12');
    await assert.rejects(change(smallDinner,{booking_type:'dopocena',booking_time:'22:30',tables:'12'}),/inizia senza tavolo/);
    const manualOverQuota = await change(smallDinner,{booking_type:'dopocena',booking_time:'22:30'});
    assert.equal(manualOverQuota.booking_type,'dopocena');
    await db.exec('reset role');
    assert.equal((await db.query("select private.online_slot_status($1,'22:30',1,'dopocena') status",[day])).rows[0].status,'full');
    await db.exec('set role authenticated');
    await assert.rejects(change(fullAfter,{booking_type:'normale',booking_time:'23:30',tables:'18+19'}),/Orario non valido/);
    const overCapacityDinner = await change(fullAfter,{booking_type:'normale',booking_time:'19:30',party_size:7,tables:'18+19'});
    assert.equal(overCapacityDinner.party_size,7); // La sovracapienza resta scelta manuale ADMIN.
    assert.equal(overCapacityDinner.tables,'18+19');
    const unavailableDay = (await db.query(`select to_char($1::date + 1,'YYYY-MM-DD') d`,[day])).rows[0].d;
    const fixedGroups = ['10+11','12','13+14','15+16+17','18+19','20+21','22','23'];
    for (const group of fixedGroups) {
      await db.query(`insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type,status)
        values($1,'20:00',2,$2,'agenda','normale','confirmed')`,[unavailableDay,group]);
    }
    const noTable = (await db.query(`insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type,status)
      values($1,'22:30',2,'','agenda','dopocena','confirmed') returning *`,[unavailableDay])).rows[0];
    await assert.rejects(change(noTable,{booking_type:'normale',booking_time:'19:00',tables:'12'}),/Tavolo già assegnato/);
    await assert.rejects(change(noTable,{booking_type:'normale',booking_time:'19:00',tables:'15+17'}),/unità tavolo CENA valida/);
    assert.equal((await db.query('select tables from bookings where id=$1',[noTable.id])).rows[0].tables,'');

    const configurationDay = (await db.query(`select to_char($1::date + 1,'YYYY-MM-DD') d`,[unavailableDay])).rows[0].d;
    await db.query(`insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type,status)
      values($1,'20:00',2,'15+16+17','agenda','normale','confirmed')`,[configurationDay]);
    await assert.rejects(db.query(`insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type,status)
      values($1,'20:00',2,'18','agenda','normale','confirmed')`,[configurationDay]),/configurazione fisica/);
    const configurationTarget = (await db.query(`insert into bookings(booking_date,booking_time,party_size,tables,source,booking_type,status)
      values($1,'22:30',2,'','agenda','dopocena','confirmed') returning *`,[configurationDay])).rows[0];
    await assert.rejects(change(configurationTarget,{booking_type:'normale',booking_time:'19:00',tables:'19'}),/Configurazione fisica/);

    const arrived = await add('normale','21:00',2);
    await db.query(`update bookings set status='arrived' where id=$1`,[arrived.id]);
    await assert.rejects(change(arrived,{booking_type:'dopocena',booking_time:'22:30'}),/solo per prenotazioni confermate/);
    await db.exec('reset role');
    await db.exec(`set request.jwt.claims='{"app_metadata":{"role":"staff"}}'; set role authenticated`);
    await assert.rejects(change(smallDinner,{booking_type:'dopocena',booking_time:'22:30'}),/Accesso riservato/);
  } finally {
    await db.close();
  }
});
