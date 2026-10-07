import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('SQL manual assignment: sufficient capacity, full-unit residual, advisory configuration and persistent daily conflicts',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
   create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
   create function auth.uid() returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;
   grant usage on schema auth,private to authenticated;
   create table bookings(id bigint generated always as identity primary key,name text default 'Cliente',phone text,email text,booking_date text,booking_time text,party_size integer,tables text,notes text default '',status text default 'confirmed',source text default 'agenda',reminder_status text,booking_type text default 'normale');
   create table booking_history(id bigint generated always as identity primary key,booking_id bigint,action text,old_data jsonb,new_data jsonb,created_at timestamptz default now());
   create table online_booking_closures(booking_date date primary key);
   grant select,insert,update on bookings to authenticated;grant usage on sequence bookings_id_seq to authenticated;
   set request.jwt.claims='{"app_metadata":{"role":"admin"}}';`);
  for(const file of ['booking-status.sql','booking-history.sql','booking-edit.sql','table-conflicts.sql','after-dinner-bookings.sql','manual-table-assignment.sql','online-booking.sql','pending-online-capacity.sql','temporal-table-conflicts.sql','manual-assignment-capacity.sql','explicit-table-release.sql'])await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/explicit-table-release.sql',import.meta.url),'utf8')); // Idempotent upgrade.
  const day=(await db.query(`select to_char(d,'YYYY-MM-DD') as booking_day from generate_series((now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d where extract(isodow from d)<>1 limit 1`)).rows[0].booking_day;
  const insert=async(people,tables='',time='20:00',source='agenda')=>(await db.query(`insert into bookings(booking_date,booking_time,party_size,tables,source) values($1,$2,$3,$4,$5) returning *`,[day,time,people,tables,source])).rows[0];
  const assign=async(booking,tables)=>{
   const expected=Object.fromEntries(['booking_date','booking_time','party_size','tables','notes'].map(key=>[key,booking[key]]));
   return (await db.query('select admin_assign_booking_tables($1,$2,$3) r',[booking.id,{tables},expected])).rows[0].r.booking;
  };
  let booking=await insert(3);
  await db.exec('set role authenticated');
  booking=await assign(booking,'10+11');assert.equal(booking.tables,'10+11');
  booking=await assign(booking,'15+16');assert.equal(booking.tables,'15+16');
  await db.exec('reset role');
  let capacity=(await db.query("select private.service_capacity($1,'20:00',null) capacity",[day])).rows[0].capacity;
  assert.deepEqual(capacity,{total:25,occupied:4,unused:1,remaining:21,verified:true});
  assert.equal((await db.query("select private.service_capacity($1,'22:00',null) capacity",[day])).rows[0].capacity.remaining,21);
  assert.equal((await db.query('select count(*)::int n from booking_history where booking_id=$1',[booking.id])).rows[0].n,2);
  const beforeUpgrade=(await db.query('select to_jsonb(b) row from bookings b order by id')).rows;
  const historyBeforeUpgrade=(await db.query('select to_jsonb(h) row from booking_history h order by id')).rows;
  await db.exec(await readFile(new URL('../supabase/explicit-table-release.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.query('select to_jsonb(b) row from bookings b order by id')).rows,beforeUpgrade);
  assert.deepEqual((await db.query('select to_jsonb(h) row from booking_history h order by id')).rows,historyBeforeUpgrade);
  for(const status of ['arrived','completed']) {
   await db.query('update bookings set status=$1 where id=$2',[status,booking.id]);
   assert.equal((await db.query("select private.service_capacity($1,'23:59',null) capacity",[day])).rows[0].capacity.remaining,21);
   await assert.rejects(insert(3,'15+16','23:59'),/stessa giornata/);
  }
  await db.query("update bookings set status='confirmed' where id=$1",[booking.id]);

  const five=await insert(5);
  await db.exec('set role authenticated');await assert.rejects(assign(five,'20+21'),/Capienza insufficiente/);await db.exec('reset role');
  assert.equal((await db.query('select tables from bookings where id=$1',[five.id])).rows[0].tables,'');
  await db.exec('delete from bookings;delete from booking_history;');
  await insert(6,'15+16+17'); // Existing room configuration no longer vetoes physically disjoint manual unit 18.
  const small=await insert(2);
  await db.exec('set role authenticated');const saved=await assign(small,'18');await db.exec('reset role');assert.equal(saved.tables,'18');
  assert.equal((await db.query('select private.online_day_status($1,2,null) status',[day])).rows[0].status,'available');
  await assert.rejects(insert(3,'15+16','21:00'),/stessa giornata/);
  await assert.rejects(insert(3,'15+16','22:00'),/stessa giornata/); // Time never releases a physical unit.
  await db.exec('delete from bookings;delete from booking_history;');
  for(const [people,tables] of [[3,'15+16'],[3,'18+19'],[3,'20+21'],[3,'10+11'],[2,'12'],[2,'13+14'],[2,'17'],[2,'22'],[2,'23']]) await insert(people,tables);
  assert.deepEqual((await db.query("select private.service_capacity($1,'20:00',null) capacity",[day])).rows[0].capacity,{total:25,occupied:25,unused:3,remaining:0,verified:true});
  assert.equal((await db.query('select private.online_day_status($1,1,null) status',[day])).rows[0].status,'full'); // 22 people, but all 25 seats committed.
  await db.exec('delete from bookings;delete from booking_history;');
  await insert(6,'','20:00','booking');
  const manual=await insert(3);
  await db.exec('set role authenticated');const chosen=await assign(manual,'15+16');await db.exec('reset role');
  assert.equal(chosen.id,manual.id);assert.equal(chosen.tables,'15+16');
  capacity=(await db.query("select private.service_capacity($1,'20:00',null) capacity",[day])).rows[0].capacity;
  assert.equal(capacity.occupied,10); // 4 fixed seats + 6 pending covers, not 3+6.
  assert.equal(capacity.remaining,15);
  assert.equal((await db.query('select name from bookings where id=$1',[manual.id])).rows[0].name,'Cliente');
  await db.exec("set request.jwt.claims='{\"app_metadata\":{\"role\":\"staff\"}}';set role authenticated");
  await assert.rejects(assign(chosen,'10+11'),/Accesso riservato/);
 }finally{await db.close();}
});
