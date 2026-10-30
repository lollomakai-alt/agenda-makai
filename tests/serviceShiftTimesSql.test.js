import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('three-shift migration: dinner at 19:00/21:30 and after-dinner at 23:00', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema private;

      create function auth.jwt()
      returns jsonb language sql
      as $$ select '{"app_metadata":{"role":"admin"}}'::jsonb $$;

      create table public.bookings(
        id bigint generated always as identity primary key,
        name text,
        phone text,
        email text,
        booking_date text,
        booking_time text,
        party_size integer,
        notes text default '',
        tables text default '',
        status text default 'confirmed',
        source text default 'agenda',
        reminder_status text default 'skipped',
        booking_type text default 'normale'
      );

      create function private.service_capacity_for_type(day text, reference_time text, service_type text, exclude_id bigint default null)
      returns jsonb language sql stable
      as $$ select jsonb_build_object('service', service_type) $$;
    `);

    for (const file of [
      '20261030120000_service_shift_times.sql',
      '20261030140000_three_shifts.sql',
    ]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }

    const valid = async (service, slot) => (await db.query(
      'select private.valid_service_slot($1,$2) valid', [service, slot]
    )).rows[0].valid;

    for (const slot of ['19:00', '21:30']) {
      assert.equal(await valid('normale', slot), true, `cena ${slot}`);
    }
    for (const slot of ['18:30', '19:30', '20:00', '22:30', '23:00']) {
      assert.equal(await valid('normale', slot), false, `cena non valida ${slot}`);
    }
    assert.equal(await valid('dopocena', '23:00'), true);
    for (const slot of ['22:00', '22:30', '23:30', '00:00', '00:30']) {
      assert.equal(await valid('dopocena', slot), false, `dopocena non valido ${slot}`);
    }

    const slotAt = async (slot, service) => (await db.query(
      "select to_char(private.service_slot_at('2026-10-10',$1,$2) at time zone 'Europe/Rome','YYYY-MM-DD HH24:MI') value",
      [slot, service]
    )).rows[0].value;
    assert.equal(await slotAt('19:00', 'normale'), '2026-10-10 19:00');
    assert.equal(await slotAt('21:30', 'normale'), '2026-10-10 21:30');
    assert.equal(await slotAt('20:00', 'normale'), null);
    assert.equal(await slotAt('23:00', 'dopocena'), '2026-10-10 23:00');
    assert.equal(await slotAt('23:30', 'dopocena'), null);
    assert.equal(await slotAt('00:00', 'dopocena'), null);

    const service = async (time) => (await db.query(
      'select private.service_capacity($1,$2) value', ['2026-10-10', time]
    )).rows[0].value.service;
    assert.equal(await service('19:00'), 'normale');
    assert.equal(await service('21:30'), 'normale');
    assert.equal(await service('22:30'), 'normale');
    assert.equal(await service('23:00'), 'dopocena');

    const create = async (time) => db.query(
      `select public.admin_create_after_dinner_booking(
        'Mario Rossi','+393331234567','', '2026-11-03', $1, 2, '', '12'
      ) result`, [time]
    );
    assert.equal((await create('23:00')).rows[0].result.booking_type, 'dopocena');
    for (const time of ['22:30', '23:30', '00:00']) {
      await assert.rejects(create(time), /alle 23:00/);
    }
  } finally {
    await db.close();
  }
});

test('planner and waitlist migration use only the three shift times', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261030140100_three_shifts_planner.sql', import.meta.url), 'utf8');
  assert.match(sql, /ARRAY\['19:00','21:30'\]/);
  assert.match(sql, /new\.booking_time !~ '\^\(19:00\|21:30\)\$'/);
  assert.match(sql, /\(values \('19:00'\),\('21:30'\)\)/);
  assert.doesNotMatch(sql, /22:30/);
  assert.doesNotMatch(sql, /23:30/);
});

test('online closure applies to after-dinner as well as dinner', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema private;

      create table public.online_booking_closures(booking_date date primary key);
      create table public.bookings(
        id bigint generated always as identity primary key,
        booking_date text,
        booking_type text,
        party_size integer,
        status text default 'confirmed'
      );

      create function private.service_slot_at(day text, slot text, service text)
      returns timestamptz language sql stable
      as $$ select (day || ' ' || slot)::timestamp at time zone 'Europe/Rome' $$;

      create function private.dinner_physical_capacity()
      returns integer language sql immutable as $$ select 26 $$;

      create function private.choose_online_dinner_unit(day text, people integer, exclude_id bigint default null)
      returns text language sql stable as $$ select '12'::text $$;
    `);

    await db.exec(await readFile(
      new URL('../supabase/migrations/20261030140300_online_closure_all_services.sql', import.meta.url),
      'utf8'
    ));
    await db.exec("insert into public.online_booking_closures(booking_date) values ('2026-11-20')");

    const status = async (day, slot, service) => (await db.query(
      'select private.online_slot_status($1,$2,2,$3) status', [day, slot, service]
    )).rows[0].status;

    assert.equal(await status('2026-11-20', '19:00', 'normale'), 'closed');
    assert.equal(await status('2026-11-20', '23:00', 'dopocena'), 'closed');
    assert.equal(await status('2026-11-21', '19:00', 'normale'), 'available');
    assert.equal(await status('2026-11-21', '23:00', 'dopocena'), 'manual_review');
    assert.equal(await status('2026-11-23', '19:00', 'normale'), 'closed');
  } finally {
    await db.close();
  }
});
