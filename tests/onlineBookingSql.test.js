import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { TABLE_ASSIGNMENTS } from '../src/config/tableAssignments.js';

// PGlite is single-session; PostgreSQL advisory lock calls are removed only
// in this local fixture. Actual request locking remains in the production SQL.
test('online SQL shares grouped rules, reserves unassigned covers, saves without tables and records private history',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema auth;create schema private;
   create function auth.jwt() returns jsonb language sql as $$ select coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb $$;
   create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
   create table bookings(id bigint generated always as identity primary key,name text,email text default '',phone text,
    booking_date text,booking_time text,party_size int,notes text default '',tables text default '',status text default 'confirmed',
    source text default 'agenda',reminder_status text default 'skipped',reminder_attempts int default 0,
    created_at timestamptz default now(),updated_at timestamptz default now(),consenso_ricordami boolean default false,
    consenso_data timestamptz,arrived_at timestamptz,marketing_visit_counted_at timestamptz,user_id uuid,booking_type text default 'normale');
   create table booking_history(id bigint generated always as identity primary key,booking_id bigint references bookings(id),action text,old_data jsonb,new_data jsonb);
   create table online_booking_closures(booking_date date primary key);
   set request.jwt.claims='{}';`);
  const sql=await readFile(new URL('../supabase/online-booking.sql',import.meta.url),'utf8');
  const localSql=sql.replaceAll('perform pg_advisory_xact_lock(734512);','null;');
  await db.exec(localSql);await db.exec(localSql);
  await db.exec('create trigger prepare_booking before insert or update on bookings for each row execute function private.prepare_booking()');
  const guard=await readFile(new URL('../supabase/pending-online-capacity.sql',import.meta.url),'utf8');
  await db.exec(guard);await db.exec(guard);

  const groups=(await db.query('select * from private.online_table_groups()')).rows;
  assert.deepEqual(Object.fromEntries(groups.map(g=>[g.group_id,g.capacity])),TABLE_ASSIGNMENTS);
  const day=(await db.query(`select to_char(d,'YYYY-MM-DD') as booking_day from generate_series((now() at time zone 'Europe/Rome')::date+2,(now() at time zone 'Europe/Rome')::date+8,interval '1 day') d where extract(isodow from d)<>1 limit 1`)).rows[0].booking_day;
  const status=async people=>(await db.query('select private.online_day_status($1,$2,NULL) s',[day,people])).rows[0].s;
  const insert=async (people,tables='',source='agenda',type='normale')=>(await db.query(`insert into bookings(name,phone,booking_date,booking_time,party_size,tables,source,booking_type,privacy_accepted_at,privacy_version)
    values('Mario Rossi','+393331234567',$1,'20:00',$2,$3,$4,$5,now(),'2026-10-04-online-v1') returning *`,[day,people,tables,source,type])).rows[0];
  assert.equal(await status(6),'available');
  let saved=await insert(6,'15+16+17','booking');
  assert.equal(saved.tables,'');assert.equal(saved.status,'confirmed');assert.equal(saved.reminder_status,'skipped');
  const history=(await db.query('select * from booking_history')).rows;
  assert.equal(history.length,1);assert.equal(history[0].action,'booking_created');
  assert.deepEqual(Object.keys(history[0].new_data).sort(),['booking_date','booking_time','booking_type','party_size','status','tables']);
  assert.equal(await status(6),'full'); // sole six-person group already needed by unassigned booking
  await assert.rejects(insert(6,'','booking'),/Disponibilità cambiata/);
  assert.equal((await db.query('select count(*) n from bookings')).rows[0].n,1);

  const manual=await insert(2);
  await assert.rejects(db.query("update bookings set tables='15+16' where id=$1",[manual.id]),/non resterebbe posto/);
  await assert.rejects(db.query("update bookings set tables='15+16+17' where id=$1",[manual.id]),/non resterebbe posto/);
  assert.equal((await db.query('select tables from bookings where id=$1',[manual.id])).rows[0].tables,'');
  await db.query("update bookings set tables='12' where id=$1",[manual.id]);
  // Closing online intake does not block assignment of existing bookings.
  await db.query('insert into online_booking_closures values($1)',[day]);
  await db.query("update bookings set tables='22' where id=$1",[manual.id]);
  await db.exec('delete from online_booking_closures;');
  await db.exec('delete from booking_history;delete from bookings;');
  // Daily occupancy has no two-hour turnover, completed/arrived still block.
  const fixed=await insert(2,'12');
  await db.query(`update bookings set status='arrived' where id=$1`,[fixed.id]);
  assert.equal(await status(2),'available');
  await insert(2,'13+14');await insert(3,'10+11');await insert(4,'15+16');await insert(2,'17');await insert(4,'18+19');await insert(4,'20+21');await insert(2,'22');await insert(2,'23');
  assert.equal(await status(1),'full');
  await db.exec('delete from bookings;');
  await insert(2,'unknown');assert.equal(await status(2),'unverified');
  await db.exec('delete from bookings;');
  await insert(2,'12');await insert(2,'12');assert.equal(await status(2),'unverified');
  await db.exec('delete from bookings;');
  await insert(4,'15+16');await insert(2,'18');await insert(4,'18+19');assert.equal(await status(2),'unverified');
  await db.exec('delete from bookings;');
  await insert(24,'','agenda','dopocena');assert.equal(await status(1),'available');assert.equal(await status(2),'full');
  await insert(1);await assert.rejects(insert(1),/25 coperti/);
  await db.exec('delete from bookings;');
  await db.query('insert into online_booking_closures values($1)',[day]);
  assert.equal(await status(2),'closed');await assert.rejects(insert(2,'','booking'),/Disponibilità cambiata/);
  await insert(2); // manual agenda remains possible under daily online closure
  await db.exec('delete from bookings;delete from online_booking_closures;');
  await assert.rejects(db.query(`insert into bookings(name,phone,booking_date,booking_time,party_size,source) values('Mario Rossi','+393331234567',$1,'20:00',2,'booking')`,[day]),/privacy obbligatoria/);
  // Equal-sized parties are symmetric: do not enumerate permutations.
  await insert(6,'15+16+17');
  for(let i=0;i<7;i++) await insert(1);
  assert.equal(await status(1),'full');
  await db.exec('delete from bookings;');
  saved=await insert(2,'','booking');
  await db.query(`insert into private.online_booking_receipts(request_id,booking_id,fingerprint) values('11111111-1111-4111-8111-111111111111',$1,'hash')`,[saved.id]);
  await assert.rejects(db.query(`insert into private.online_booking_receipts(request_id,booking_id,fingerprint) values('11111111-1111-4111-8111-111111111111',$1,'hash')`,[saved.id]),/duplicate key/);
  for(const role of ['anon','authenticated','service_role']) {
   await db.exec(`set role ${role}`);
   await assert.rejects(db.query('select * from private.online_booking_receipts'),/permission denied/);
   await assert.rejects(db.query('select private.online_day_status($1,2,NULL)',[day]),/permission denied/);
   await db.exec('reset role');
  }
 } finally {await db.close();}
});
