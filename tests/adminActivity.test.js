import test from 'node:test';
import assert from 'node:assert/strict';
import { activityActionLabel, activityEventType, activityOutcome, activityOutcomeTone, attachAdminActivityNames, filterAdminActivity, loadAdminActivity, loadAdminActivityContact, loadAdminActivityNames, normalizeAdminActivity } from '../src/utils/adminActivity.js';

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

test('archive reads Italian event labels, outcomes and types from the existing histories', () => {
  const rows = normalizeAdminActivity([
    { id: 1, booking_id: 10, action: 'booking_created', old_data: {}, new_data: { booking_date: '2026-11-01', booking_time: '20:00', party_size: 4, tables: '' }, created_at: '2026-10-01T10:00:00Z' },
    { id: 2, booking_id: 10, action: 'customer_request_created', old_data: {}, new_data: { request_id: 3, request_type: 'data', requested_value: '2026-11-02', request_status: 'pending' }, created_at: '2026-10-02T10:00:00Z' },
    { id: 3, booking_id: 10, action: 'customer_request_rejected', old_data: { request_status: 'pending' }, new_data: { request_id: 3, request_type: 'data', requested_value: '2026-11-02', request_status: 'rejected', rejection_reason: 'Sala completa.' }, created_at: '2026-10-03T10:00:00Z' },
    { id: 4, booking_id: 10, action: 'status_changed', old_data: { status: 'confirmed' }, new_data: { status: 'cancelled' }, created_at: '2026-10-04T10:00:00Z' },
  ], []);
  assert.deepEqual(rows.map(entry => activityActionLabel(entry.action)), [
    'Stato prenotazione modificato', 'Richiesta cliente rifiutata',
    'Richiesta cliente ricevuta', 'Prenotazione creata',
  ]);
  assert.deepEqual(rows.map(activityOutcome), ['Annullata', 'Rifiutata', 'In attesa', 'Confermata']);
  assert.deepEqual(rows.map(activityEventType), ['prenotazioni', 'richieste', 'richieste', 'prenotazioni']);
  assert.deepEqual(rows.map(activityOutcomeTone), ['no', 'no', 'wait', 'ok']);
  assert.equal(activityActionLabel('qualcosa_di_tecnico'), 'Evento amministrativo');
});

test('archive search accepts booking number or customer name and the event type filter', () => {
  const rows = normalizeAdminActivity([
    { id: 1, booking_id: 310, action: 'customer_request_rejected', old_data: {}, new_data: { request_status: 'rejected', rejection_reason: 'Sala completa.' }, created_at: '2026-10-01T10:00:00Z' },
    { id: 2, booking_id: 311, action: 'booking_created', old_data: {}, new_data: {}, created_at: '2026-10-02T10:00:00Z' },
  ], []);
  const named = attachAdminActivityNames(rows, { bookings: new Map([['310', 'Alex Peterson'], ['311', 'Giulia Rossi']]), waitlists: new Map() });
  assert.deepEqual(filterAdminActivity(named, { search: '310' }).map(entry => entry.booking_id), [310]);
  assert.deepEqual(filterAdminActivity(named, { search: 'alex' }).map(entry => entry.booking_id), [310]);
  assert.deepEqual(filterAdminActivity(named, { search: 'giulia' }).map(entry => entry.booking_id), [311]);
  assert.deepEqual(filterAdminActivity(named, { type: 'richieste' }).map(entry => entry.booking_id), [310]);
  assert.deepEqual(filterAdminActivity(named, { type: 'prenotazioni' }).map(entry => entry.booking_id), [311]);
});

test('archive name loader reads unique booking and waitlist ids in bounded chunks', async () => {
  const calls = [];
  const client = { from(table) {
    return { select(columns) { calls.push([table, 'select', columns]); return this; },
      in(column, ids) { calls.push([table, 'in', column, ids]); return Promise.resolve({
        error: null,
        data: ids.map(id => ({ id, name: `${table === 'bookings' ? 'Cliente' : 'Attesa'} ${id}` })),
      }); } };
  } };
  const entries = [
    { source: 'booking', booking_id: 1 },
    { source: 'booking', booking_id: 1 },
    { source: 'waitlist', waitlist_id: 2 },
    { source: 'waitlist', waitlist_id: null },
  ];
  const names = await loadAdminActivityNames(client, entries);
  assert.deepEqual(names.bookings.get('1'), 'Cliente 1');
  assert.deepEqual(names.waitlists.get('2'), 'Attesa 2');
  assert.deepEqual(calls.filter(call => call[1] === 'in').map(call => [call[0], call[3]]), [['bookings', ['1']], ['waitlist', ['2']]]);
  const named = attachAdminActivityNames(entries, names);
  assert.equal(named[0].booking_name, 'Cliente 1');
  assert.equal(named[2].waitlist_name, 'Attesa 2');
});

test('archive contact lookup exposes phone and email only for the opened event', async () => {
  const calls = [];
  let lastValue;
  const client = { from(table) {
    return { select(columns) { calls.push([table, columns]); return this; },
      eq(column, value) { lastValue = value; calls.push([table, column, value]); return this; },
      maybeSingle() { return Promise.resolve({ error: null, data: { id: lastValue, name: 'Alex', phone: '+39', email: 'a@example.com' } }); } };
  } };
  const contact = await loadAdminActivityContact(client, { booking_id: 9 });
  assert.equal(contact.phone, '+39');
  assert.equal(contact.email, 'a@example.com');
  assert.deepEqual(calls[0][0], 'bookings');
  assert.deepEqual(calls[1], ['bookings', 'id', 9]);
});