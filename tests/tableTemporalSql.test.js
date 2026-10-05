import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { BOOKING_STAY_MINUTES, bookingScheduledAt } from '../src/utils/bookingTime.js';

test('Postgres temporal trigger: overlap, turnover, grouped configurations, time updates and history',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
   create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
   create function auth.uid() returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;
   grant usage on schema auth,private to authenticated;
   create table bookings(id bigint generated always as identity primary key,name text default 'Cliente',phone text,email text,booking_date text,booking_time text,party_size integer,tables text,notes text default '',status text default 'confirmed',source text default 'agenda',reminder_status text,booking_type text default 'normale');
   create table booking_history(id bigint generated always as identity primary key,booking_id bigint,action text,old_data jsonb,new_data jsonb,created_at timestamptz default now());
   grant select,insert,update on bookings to authenticated;grant usage on sequence bookings_id_seq to authenticated;
   set request.jwt.claims='{"app_metadata":{"role":"admin"}}';`);
  for(const file of ['booking-status.sql','booking-history.sql','booking-edit.sql','table-conflicts.sql','after-dinner-bookings.sql','manual-table-assignment.sql','online-booking.sql','pending-online-capacity.sql','temporal-table-conflicts.sql'])await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/temporal-table-conflicts.sql',import.meta.url),'utf8')); // Idempotent patch.
  const day=(await db.query(`select to_char(d,'YYYY-MM-DD') as booking_day from generate_series((now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d where extract(isodow from d)<>1 limit 1`)).rows[0].booking_day;
  const insert=async(tables,time,people=2,type='normale',source='agenda')=>(await db.query(`insert into bookings(booking_date,booking_time,party_size,tables,booking_type,source) values($1,$2,$3,$4,$5,$6) returning *`,[day,time,people,tables,type,source])).rows[0];
  const first=await insert('12','20:00');
  await assert.rejects(insert('12','21:00'),/sovrapposto/);
  const later=await insert('12','22:00',2,'dopocena');
  await assert.rejects(db.query(`update bookings set booking_time='21:30' where id=$1`,[later.id]),/sovrapposto/);
  assert.equal((await db.query('select booking_time from bookings where id=$1',[later.id])).rows[0].booking_time,'22:00');
  await db.exec('delete from bookings;delete from booking_history;');
  await insert('15+16+17','20:00',6);
  await assert.rejects(insert('15+16','21:00',4),/sovrapposto/);
  await insert('15+16','22:00',4);
  await db.exec('delete from bookings;delete from booking_history;');
  await insert('15+16+17','20:00',6);
  await assert.rejects(insert('18','21:00'),/Configurazione/);
  await insert('18','22:00');
  await db.exec('delete from bookings;delete from booking_history;');
  await insert('15+16+17','18:30',6);await insert('18','21:00');await insert('12','20:00'); // Separate configurations across one candidate window.
  await db.exec('delete from bookings;delete from booking_history;');
  // Pending online six-person party must reserve its window, not the whole day.
  await insert('','20:00',6,'normale','booking');
  await assert.rejects(insert('15+16','21:00',2),/non resterebbe posto/);
  const chosen=await insert('15+16','22:00',2);
  assert.equal(chosen.tables,'15+16');
  await assert.rejects(db.query(`update bookings set booking_time='21:00' where id=$1`,[chosen.id]),/non resterebbe posto/);
  await db.exec('delete from bookings;delete from booking_history;');
  const existing=await insert('12','18:00');
  const target=await insert('','20:00');
  await db.exec('set role authenticated');
  const expected={booking_date:target.booking_date,booking_time:target.booking_time,party_size:target.party_size,tables:'',notes:''};
  const result=(await db.query('select admin_assign_booking_tables($1,$2,$3) r',[target.id,{tables:'12'},expected])).rows[0].r;
  assert.equal(result.booking.id,target.id);assert.equal(result.booking.tables,'12');
  assert.equal((await db.query('select count(*)::int n from booking_history where booking_id=$1',[target.id])).rows[0].n,1);
  assert.equal((await db.query('select tables from bookings where id=$1',[existing.id])).rows[0].tables,'12');
  await db.exec('reset role');
  const boundary=(await db.query(`select private.booking_intervals_overlap($1,'20:00',$1,'22:00') overlap`,[day])).rows[0].overlap;
  assert.equal(boundary,false);
  const duration=(await db.query(`select extract(epoch from ((private.booking_scheduled_at($1,'20:00') + interval '120 minutes')-private.booking_scheduled_at($1,'20:00')))/60 minutes`,[day])).rows[0].minutes;
  assert.equal(Number(duration),BOOKING_STAY_MINUTES);
  const dst=(await db.query(`select extract(epoch from private.booking_scheduled_at('2026-10-25','02:30'))*1000 as epoch`)).rows[0].epoch;
  assert.equal(Number(dst),bookingScheduledAt({booking_date:'2026-10-25',booking_time:'02:30'}));
  assert.ok(first.id);
 }finally{await db.close();}
});
