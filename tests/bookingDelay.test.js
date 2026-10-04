import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingDelayNotification, bookingDelayState } from '../src/utils/bookingDelay.js';

const booking = { id: 42, status: 'confirmed', booking_date: '2026-10-04', booking_time: '20:00' };
const boundary = Date.parse('2026-10-04T18:15:00Z');

test('delay warning starts at exactly 15 minutes and reports elapsed minutes', () => {
  const original = structuredClone(booking);
  assert.equal(bookingDelayNotification(booking, boundary - 1), null); // 14:59.999
  const expected = {
    id: 'customer-delay-42', bookingId: 42, minutesLate: 15,
    message: 'Cliente non ancora arrivato · 15 min di ritardo',
  };
  assert.deepEqual(bookingDelayNotification(booking, boundary), expected);
  assert.equal(bookingDelayNotification(booking, boundary + 14 * 60000).minutesLate, 29);
  assert.deepEqual(bookingDelayNotification(structuredClone(booking), boundary), expected);
  assert.deepEqual(booking, original);
});

test('manual no-show becomes available at 30 minutes and remains available afterwards', () => {
  assert.equal(bookingDelayState(booking, boundary - 15 * 60000).showWarning, false); // exactly 0
  assert.equal(bookingDelayState(booking, boundary + 14 * 60000).canMarkNoShow, false); // 29
  const atThirty = bookingDelayState(booking, boundary + 15 * 60000);
  assert.equal(atThirty.minutesLate, 30);
  assert.equal(atThirty.showWarning, true);
  assert.equal(atThirty.canMarkNoShow, true);
  assert.equal(bookingDelayState(booking, boundary + 45 * 60000).canMarkNoShow, true);
});

test('arrived, completed, cancelled and no_show remove the notification, including historical uppercase values', () => {
  for (const status of ['arrived', 'completed', 'cancelled', 'no_show', 'ARRIVED']) {
    assert.equal(bookingDelayNotification({ ...booking, status }, boundary + 3600000), null);
  }
  assert.ok(bookingDelayNotification({ ...booking, status: null }, boundary));
});

test('winter, midnight rollover and invalid dates use the same shared Rome calculation', () => {
  const winter = { ...booking, booking_date: '2026-12-20', booking_time: '23:50:15' };
  const midnightBoundary = Date.parse('2026-12-20T23:05:15Z');
  assert.equal(bookingDelayNotification(winter, midnightBoundary - 1), null);
  assert.ok(bookingDelayNotification(winter, midnightBoundary));
  for (const bad of [{ ...booking, booking_date: '2026-02-30' }, { ...booking, booking_time: '24:00' }, { ...booking, id: null }]) {
    assert.equal(bookingDelayNotification(bad, boundary + 3600000), null);
  }
});
