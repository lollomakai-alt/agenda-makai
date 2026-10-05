import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

test('communications migration safety and current-booking claim regressions', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema private;
      create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
      create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
      grant usage on schema auth,private to authenticated,service_role;
      create table bookings(id bigint primary key,name text,phone text default '',email text default '',booking_date text,
        booking_time text,party_size integer,tables text default '',notes text default '',status text default 'confirmed',
        source text default 'agenda',reminder_status text,booking_type text default 'normale');
      create table booking_history(id bigint generated always as identity primary key,booking_id bigint,action text,
        old_data jsonb,new_data jsonb,created_at timestamptz default now());
      grant select,insert,update on bookings to authenticated;
      set request.jwt.claims='{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}';`);
    for (const file of ['booking-status.sql','booking-history.sql','booking-edit.sql','table-conflicts.sql',
      'after-dinner-bookings.sql','booking-requests.sql']) {
      await db.exec(await readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8'));
    }
    const migration = await readFile(new URL('../supabase/agenda-communications.sql', import.meta.url), 'utf8');
    const date = (await db.query(`select to_char(d,'YYYY-MM-DD') as day from
      generate_series((now() at time zone 'Europe/Rome')::date+1,(now() at time zone 'Europe/Rome')::date+7,'1 day') d
      where extract(isodow from d)<>1 limit 1`)).rows[0].day;
    const insert = async (id = 1, email = 'mario@example.com') => db.query(`
      insert into bookings(id,name,phone,email,booking_date,booking_time,party_size)
      values($1,'Mario Rossi','+393331234567',$2,$3,'20:00',2)`, [id,email,date]);
    const role = async (name, fn) => {
      await db.exec(`set role ${name}`);
      try { return await fn(); } finally { await db.exec('reset role'); }
    };
    const rows = async () => (await db.query('select * from booking_communications order by id')).rows;
    const prepare = (id = 1, channel = 'email') => role('service_role', async () =>
      (await db.query('select admin_prepare_booking_communication($1,$2) r', [id,channel])).rows[0].r);
    const claim = id => role('service_role', async () =>
      (await db.query('select claim_booking_email($1) r', [id])).rows[0].r);
    const finish = (id, state, provider = null) => role('service_role', () =>
      db.query('select finish_booking_email($1,$2,$3,null)', [id,state,provider]));
    const clear = () => db.exec(`truncate bookings,booking_requests,booking_history,
      booking_communications,booking_communication_logs restart identity cascade`);

    await t.test('migration sends nothing, is repeatable and neither backfills nor changes bookings', async () => {
      await insert(99);
      const before = (await db.query('select row_to_json(b) b from bookings b')).rows;
      await db.exec(migration); await db.exec(migration);
      assert.deepEqual((await db.query('select row_to_json(b) b from bookings b')).rows, before);
      assert.equal((await rows()).length, 0);
      assert.equal((await db.query('select count(*)::int n from booking_communication_logs')).rows[0].n, 0);
      assert.doesNotMatch(migration, /\b(net\.http|http_post|resend|cron\.schedule)\b/i);
      await clear();
    });

    const nextDate = (await db.query(`select to_char(d,'YYYY-MM-DD') as day from
      generate_series($1::date+1,$1::date+7,'1 day') d where extract(isodow from d)<>1 limit 1`,[date])).rows[0].day;
    for (const [field,value] of [['booking_date',nextDate],['booking_time','20:30'],['party_size',3],['tables','12']]) {
      await t.test(`manual ${field} update replaces old snapshot with exactly one updated event`, async () => {
        await clear(); await insert();
        const previous = (await rows())[0];
        const expected = (await db.query(`select jsonb_build_object('booking_date',booking_date,'booking_time',booking_time,
          'party_size',party_size,'tables',tables,'notes',notes) e from bookings where id=1`)).rows[0].e;
        await role('authenticated', () => db.query('select admin_update_booking(1,$1,$2)', [{[field]:value},expected]));
        const all = await rows();
        assert.equal(all.length, 2); assert.equal(all[0].status, 'superseded');
        assert.equal(all[1].kind, 'updated'); assert.equal(all[1].snapshot[field], value);
        assert.equal(await claim(previous.id), null);
        assert.equal((await prepare()).id, all[1].id);
        assert.equal((await prepare()).id, all[1].id);
        assert.equal((await rows()).length, 2);
        assert.equal((await claim(all[1].id)).status, 'sending');
        assert.equal(await claim(all[1].id), null);
        await finish(all[1].id,'accepted','provider-id');
        assert.equal(await claim(all[1].id), null);
      });
    }

    for (const state of ['arrived','completed','no_show']) {
      await t.test(`${state}: confirmation invalidated, preparation and claim blocked`, async () => {
        await clear(); await insert();
        const id = (await rows())[0].id;
        await db.query('update bookings set status=$1 where id=1',[state]);
        assert.equal((await rows())[0].status,'superseded');
        assert.equal((await rows()).length,1);
        assert.equal(await claim(id),null);
        await assert.rejects(prepare(),/Stato non comunicabile/);
        // Prove claim rechecks booking even if a server accidentally restores queued.
        await db.query(`update booking_communications set status='queued' where id=$1`,[id]);
        assert.equal(await claim(id),null);
        assert.equal((await rows())[0].error_code,'stale_booking');
      });
    }

    await t.test('cancelled -> confirmed creates a fresh confirmation, preserving accepted cancellation history', async () => {
      await clear(); await insert();
      await db.exec(`update bookings set status='cancelled' where id=1`);
      const cancelled = await prepare(); assert.equal(cancelled.kind,'cancelled');
      assert.equal((await claim(cancelled.id)).kind,'cancelled');
      await finish(cancelled.id,'accepted','cancel-id');
      await db.exec(`update bookings set status='confirmed' where id=1`);
      const confirmation = await prepare(); assert.equal(confirmation.kind,'confirmation');
      assert.notEqual(confirmation.id,cancelled.id);
      assert.equal((await prepare()).id,confirmation.id);
      assert.equal(await claim(cancelled.id),null);
      assert.equal((await rows()).find(row=>row.id===cancelled.id).status,'accepted');
      assert.equal((await claim(confirmation.id)).kind,'confirmation');
    });

    await t.test('claim rechecks snapshot and recipient against booking', async () => {
      for (const tamper of [{snapshot:{name:'obsolete'}},{recipient:'wrong@example.com'}]) {
        await clear(); await insert();
        const id = (await rows())[0].id;
        const field = Object.keys(tamper)[0];
        await db.query(`update booking_communications set ${field}=$1 where id=$2`,[tamper[field],id]);
        assert.equal(await claim(id),null);
        assert.equal((await rows())[0].status,'superseded');
        assert.equal((await db.query(`select status from booking_communication_logs where communication_id=$1 order by id desc limit 1`,[id])).rows[0].status,'superseded');
      }
    });

    await t.test('claim coordinates two versions of one booking while the earlier email is sending', async () => {
      await clear(); await insert();
      const original = (await rows())[0];
      assert.equal((await claim(original.id)).status,'sending');
      await db.exec(`update bookings set booking_time='20:30' where id=1`);
      const updated = await prepare(); assert.equal(updated.kind,'updated');
      assert.equal(await claim(updated.id),null);
      await finish(original.id,'accepted','first-id');
      assert.equal((await claim(updated.id)).status,'sending');
      await finish(updated.id,'unknown'); assert.equal(await claim(updated.id),null);
    });

    await t.test('queued competing claim calls have one winner and one sending log', async () => {
      await clear(); await insert();
      const id = (await prepare()).id;
      // PGlite serializes its one SQL session; actual HTTP concurrency is covered
      // in backend tests. Here the real SQL must still admit exactly one claim.
      await role('service_role', async () => {
        const results = await Promise.all([
          db.query('select claim_booking_email($1) r', [id]),
          db.query('select claim_booking_email($1) r', [id]),
        ]);
        assert.equal(results.filter(result => result.rows[0].r !== null).length, 1);
        assert.equal((await db.query(`select count(*)::int n from booking_communication_logs
          where communication_id=$1 and status='sending'`, [id])).rows[0].n, 1);
        assert.equal((await rows())[0].attempts, 1);
      });
      await finish(id, 'unknown');
      assert.equal(await claim(id), null);
    });

    await t.test('approved notes keep their existing updated notification without duplicating operational updates', async () => {
      await clear(); await insert();
      await role('authenticated',async()=>{
        const request=(await db.query(`select admin_create_booking_request(1,'note','"Nota approvata"') r`)).rows[0].r;
        await db.query(`select admin_review_booking_request($1,'approved')`,[request.id]);
      });
      assert.equal((await rows()).length,2);
      assert.equal((await rows())[1].kind,'updated');
      assert.equal((await rows())[0].status,'superseded');
    });

    await t.test('missing email is skipped; correcting it queues a current event', async () => {
      await clear(); await insert(1,'');
      const skipped = await prepare(); assert.equal(skipped.status,'skipped');
      assert.equal(await claim(skipped.id),null);
      await db.exec(`update bookings set email='valid@example.com' where id=1`);
      const current = await prepare(); assert.equal(current.status,'queued');
      assert.equal(current.recipient,'valid@example.com');
      assert.equal((await rows())[0].status,'superseded');
      assert.equal((await claim(current.id)).status,'sending');
    });

    await t.test('frontend admin and anon cannot read or execute operations; logs remain append-only for service_role', async () => {
      await clear(); await insert();
      for (const name of ['anon','authenticated']) {
        await role(name, async () => {
          for (const sql of ['select * from booking_communications','select * from booking_communication_logs',
            `select admin_prepare_booking_communication(1,'email')`, `select claim_booking_email(1)`,
            `select finish_booking_email(1,'accepted','x',null)`, `update booking_communications set status='accepted'`,
            `select nextval('booking_communications_id_seq')`]) {
            await assert.rejects(db.query(sql),/permission denied/);
          }
        });
      }
      await role('service_role', async () => {
        assert.equal((await db.query('select * from booking_communications')).rows.length,1);
        await assert.rejects(db.exec('delete from booking_communications'),/permission denied/);
        await assert.rejects(db.exec("update booking_communication_logs set status='failed'"),/permission denied/);
        await assert.rejects(db.exec('delete from booking_communication_logs'),/permission denied/);
        await assert.rejects(db.query(`select finish_booking_email(1,null,null,null)`),/Esito non valido/);
      });
      assert.deepEqual((await db.query(`select relrowsecurity rls from pg_class where relname in ('booking_communications','booking_communication_logs')`)).rows.map(row=>row.rls),[true,true]);
      assert.equal((await db.query(`select count(*)::int n from pg_policies where tablename in ('booking_communications','booking_communication_logs')`)).rows[0].n,0);
      assert.equal((await prepare(1,'whatsapp')).status,'opened');
    });

    await t.test('rollback and migration rerun preserve existing rows and logs', async () => {
      await clear(); await insert();
      const before = await rows();
      await db.exec(`begin;update bookings set booking_time='20:30' where id=1;rollback;`);
      assert.deepEqual(await rows(),before);
      const logs = (await db.query('select * from booking_communication_logs order by id')).rows;
      await db.exec(migration);
      assert.deepEqual(await rows(),before);
      assert.deepEqual((await db.query('select * from booking_communication_logs order by id')).rows,logs);
    });
  } finally { await db.close(); }
});
