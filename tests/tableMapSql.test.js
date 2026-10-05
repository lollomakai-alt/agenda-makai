import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { assignMapTable } from '../src/utils/tableMap.js';

test('map assignment against Postgres: existing editor, grouped tables, history, raced conflict rollback and stale record',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
      create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
      create function auth.uid() returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;
      grant usage on schema auth,private to authenticated;
      create table bookings(id bigint primary key,name text,phone text,email text,booking_date text,booking_time text,party_size integer,tables text,notes text,status text,source text,reminder_status text,booking_type text default 'normale');
      create table booking_history(id bigint generated always as identity primary key,booking_id bigint,action text,old_data jsonb,new_data jsonb,created_at timestamptz default now());
      grant select,insert,update on bookings to authenticated;
      set request.jwt.claims='{"app_metadata":{"role":"admin"}}';`);
    for(const file of ['booking-status.sql','booking-history.sql','booking-edit.sql','table-conflicts.sql','after-dinner-bookings.sql','temporal-table-conflicts.sql','manual-table-assignment.sql']) await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
    const date=(await db.query(`select to_char(d,'YYYY-MM-DD') as day from generate_series((now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d where extract(isodow from d)<>1 limit 1`)).rows[0].day;
    await db.query(`insert into bookings(id,name,phone,email,booking_date,booking_time,party_size,tables,notes,status,booking_type) values(42,'Mario Rossi','private','private',$1,'20:00',2,'','Seggiolone','confirmed','normale'),(43,'Altro Cliente','','',$1,'20:30',2,'12','','confirmed','normale')`,[date]);
    await db.exec('set role authenticated');
    const client={rpc:async(name,args)=>{
      try {return {data:(await db.query(`select ${name}($1,$2,$3) as r`,[args.booking_id,args.changes,args.expected])).rows[0].r};}
      catch(error){return {error};}
    }};
    const original=(await db.query('select * from bookings where id=42')).rows[0];
    const result=await assignMapTable(client,original,'10+11',[],'10');
    assert.equal(result.booking.tables,'10+11');
    const saved=(await db.query('select * from bookings where id=42')).rows[0];
    assert.deepEqual(saved,{...original,tables:'10+11'});
    assert.equal((await db.query('select count(*)::int as n from booking_history where booking_id=42')).rows[0].n,1);
    await db.exec('reset role');
    await db.query('update bookings set party_size=5 where id=42');
    await db.exec('set role authenticated');
    const five=(await db.query('select * from bookings where id=42')).rows[0];
    await assert.rejects(client.rpc('admin_update_booking',{booking_id:42,changes:{tables:'15+16'},expected:{booking_date:five.booking_date,booking_time:five.booking_time,party_size:5,tables:five.tables,notes:five.notes}}).then(r=>{if(r.error)throw r.error;}),/Capienza/);
    const manual=await assignMapTable(client,five,'15+16',[],'15');
    assert.equal(manual.booking.tables,'15+16');
    const illegal=await client.rpc('admin_assign_booking_tables',{booking_id:42,changes:{party_size:4},expected:{}});
    assert.match(illegal.error.message,/Campo non modificabile/);
    await db.exec('reset role');
    await db.query('update bookings set party_size=2,tables=$1 where id=42',['10+11']);
    await db.query('delete from booking_history where booking_id=42 and id>(select min(id) from booking_history where booking_id=42)');
    await db.exec('set role authenticated');
    // Client snapshot missed a competing booking: real trigger must still reject it.
    await assert.rejects(assignMapTable(client,saved,'12',[],'12'),/già assegnato/);
    assert.deepEqual((await db.query('select * from bookings where id=42')).rows[0],saved);
    assert.equal((await db.query('select count(*)::int as n from booking_history where booking_id=42')).rows[0].n,1);
    await assert.rejects(assignMapTable(client,original,'22',[],'22'),/cambiata/);
    assert.equal((await db.query('select count(*)::int as n from bookings')).rows[0].n,2);
  } finally {await db.close();}
});
