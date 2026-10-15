import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const file = path => readFile(new URL(path, import.meta.url), 'utf8');
const baselineHash = 'faff59599c266226f22b9e3609470a07';
const firstAdmin = '11111111-1111-1111-1111-111111111111';
const secondAdmin = '22222222-2222-2222-2222-222222222222';

test('online notice migration preserves assignments, personal read/archive states and exact rollback', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.jwt() returns jsonb language sql as $$ select current_setting('request.jwt.claims',true)::jsonb $$;
      create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.bookings(id bigint primary key,booking_date text,booking_time text,status text,source text,tables text,created_at timestamptz default now());
      create table public.booking_requests(id bigint primary key,booking_id bigint,request_type text,status text,created_at timestamptz default now());
      create table public.booking_history(id bigint primary key,booking_id bigint,action text,old_data jsonb,new_data jsonb,created_at timestamptz default now());
      create table public.admin_notification_archives(user_id uuid default auth.uid(),notification_id text,archived_at timestamptz default now(),primary key(user_id,notification_id));
      alter table public.admin_notification_archives enable row level security;
      grant select,insert on public.admin_notification_archives to authenticated;
      create policy own_admin_archives on public.admin_notification_archives to authenticated
        using(auth.uid()=user_id and auth.jwt()->'app_metadata'->>'role'='admin')
        with check(auth.uid()=user_id and auth.jwt()->'app_metadata'->>'role'='admin');
      alter table public.bookings enable row level security;
      alter table public.booking_requests enable row level security;
      alter table public.booking_history enable row level security;
      grant select on public.bookings,public.booking_requests,public.booking_history to authenticated;
      create policy admin_bookings on public.bookings for select to authenticated using(auth.jwt()->'app_metadata'->>'role'='admin');
      create policy admin_requests on public.booking_requests for select to authenticated using(auth.jwt()->'app_metadata'->>'role'='admin');
      create policy admin_history on public.booking_history for select to authenticated using(auth.jwt()->'app_metadata'->>'role'='admin');
      create function public.admin_pending_dopocena_notice_events()
        returns table(id text,booking_id bigint,booking_date text,kind text,priority text,message text,created_at timestamptz)
        language sql as $$ select 'dopocena:1',null::bigint,to_char((now() at time zone 'Europe/Rome')::date+3,'YYYY-MM-DD'),'dopocena_request','normal','Richiesta DOPOCENA',now() $$;
    `);
    await db.exec(await file('../supabase/admin-notifications.sql'));
    await db.exec(await file('./fixtures/admin-notifications-production-20261015.sql'));
    const customerSql = await file('../supabase/migrations/20261015012424_customer_booking_management.sql');
    await db.exec(customerSql.slice(customerSql.indexOf('create or replace function public.admin_archive_notification('),customerSql.indexOf('create or replace function public.admin_propose_booking_alternative(')));
    await db.exec(`
      insert into public.bookings(id,booking_date,booking_time,status,source,tables,created_at)
      select id,to_char((now() at time zone 'Europe/Rome')::date+offset_days,'YYYY-MM-DD'),'20:00',status,source,tables,now()-interval '7 days'
      from (values (1,3,'confirmed','booking','12'),(2,3,'confirmed','booking',''),
        (3,3,'cancelled','booking',''),(4,-1,'confirmed','booking',''),(5,3,'confirmed','agenda',''))
        as seeds(id,offset_days,status,source,tables);
    `);
    const definition = async () => (await db.query("select pg_get_functiondef('public.admin_list_notifications()'::regprocedure) as definition")).rows[0].definition;
    const hash = async () => (await db.query("select md5(pg_get_functiondef('public.admin_list_notifications()'::regprocedure)) as hash")).rows[0].hash;
    const before = await definition();
    assert.equal(await hash(), baselineHash);
    const bookingsBefore = (await db.query('select * from public.bookings order by id')).rows;
    const migration = await file('../supabase/migrations/20261015121705_online_booking_notification_visibility.sql');
    const rollback = await file('../supabase/online-booking-notification-visibility-rollback.sql');
    await db.exec(migration);
    const patched = await definition();
    await db.exec(migration);
    assert.equal(await definition(),patched);
    assert.deepEqual((await db.query('select * from public.bookings order by id')).rows,bookingsBefore);

    const asAdmin = async id => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,app_metadata:{role:'admin'}})]);
      await db.exec('set role authenticated');
    };
    const feed = async () => (await db.query('select * from public.admin_list_notifications()')).rows;
    await asAdmin(firstAdmin);
    let notices = await feed();
    assert.deepEqual(notices.filter(n=>n.kind==='online_booking').map(n=>n.id),['online:1','online:2']);
    assert.ok(notices.some(n=>n.kind==='dopocena_request'));
    assert.equal(notices.find(n=>n.id==='online:1').message,'Nuova prenotazione online');
    await db.query('select public.admin_mark_notification_read($1)',['online:1']);
    assert.ok((await feed()).find(n=>n.id==='online:1').read_at);
    await db.exec("reset role; update public.bookings set tables='13+14' where id=2; set role authenticated");
    assert.ok((await feed()).some(n=>n.id==='online:2'));
    const archived = (await db.query('select public.admin_archive_notification($1) as result',['online:1'])).rows[0].result;
    assert.ok(archived.archived_at);
    assert.ok(!(await feed()).some(n=>n.id==='online:1'));
    await asAdmin(secondAdmin);
    notices = await feed();
    assert.equal(notices.find(n=>n.id==='online:1').read_at,null);
    assert.equal((await db.query('select * from public.admin_notification_archives')).rows.length,0);
    await assert.rejects(db.query('insert into public.admin_notification_archives(user_id,notification_id) values($1,$2)',[firstAdmin,'online:2']),/row-level security/);
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:secondAdmin,app_metadata:{role:'staff'}})]);
    await assert.rejects(feed,/Accesso riservato/);
    await db.exec('reset role; set role anon');
    await assert.rejects(feed,/permission denied/);
    await db.exec('reset role');

    // Both directions must reject unrelated changes instead of overwriting them.
    await db.exec(patched.replace('return query','-- unrelated change\n  return query'));
    await assert.rejects(db.exec(migration),/Funzione notifiche diversa/);
    await db.exec('rollback');
    await assert.rejects(db.exec(rollback),/Funzione notifiche cambiata/);
    await db.exec('rollback');
    await db.exec(patched);
    await db.exec(rollback);
    assert.equal(await definition(),before);
    assert.equal(await hash(),baselineHash);
    await db.exec(rollback);
    assert.equal((await db.query('select count(*)::int as count from public.admin_notification_reads')).rows[0].count,1);
    assert.equal((await db.query('select count(*)::int as count from public.admin_notification_archives')).rows[0].count,1);
    assert.equal((await db.query('select tables from public.bookings where id=2')).rows[0].tables,'13+14');
  } finally {
    await db.close();
  }
});
