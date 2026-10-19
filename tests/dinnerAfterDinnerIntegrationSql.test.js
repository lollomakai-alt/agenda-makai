import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('SQL manual assignment: capacity, conflicts and CENA/DOPOCENA integration', async () => {
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
      as $$select current_setting('request.jwt.claims',true)::jsonb$$;

      create function auth.uid()
      returns uuid language sql
      as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;

      grant usage on schema auth,private to authenticated;

      create table bookings(
        id bigint generated always as identity primary key,
        name text default 'Cliente',
        phone text,
        email text,
        booking_date text,
        booking_time text,
        party_size integer,
        tables text,
        notes text default '',
        status text default 'confirmed',
        source text default 'agenda',
        reminder_status text,
        reminder_attempts integer default 0,
        created_at timestamptz default now(),
        updated_at timestamptz default now(),
        consenso_ricordami boolean default false,
        consenso_data timestamptz,
        arrived_at timestamptz,
        marketing_visit_counted_at timestamptz,
        user_id uuid,
        privacy_accepted_at timestamptz,
        privacy_version text,
        booking_type text default 'normale'
      );

      create table booking_history(
        id bigint generated always as identity primary key,
        booking_id bigint,
        action text,
        old_data jsonb,
        new_data jsonb,
        created_at timestamptz default now()
      );

      create table online_booking_closures(
        booking_date date primary key
      );

      grant select,insert,update on bookings to authenticated;
      grant usage on sequence bookings_id_seq to authenticated;

      set request.jwt.claims='{"app_metadata":{"role":"admin"}}';
    `);

    // Caricamento delle definizioni SQL originali.
    const sqlFiles = [
      'booking-status.sql',
      'booking-history.sql',
      'booking-edit.sql',
      'table-conflicts.sql',
      'after-dinner-bookings.sql',
      'manual-table-assignment.sql',
      'online-booking.sql',
      'pending-online-capacity.sql',
      'temporal-table-conflicts.sql',
      'manual-assignment-capacity.sql',
      'explicit-table-release.sql'
    ];

    for (const file of sqlFiles) {
      await db.exec(
        await readFile(
          new URL(`../supabase/${file}`, import.meta.url),
          'utf8'
        )
      );
    }

    // Verifica idempotenza della precedente patch.
    await db.exec(
      await readFile(
        new URL('../supabase/explicit-table-release.sql', import.meta.url),
        'utf8'
      )
    );

    // Nuova patch CENA → DOPOCENA.
    const turnoverSql = await readFile(
      new URL('../supabase/dinner-after-dinner-turnover.sql', import.meta.url),
      'utf8'
    );
    assert.match(turnoverSql,/PERFORM pg_advisory_xact_lock\(734512\);[\s\S]*assigned := private\.choose_online_dinner_table/i);
    await db.exec(turnoverSql);
    assert.equal((await db.query("select private.valid_service_slot('dopocena','22:47') valid")).rows[0].valid, true);
    await db.exec(`
      create trigger prepare_booking
      before insert or update on bookings
      for each row execute function private.prepare_booking();
    `);

    const day = (
      await db.query(`
        select to_char(d,'YYYY-MM-DD') as booking_day
        from generate_series(
          (now() at time zone 'Europe/Rome')::date+1,
          (now() at time zone 'Europe/Rome')::date+7,
          '1 day'
        ) d
        where extract(isodow from d)<>1
        limit 1
      `)
    ).rows[0].booking_day;
    assert.equal((await db.query("select private.service_slot_at($1,'22:47','dopocena') is not null valid", [day])).rows[0].valid, true);

    const insert = async (
      people,
      tables = '',
      time = '20:00',
      source = 'agenda',
      type = 'normale'
    ) => (
      await db.query(
        `insert into bookings(
          booking_date,
          booking_time,
          party_size,
          tables,
          source,
          booking_type,
          privacy_accepted_at,
          privacy_version
        )
        values($1,$2,$3,$4,$5,$6,now(),'2026-10-04-online-v1')
        returning *`,
        [day, time, people, tables, source, type]
      )
    ).rows[0];

    const assign = async (booking, tables) => {
      const expected = Object.fromEntries(
        [
          'booking_date',
          'booking_time',
          'party_size',
          'tables',
          'notes'
        ].map(key => [key, booking[key]])
      );

      return (
        await db.query(
          'select admin_assign_booking_tables($1,$2,$3) r',
          [booking.id, { tables }, expected]
        )
      ).rows[0].r.booking;
    };

    const createAfterDinner = async (people, time = '22:30', table = '') => (
      await db.query(
        `select public.admin_create_after_dinner_booking(
          'Cliente Dopocena', '+393331234567', '', $1, $2, $3, '', $4
        ) r`,
        [day, time, people, table]
      )
    ).rows[0].r;

    const automaticDinner = await insert(3, '23', '20:00', 'booking', 'normale');
    assert.equal(automaticDinner.tables, '10+11');
    const untouchedManual = await insert(2);
    assert.equal(untouchedManual.tables, '');
    const untouchedAfterDinner = await createAfterDinner(2);
    assert.equal(untouchedAfterDinner.tables, '');
    await db.exec('delete from bookings;delete from booking_history;');

    // =====================================================
    // TEST ORIGINALI: ASSEGNAZIONE MANUALE
    // =====================================================

    let booking = await insert(3);

    await db.exec('set role authenticated');

    booking = await assign(booking, '10+11');
    assert.equal(booking.tables, '10+11');

    booking = await assign(booking, '15+16');
    assert.equal(booking.tables, '15+16');

    await db.exec('reset role');

    let capacity = (
      await db.query(
        "select private.service_capacity($1,'20:00',null) capacity",
        [day]
      )
    ).rows[0].capacity;

    assert.deepEqual(capacity, {
      total: 26,
      occupied: 4,
      unused: 1,
      remaining: 22,
      people_reserved: 3,
      people_remaining: 22,
      physical_remaining: 22,
      verified: true,
      dinner: {
        total: 26,
        occupied: 4,
        unused: 1,
        remaining: 22,
        people_reserved: 3,
        people_remaining: 22,
        physical_remaining: 22,
        verified: true
      },
      after_dinner: {
        total: 25,
        occupied: 0,
        unused: 0,
        remaining: 25,
        people_reserved: 0,
        people_remaining: 25,
        physical_remaining: null,
        verified: true
      }
    });

    assert.equal(
      (
        await db.query(
          "select private.service_capacity($1,'22:00',null) capacity",
          [day]
        )
      ).rows[0].capacity.dinner.remaining,
      22
    );

    assert.equal(
      (
        await db.query(
          'select count(*)::int n from booking_history where booking_id=$1',
          [booking.id]
        )
      ).rows[0].n,
      2
    );

    const beforeUpgrade = (
      await db.query(
        'select to_jsonb(b) row from bookings b order by id'
      )
    ).rows;

    const historyBeforeUpgrade = (
      await db.query(
        'select to_jsonb(h) row from booking_history h order by id'
      )
    ).rows;

    // Riapplicazione patch precedente.
    await db.exec(
      await readFile(
        new URL('../supabase/explicit-table-release.sql', import.meta.url),
        'utf8'
      )
    );

    // Ripristino della nuova patch dopo l'upgrade.
    await db.exec(
      await readFile(
        new URL('../supabase/dinner-after-dinner-turnover.sql', import.meta.url),
        'utf8'
      )
    );

    assert.deepEqual(
      (
        await db.query(
          'select to_jsonb(b) row from bookings b order by id'
        )
      ).rows,
      beforeUpgrade
    );

    assert.deepEqual(
      (
        await db.query(
          'select to_jsonb(h) row from booking_history h order by id'
        )
      ).rows,
      historyBeforeUpgrade
    );

    for (const status of ['arrived', 'completed']) {
      await db.query(
        'update bookings set status=$1 where id=$2',
        [status, booking.id]
      );

      assert.equal(
        (
          await db.query(
            "select private.service_capacity($1,'23:59',null) capacity",
            [day]
          )
        ).rows[0].capacity.remaining,
        25
      );

      await assert.rejects(
        insert(3, '15+16', '23:59'),
        /stessa giornata/
      );
    }

    await db.query(
      "update bookings set status='confirmed' where id=$1",
      [booking.id]
    );

    const five = await insert(5);

    await db.exec('set role authenticated');

    await assert.rejects(
      assign(five, '20+21'),
      /Capienza insufficiente/
    );

    await db.exec('reset role');

    assert.equal(
      (
        await db.query(
          'select tables from bookings where id=$1',
          [five.id]
        )
      ).rows[0].tables,
      ''
    );

    await db.exec(
      'delete from bookings;delete from booking_history;'
    );

    await insert(6, '15+16+17');

    const small = await insert(2);

    await db.exec('set role authenticated');

    const saved = await assign(small, '18+19');

    await db.exec('reset role');

    assert.equal(saved.tables, '18+19');

    assert.equal(
      (
        await db.query(
          'select private.online_day_status($1,2,null) status',
          [day]
        )
      ).rows[0].status,
      'available'
    );

    await assert.rejects(
      insert(3, '15+16', '21:00'),
      /stessa giornata/
    );

    // CENA → CENA rimane vietata.
    await assert.rejects(
      insert(3, '15+16', '22:00'),
      /stessa giornata/
    );

    await db.exec(
      'delete from bookings;delete from booking_history;'
    );

    for (const [people, tables] of [
      [3, '15+16'],
      [3, '18+19'],
      [3, '20+21'],
      [3, '10+11'],
      [2, '12'],
      [2, '13+14'],
      [2, '17'],
      [2, '22'],
      [2, '23']
    ]) {
      await insert(people, tables);
    }

    assert.deepEqual(
      (
        await db.query(
          "select private.service_capacity($1,'20:00',null) capacity",
          [day]
        )
      ).rows[0].capacity,
      {
        total: 26,
        occupied: 26,
        unused: 4,
        remaining: 0,
        people_reserved: 22,
        people_remaining: 3,
        physical_remaining: 0,
        verified: true,
        dinner: {
          total: 26,
          occupied: 26,
          unused: 4,
          remaining: 0,
          people_reserved: 22,
          people_remaining: 3,
          physical_remaining: 0,
          verified: true
        },
        after_dinner: {
          total: 25,
          occupied: 0,
          unused: 0,
          remaining: 25,
          people_reserved: 0,
          people_remaining: 25,
          physical_remaining: null,
          verified: true
        }
      }
    );

    assert.equal(
      (
        await db.query(
          'select private.online_day_status($1,1,null) status',
          [day]
        )
      ).rows[0].status,
      'full'
    );

    await db.exec(
      'delete from bookings;delete from booking_history;'
    );

    const legacyPending = await insert(6);
    await db.query("update bookings set source='booking' where id=$1",[legacyPending.id]);

    const manual = await insert(3);

    await db.exec('set role authenticated');

    const chosen = await assign(manual, '15+16');

    await db.exec('reset role');

    assert.equal(chosen.id, manual.id);
    assert.equal(chosen.tables, '15+16');

    capacity = (
      await db.query(
        "select private.service_capacity($1,'20:00',null) capacity",
        [day]
      )
    ).rows[0].capacity;

    assert.equal(capacity.occupied, 10);
    assert.equal(capacity.remaining, 16);

    assert.equal(
      (
        await db.query(
          'select name from bookings where id=$1',
          [manual.id]
        )
      ).rows[0].name,
      'Cliente'
    );

    // =====================================================
    // NUOVO TEST: SECONDO TURNO CENA → DOPOCENA
    // =====================================================

    await db.exec(
      'delete from bookings;delete from booking_history;'
    );

    // La vera RPC crea DOPOCENA confermati senza tavolo e applica il
    // contingente separato di 25 persone.
    await db.exec('set role authenticated');
    const rpcBooking = await createAfterDinner(6);
    assert.equal(rpcBooking.booking_time, '22:30');
    assert.equal(rpcBooking.booking_type, 'dopocena');
    assert.equal(rpcBooking.status, 'confirmed');
    assert.equal(rpcBooking.tables, '');
    const minuteBooking = await createAfterDinner(3, '22:47');
    assert.equal(minuteBooking.booking_time, '22:47');
    assert.equal(minuteBooking.tables, '');
    await assert.rejects(createAfterDinner(2, '22:00'), /dalle 22:30/);
    await assert.rejects(createAfterDinner(26), /Numero persone non valido/);
    for (const people of [6, 6, 4]) await createAfterDinner(people);
    await assert.rejects(createAfterDinner(1), /Limite giornaliero di 25 coperti/);
    await db.exec('reset role');

    await db.exec(
      'delete from bookings;delete from booking_history;'
    );

    // CENA: 19:00, 4 persone, tavolo 20+21.
    const dinner = await insert(
      4,
      '20+21',
      '19:00',
      'agenda',
      'normale'
    );

    assert.equal(dinner.tables, '20+21');
    assert.equal(dinner.booking_time, '19:00');

    // DOPOCENA: 22:30, 4 persone, inizialmente senza tavolo.
    const afterDinner = await insert(
      4,
      '',
      '22:30',
      'agenda',
      'dopocena'
    );

    // Assegnazione della stessa unità tramite RPC reale.
    await db.exec('set role authenticated');

    const assignedAfterDinner = await assign(
      afterDinner,
      '20+21'
    );

    await db.exec('reset role');

    assert.equal(
      assignedAfterDinner.tables,
      '20+21',
      'Il DOPOCENA deve poter utilizzare il tavolo della CENA'
    );

    // Entrambe le prenotazioni devono essere conservate.
    const sharedTable = (
      await db.query(
        `select
           id,
           booking_time,
           booking_type,
           tables,
           status
         from bookings
         where booking_date=$1
         order by booking_time`,
        [day]
      )
    ).rows;

    assert.equal(sharedTable.length, 2);

    assert.deepEqual(
      sharedTable.map(row => ({
        time: row.booking_time,
        type: row.booking_type,
        table: row.tables
      })),
      [
        {
          time: '19:00',
          type: 'normale',
          table: '20+21'
        },
        {
          time: '22:30',
          type: 'dopocena',
          table: '20+21'
        }
      ]
    );

    // La CENA originale deve rimanere invariata.
    const dinnerAfterAssignment = (
      await db.query(
        'select * from bookings where id=$1',
        [dinner.id]
      )
    ).rows[0];

    assert.equal(dinnerAfterAssignment.booking_time, '19:00');
    assert.equal(dinnerAfterAssignment.booking_type, 'normale');
    assert.equal(dinnerAfterAssignment.tables, '20+21');
    assert.equal(dinnerAfterAssignment.status, 'confirmed');

    // =====================================================
    // NUOVO TEST: DISPONIBILITÀ CENA
    // =====================================================

    const dinnerCapacity = (
      await db.query(
        "select private.service_capacity($1,'19:00',null) capacity",
        [day]
      )
    ).rows[0].capacity;

    // Il secondo turno non deve rendere non verificabile
    // la disponibilità dei tavoli della CENA.
    assert.equal(
      dinnerCapacity.verified,
      true,
      'Il DOPOCENA non deve invalidare la disponibilità CENA'
    );
    assert.equal(dinnerCapacity.dinner.occupied, 4);
    assert.equal(dinnerCapacity.after_dinner.occupied, 4);
    assert.equal(
      (
        await db.query(
          "select private.service_capacity($1,'22:30',null) capacity",
          [day]
        )
      ).rows[0].capacity.occupied,
      4
    );
    assert.equal(
      (
        await db.query(
          'select private.online_day_status($1,1,null) status',
          [day]
        )
      ).rows[0].status,
      'available',
      'Il DOPOCENA non deve consumare i coperti CENA online'
    );

    // I contingenti delle due tipologie sono indipendenti e atomici.
    await db.exec('delete from bookings;delete from booking_history;');
    await insert(25, '', '22:30', 'agenda', 'dopocena');
    assert.equal(
      (
        await db.query(
          'select private.online_day_status($1,1,null) status',
          [day]
        )
      ).rows[0].status,
      'available',
      'Il contingente DOPOCENA è indipendente dalla disponibilità CENA'
    );
    assert.equal(
      (
        await db.query(
          "select private.service_capacity($1,'22:30',null) capacity",
          [day]
        )
      ).rows[0].capacity.remaining,
      0
    );
    await assert.rejects(insert(1, '', '22:30', 'agenda', 'dopocena'), /Limite giornaliero/);

    await insert(25, '', '20:00', 'agenda', 'normale');
    assert.equal(
      (
        await db.query(
          "select private.service_capacity($1,'19:00',null) capacity",
          [day]
        )
      ).rows[0].capacity.remaining,
      0
    );
    assert.equal(
      (
        await db.query(
          "select private.service_capacity($1,'22:30',null) capacity",
          [day]
        )
      ).rows[0].capacity.remaining,
      0
    );
    assert.equal(
      (
        await db.query(
          'select private.online_day_status($1,1,null) status',
          [day]
        )
      ).rows[0].status,
      'full'
    );
    await assert.rejects(insert(1, '', '20:30'), /Limite giornaliero/);

    // =====================================================
    // TEST PERMESSI STAFF
    // =====================================================

    await db.exec(`
      set request.jwt.claims='{"app_metadata":{"role":"staff"}}';
      set role authenticated;
    `);

    await assert.rejects(
      assign(chosen, '10+11'),
      /Accesso riservato/
    );

  } finally {
    await db.close();
  }
});
