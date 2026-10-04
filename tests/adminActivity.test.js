import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAdminActivity, loadAdminActivity, normalizeAdminActivity } from '../src/utils/adminActivity.js';

test('admin activity merges existing booking and waitlist histories with actor and essential details', () => {
  const rows = normalizeAdminActivity([
    { id: 4, booking_id: 9, action: 'status_changed', old_data: { status: 'confirmed' }, new_data: { status: 'cancelled' }, actor_id: 'admin-1', created_at: '2026-10-04T12:00:00Z' },
  ], [
    { id: 7, waitlist_id: 3, action: 'converted', old_data: { status: 'WAITING' }, new_data: { status: 'CONVERTED', booking_id: 10, conversion_table: '12' }, actor_id: 'admin-2', created_at: '2026-10-04T13:00:00Z' },
  ]);
  assert.deepEqual(rows.map(row => row.actor_id), ['admin-2', 'admin-1']);
  assert.equal(rows[0].booking_id, 10);
  assert.deepEqual(rows[0].details, ['WAITING → CONVERTED', 'Prenotazione #10', 'Tavolo: 12']);
  assert.deepEqual(filterAdminActivity(rows, { from: '2026-10-04', to: '2026-10-04', action: 'status_changed', search: 'admin-1' }).map(row => row.booking_id), [9]);
});

test('activity loader reads both existing histories with bounded newest-first queries', async () => {
  const calls = [];
  function query(table, data) {
    const chain = {
      select(columns) { calls.push([table, 'select', columns]); return this; },
      order(column, options) { calls.push([table, 'order', column, options]); return this; },
      limit(value) { calls.push([table, 'limit', value]); return Promise.resolve({ data, error: null }); },
    };
    return chain;
  }
  const client = { from(table) { return query(table, []); } };
  assert.deepEqual(await loadAdminActivity(client), []);
  assert.deepEqual(calls.filter(call => call[1] === 'limit').map(call => [call[0], call[2]]), [
    ['booking_history', 500], ['waitlist_history', 500],
  ]);
});

test('activity date filters use the Rome calendar date instead of the UTC date', () => {
  const rows = normalizeAdminActivity([
    { id: 1, booking_id: 1, action: 'status_changed', old_data: {}, new_data: {}, created_at: '2026-10-03T23:30:00Z' },
  ], []);
  assert.equal(filterAdminActivity(rows, { from: '2026-10-04', to: '2026-10-04', action: '', search: '' }).length, 1);
  assert.equal(filterAdminActivity(rows, { from: '2026-10-03', to: '2026-10-03', action: '', search: '' }).length, 0);
});