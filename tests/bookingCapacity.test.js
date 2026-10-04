import test from 'node:test';
import assert from 'node:assert/strict';
import { canAcceptBooking } from '../src/utils/bookingCapacity.js';

const date = '2026-10-15';
const bookings = [
  { booking_date: date, party_size: 20, status: 'confirmed', booking_type: 'normale' },
  { booking_date: date, party_size: 4, status: 'CONFIRMED', booking_type: 'dopocena' },
  { booking_date: date, party_size: 8, status: 'cancelled' },
  { booking_date: '2026-10-16', party_size: 8, status: 'confirmed' },
];

test('daily capacity includes confirmed bookings of every type and blocks above 25', () => {
  assert.equal(canAcceptBooking(bookings, date, 1), true);
  assert.equal(canAcceptBooking(bookings, date, 2), false);
  assert.equal(canAcceptBooking(bookings, date, 6), false);
  assert.equal(canAcceptBooking([...bookings, { booking_date: date, party_size: 1, status: 'confirmed' }], date, 1), false);
});