import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/admin-push-subscriptions.sql', import.meta.url), 'utf8');

test('push subscription table is private by default and only grants scoped ADMIN policies', () => {
  assert.match(sql, /create table if not exists public\.admin_push_subscriptions/);
  assert.match(sql, /endpoint text primary key check \(length\(endpoint\) between 1 and 4096 and endpoint ~ '\^https:/);
  assert.match(sql, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(sql, /p256dh text not null/);
  assert.match(sql, /auth text not null/);
  assert.match(sql, /alter table public\.admin_push_subscriptions enable row level security/);
  assert.match(sql, /revoke all on public\.admin_push_subscriptions from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on public\.admin_push_subscriptions to authenticated/);
  assert.match(sql, /auth\.jwt\(\)->'app_metadata'->>'role'\) = 'admin'/);
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)/);

  for (const command of ['select', 'insert', 'update', 'delete']) {
    assert.ok(sql.includes(`create policy admin_push_subscriptions_${command}`));
  }
});

test('only the server service role receives backend maintenance access', () => {
  assert.match(sql, /grant select, insert, update, delete on public\.admin_push_subscriptions to service_role/);
  assert.doesNotMatch(sql, /grant select, insert, update, delete on public\.admin_push_subscriptions to anon/);
});

test('database RLS isolates subscriptions to their authenticated ADMIN owner', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create function auth.jwt() returns jsonb language sql
        as $$select current_setting('request.jwt.claims',true)::jsonb$$;
      create function auth.uid() returns uuid language sql
        as $$select (auth.jwt()->>'sub')::uuid$$;
      create table auth.users(id uuid primary key);
      insert into auth.users values
        ('11111111-1111-1111-1111-111111111111'),
        ('22222222-2222-2222-2222-222222222222');
      grant usage on schema auth to authenticated;
      grant execute on function auth.jwt(), auth.uid() to authenticated;
    `);
    await db.exec(sql);
    await db.exec(`
      set request.jwt.claims='{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}';
      set role authenticated;
      insert into public.admin_push_subscriptions(endpoint,user_id,p256dh,auth)
      values('https://push.example/owned','11111111-1111-1111-1111-111111111111',repeat('p',80),'authsecret123456');
    `);
    assert.equal((await db.query('select count(*)::int as n from public.admin_push_subscriptions')).rows[0].n, 1);
    await db.exec(`reset role; set request.jwt.claims='{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"role":"admin"}}'; set role authenticated;`);
    assert.equal((await db.query('select count(*)::int as n from public.admin_push_subscriptions')).rows[0].n, 0);
    await assert.rejects(db.query(`
      insert into public.admin_push_subscriptions(endpoint,user_id,p256dh,auth)
      values('https://push.example/forged','11111111-1111-1111-1111-111111111111',repeat('p',80),'authsecret123456')
    `), /row-level security/i);
    await db.exec(`reset role; set request.jwt.claims='{"sub":"22222222-2222-2222-2222-222222222222","user_metadata":{"role":"admin"}}'; set role authenticated;`);
    assert.equal((await db.query('select count(*)::int as n from public.admin_push_subscriptions')).rows[0].n, 0);
    await assert.rejects(db.query(`
      insert into public.admin_push_subscriptions(endpoint,user_id,p256dh,auth)
      values('https://push.example/no-role','22222222-2222-2222-2222-222222222222',repeat('p',80),'authsecret123456')
    `), /row-level security/i);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from public.admin_push_subscriptions'), /permission denied/i);
    await db.exec('reset role; set role service_role;');
    assert.equal((await db.query('select count(*)::int as n from public.admin_push_subscriptions')).rows[0].n, 1);
  } finally {
    await db.close();
  }
});
