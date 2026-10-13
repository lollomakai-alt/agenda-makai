import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export async function bookingDatabase() {
 const db = new PGlite();
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
 for (const file of ['booking-status.sql','booking-history.sql','booking-edit.sql','table-conflicts.sql','after-dinner-bookings.sql','manual-table-assignment.sql','online-booking.sql','pending-online-capacity.sql','temporal-table-conflicts.sql','manual-assignment-capacity.sql','explicit-table-release.sql','booking-no-show.sql','booking-requests.sql','admin-notifications.sql','agenda-communications.sql','admin-activity-log.sql','dinner-after-dinner-turnover.sql','complete-booking-system.sql']) {
  await db.exec(await readFile(new URL(`../../supabase/${file}`,import.meta.url),'utf8'));
 }
 await db.exec(`create trigger prepare_booking before insert or update on bookings for each row execute function private.prepare_booking();`);
 return db;
}
