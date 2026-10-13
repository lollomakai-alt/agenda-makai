import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

test('CENA e DOPOCENA: secondo turno SQL', async () => {
  const db = new PGlite();

  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE SCHEMA private;

      CREATE FUNCTION auth.jwt()
      RETURNS jsonb LANGUAGE sql
      AS $$ SELECT '{}'::jsonb $$;

      CREATE TABLE bookings (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        booking_date text,
        booking_time text,
        booking_type text,
        tables text,
        status text DEFAULT 'confirmed'
      );

      CREATE FUNCTION private.booking_scheduled_at(day text, booking_time text)
      RETURNS timestamptz LANGUAGE sql STABLE
      AS $$
        SELECT (day || ' ' || booking_time)::timestamp
               AT TIME ZONE 'Europe/Rome'
      $$;

      CREATE FUNCTION private.booking_intervals_overlap(
        left_day text, left_time text, right_day text, right_time text
      )
      RETURNS boolean LANGUAGE sql STABLE
      AS $$ SELECT left_day = right_day $$;
    `);

    await db.exec(
      await readFile(
        new URL('../supabase/dinner-after-dinner-turnover.sql', import.meta.url),
        'utf8'
      )
    );

    await db.exec(`
      CREATE TRIGGER z_check_daily_table_conflicts
      AFTER INSERT OR UPDATE ON bookings
      FOR EACH ROW
      EXECUTE FUNCTION private.check_daily_table_conflicts();
    `);

    const day = '2026-10-10';

    const insert = async (time, type) => db.query(
      `INSERT INTO bookings
       (booking_date, booking_time, booking_type, tables)
       VALUES ($1,$2,$3,'20+21')
       RETURNING id`,
      [day, time, type]
    );

    const clear = () => db.exec('DELETE FROM bookings');

    await insert('19:00', 'normale');
    await assert.rejects(
      insert('22:00', 'dopocena'),
      /Tavolo già assegnato/
    );

    await clear();

    await insert('20:00', 'normale');
    await insert('22:30', 'dopocena');
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n,
      2,
      '150 minuti esatti devono consentire il riuso del tavolo'
    );

    await clear();

    await insert('20:30', 'normale');
    await assert.rejects(
      insert('22:30', 'dopocena'),
      /Tavolo già assegnato/
    );

    await clear();

    await insert('20:00', 'normale');
    await assert.rejects(
      insert('22:00', 'dopocena'),
      /Tavolo già assegnato/
    );

    await clear();

    await insert('19:00', 'normale');
    await assert.rejects(
      insert('22:00', 'normale'),
      /Tavolo già assegnato/
    );

    await clear();

    await insert('19:00', 'normale');
    await assert.rejects(
      insert('21:30', 'dopocena'),
      /Tavolo già assegnato/
    );

    await clear();

    await insert('22:30', 'dopocena');
    await assert.rejects(
      insert('23:00', 'dopocena'),
      /Tavolo già assegnato/
    );

    await clear();

    await assert.rejects(
      db.query(
        `INSERT INTO bookings (booking_date, booking_time, booking_type, tables)
         VALUES ($1, '20:00', 'normale', '15+16,15+16')`,
        [day]
      ),
      /Lo stesso tavolo non può essere indicato due volte/
    );
    await assert.rejects(
      db.query(
        `INSERT INTO bookings (booking_date, booking_time, booking_type, tables)
         VALUES ($1, '20:00', 'normale', '15+16+17,15+16')`,
        [day]
      ),
      /Lo stesso tavolo fisico non può essere indicato in gruppi diversi/
    );

    await clear();

    await db.query(
      `INSERT INTO bookings (booking_date, booking_time, booking_type, tables)
       VALUES ($1, '19:00', 'normale', '15+16+17')`,
      [day]
    );
    await assert.rejects(
      db.query(
        `INSERT INTO bookings (booking_date, booking_time, booking_type, tables)
         VALUES ($1, '20:00', 'normale', '18')`,
        [day]
      ),
      /Configurazione dei tavoli 15-19 non valida/
    );

    await clear();

    await db.query(
      `INSERT INTO bookings (booking_date, booking_time, booking_type, tables)
       VALUES ($1, '19:00', 'normale', '15+16+17')`,
      [day]
    );
    await db.query(
      `INSERT INTO bookings (booking_date, booking_time, booking_type, tables)
       VALUES ($1, '22:30', 'dopocena', '18+19')`,
      [day]
    );

    await clear();

    await insert('22:30', 'dopocena');
    await insert('19:00', 'normale');

    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n,
      2
    );
  } finally {
    await db.close();
  }
});
