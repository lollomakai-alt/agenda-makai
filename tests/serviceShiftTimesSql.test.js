import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('service shift migration: dinner ends at 22:30 and after-dinner runs 23:00-00:00', async () => {
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

    await db.exec(await readFile(
      new URL('../supabase/migrations/20261030120000_service_shift_times.sql', import.meta.url),
      'utf8'
    ));

    const valid = async (service, slot) => (await db.query(
      'select private.valid_service_slot($1,$2) valid', [service, slot]
    )).rows[0].valid;

    for (const slot of ['19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00', '22:30']) {
      assert.equal(await valid('normale', slot), true, `cena ${slot}`);
    }
    assert.equal(await valid('normale', '23:00'), false);
    for (const slot of ['23:00', '23:30', '00:00']) {
      assert.equal(await valid('dopocena', slot), true, `dopocena ${slot}`);
    }
    for (const slot of ['22:00', '22:30', '23:15', '00:30']) {
      assert.equal(await valid('dopocena', slot), false, `dopocena non valido ${slot}`);
    }

    const slotAt = async (slot, service) => (await db.query(
      "select to_char(private.service_slot_at('2026-10-10',$1,$2) at time zone 'Europe/Rome','YYYY-MM-DD HH24:MI') value",
      [slot, service]
    )).rows[0].value;
    assert.equal(await slotAt('23:00', 'dopocena'), '2026-10-10 23:00');
    assert.equal(await slotAt('00:00', 'dopocena'), '2026-10-11 00:00');
    assert.equal(await slotAt('22:30', 'dopocena'), null);
    assert.equal(await slotAt('22:30', 'normale'), '2026-10-10 22:30');

    const service = async (time) => (await db.query(
      'select private.service_capacity($1,$2) value', ['2026-10-10', time]
    )).rows[0].value.service;
    assert.equal(await service('22:30'), 'normale');
    assert.equal(await service('23:00'), 'dopocena');
    assert.equal(await service('00:00'), 'dopocena');

    const create = async (time) => db.query(
      `select public.admin_create_after_dinner_booking(
        'Mario Rossi','+393331234567','', '2026-11-03', $1, 2, '', '12'
      ) result`, [time]
    );
    assert.equal((await create('23:00')).rows[0].result.booking_type, 'dopocena');
    await assert.rejects(create('22:30'), /dalle 23:00/);
    await assert.rejects(create('00:30'), /dalle 23:00/);
  } finally {
    await db.close();
  }
});
