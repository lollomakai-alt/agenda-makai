import test from 'node:test';
import assert from 'node:assert/strict';
import { customerBookingSummary, customerBookings, previousCustomerBookings, previousCustomerNoShowCount } from '../src/utils/customerBookings.js';

const current = { id: 42, name: 'Cliente', phone: '+393331234567', email: 'Cliente@example.invalid',
  booking_date: '2026-10-04', booking_time: '20:00', party_size: 2, status: 'confirmed' };
const now = Date.parse('2026-10-04T21:00:00Z');
function previous(id, overrides = {}) { return { ...current, id, booking_date: '2026-10-03', ...overrides }; }

test('existing phone or nonempty case-insensitive email identity finds past bookings, without mutating data', () => {
  const rows = [current, previous(1, { phone: '333 123 4567', email: '', status: 'no_show' }),
    previous(2, { phone: '+447911123456', email: 'cliente@EXAMPLE.invalid', booking_date: '2026-10-02' }),
    previous(3, { phone: '', email: '', name: current.name }),
    previous(4, { phone: '+447911123456', email: 'other@example.invalid' })];
  const snapshot = structuredClone(rows);
  assert.deepEqual(previousCustomerBookings(current, rows, now).bookings.map(row => row.id), [1, 2]);
  assert.equal(previousCustomerBookings(current, rows, now).bookings[0].status, 'no_show');
  assert.deepEqual(rows, snapshot);
});

test('missing contacts do not merge unrelated customers or fall back to names', () => {
  const withoutContacts = { ...current, phone: '', email: '' };
  assert.deepEqual(previousCustomerBookings(withoutContacts, [previous(1, { phone: '', email: '' })], now),
    { identifiable: false, bookings: [] });
});

test('current, future and later-than-selected bookings are excluded, using Rome timestamps', () => {
  const rows = [current, previous(1, { booking_date: '2026-10-05' }),
    previous(2, { booking_date: current.booking_date, booking_time: '21:00' }),
    previous(3, { booking_date: current.booking_date, booking_time: '19:00' }),
    previous(4, { booking_date: '2026-02-30' })];
  assert.deepEqual(previousCustomerBookings(current, rows, now).bookings.map(row => row.id), [3]);
  assert.deepEqual(previousCustomerBookings(current, rows, Date.parse('2026-10-04T16:00:00Z')).bookings, []);
});

test('no-show count reuses customer history, excluding current, future and unrelated bookings', () => {
  const rows = [
    { ...current, status: 'no_show' },
    previous(1, { status: 'no_show' }),
    previous(2, { status: 'NO_SHOW', phone: '', email: 'cliente@example.invalid' }),
    previous(3, { status: 'cancelled' }),
    previous(4, { status: 'no_show', phone: '+447911123456', email: 'other@example.invalid' }),
    previous(5, { status: 'no_show', booking_date: '2026-10-05' }),
  ];
  const snapshot = structuredClone(rows);
  assert.equal(previousCustomerNoShowCount(current, rows, now), 2);
  assert.equal(previousCustomerNoShowCount(current, [rows[1]], now), 1);
  assert.equal(previousCustomerNoShowCount(current, [rows[3]], now), 0);
  assert.equal(previousCustomerNoShowCount({ ...current, phone: '', email: '' }, rows, now), 0);
  assert.deepEqual(rows, snapshot);
});

test('user_id takes priority over similar contacts while contact fallback covers rows without an account', () => {
  const identified = { ...current, user_id: '11111111-1111-4111-8111-111111111111' };
  const rows = [
    previous(1, { user_id: identified.user_id, phone: '+39061234567', email: 'changed@example.invalid', status: 'no_show' }),
    previous(2, { user_id: '22222222-2222-4222-8222-222222222222', phone: identified.phone, email: identified.email, status: 'no_show' }),
    previous(3, { user_id: null, phone: '333 123 4567', email: '', status: 'no_show' }),
    previous(4, { user_id: null, phone: '+393331234568', email: 'client@example.invalid', status: 'no_show' }),
  ];
  assert.deepEqual(previousCustomerBookings(identified, rows, now).bookings.map(row => row.id), [3, 1]);
  assert.equal(previousCustomerNoShowCount(identified, rows, now), 2);
});

test('terminal current bookings do not show the previous no-show warning', () => {
  const rows = [previous(1, { status: 'no_show' })];
  for (const status of ['cancelled', 'no_show', 'completed']) {
    assert.equal(previousCustomerNoShowCount({ ...current, status }, rows, now), 0);
  }
});

test('customer card summary includes current and linked bookings newest first', () => {
  const rows = [
    previous(1, { booking_date: '2026-10-01', status: 'completed' }),
    current,
    previous(2, { booking_date: '2026-10-03', status: 'no_show' }),
    previous(3, { booking_date: '2026-10-02', status: 'cancelled' }),
    previous(4, { phone: '+39061234567', email: 'other@example.invalid', status: 'no_show' }),
  ];
  const summary = customerBookingSummary(current, rows);
  assert.deepEqual(summary.bookings.map(row => row.id), [42, 2, 3, 1]);
  assert.equal(summary.totalBookings, 4);
  assert.equal(summary.noShows, 1);
  assert.equal(summary.latestBooking.id, 42);
  assert.equal(summary.latestVisit.id, 1);
});

test('unidentifiable customer card keeps only the selected booking', () => {
  const selected = { ...current, phone: '', email: '', user_id: null };
  const linked = customerBookings(selected, [selected, previous(1, { phone: '', email: '' })]);
  assert.equal(linked.identifiable, false);
  assert.deepEqual(linked.bookings.map(row => row.id), [42]);
});
