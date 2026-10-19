import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('marketing retention migration shortens existing consent to 12 months and preserves earlier expiry', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.marketing_contacts (
        id bigint primary key,
        consenso_data timestamptz not null,
        scadenza_consenso timestamptz not null
      );
      insert into public.marketing_contacts values
        (1, '2025-01-01T00:00:00Z', '2027-01-01T00:00:00Z'),
        (2, '2025-01-01T00:00:00Z', '2025-07-01T00:00:00Z');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261017180000_marketing_retention_12_months.sql', import.meta.url), 'utf8'));
    const result = await db.query(`
      select id, to_char(scadenza_consenso at time zone 'UTC', 'YYYY-MM-DD') as expiry
      from public.marketing_contacts order by id
    `);
    assert.deepEqual(result.rows, [
      { id: 1, expiry: '2026-01-01' },
      { id: 2, expiry: '2025-07-01' },
    ]);
  } finally {
    await db.close();
  }
});
