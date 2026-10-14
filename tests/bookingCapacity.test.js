import test from 'node:test';
import assert from 'node:assert/strict';
import { canAcceptBooking, physicalDinnerCapacity, serviceCapacity } from '../src/utils/bookingCapacity.js';

const date = '2026-10-15';
const bookings = [
  { booking_date: date, party_size: 20, status: 'confirmed', booking_type: 'normale' },
  { booking_date: date, party_size: 4, status: 'CONFIRMED', booking_type: 'dopocena' },
  { booking_date: date, party_size: 8, status: 'cancelled' },
  { booking_date: '2026-10-16', party_size: 8, status: 'confirmed' },
];

test('dinner physical capacity and independent after-dinner physical limit', () => {
  assert.equal(physicalDinnerCapacity(), 26);
  assert.equal(canAcceptBooking(bookings, date, 1), true);
  assert.equal(canAcceptBooking(bookings, date, 2), true);
  assert.equal(canAcceptBooking(bookings, date, 5), true);
  assert.equal(canAcceptBooking(bookings, date, 6), true);
  assert.equal(canAcceptBooking(bookings, date, 7), false);
  assert.equal(canAcceptBooking(bookings, date, 6, '22:30', '', 'dopocena'), true);
  assert.equal(canAcceptBooking([...bookings, { booking_date:date,party_size:21,status:'arrived',booking_type:'dopocena' }], date, 1, '22:30', '', 'dopocena'), true);
  assert.equal(canAcceptBooking([...bookings, { booking_date:date,party_size:22,status:'arrived',booking_type:'dopocena' }], date, 1, '22:30', '', 'dopocena'), false);
});

test('manual over-capacity consumes people without inflating physical table capacity', () => {
  const dinner = {booking_date:date,booking_time:'20:00',booking_type:'normale',party_size:23,tables:'22+23',status:'confirmed'};
  const capacity = serviceCapacity([dinner],dinner);
  assert.equal(capacity.verified,true);
  assert.equal(capacity.occupied,4);
  assert.equal(capacity.peopleReserved,23);
  assert.equal(capacity.total,26);
  assert.equal(capacity.physicalRemaining,22);
  assert.equal(capacity.peopleRemaining,3);
  assert.equal(canAcceptBooking([dinner],date,2,'20:00'),true);
  assert.equal(canAcceptBooking([dinner],date,3,'20:00'),true);
  assert.equal(canAcceptBooking([dinner],date,4,'20:00'),false);
  assert.equal(canAcceptBooking([],date,23,'20:00','22+23'),false);
  const after = {...dinner,booking_type:'dopocena',tables:'',status:'arrived'};
  assert.equal(canAcceptBooking([after],date,2,'22:30','','dopocena'),true);
  assert.equal(canAcceptBooking([after],date,3,'22:30','','dopocena'),true);
  assert.equal(canAcceptBooking([{...after,party_size:27}],date,1,'22:30','','dopocena'),false);
  assert.equal(canAcceptBooking([dinner,{...after,party_size:2}],date,23,'22:30','','dopocena'),true);
  for (const status of ['cancelled','no_show']) assert.equal(canAcceptBooking([{...after,status}],date,6,'22:30','','dopocena'),true);
});
