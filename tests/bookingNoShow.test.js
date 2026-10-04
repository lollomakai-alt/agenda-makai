import test from 'node:test';
import assert from 'node:assert/strict';
import { noShowEligibility } from '../src/utils/bookingNoShow.js';

test('arrived, cancelled, completed and already no_show remain blocked after the time limit', () => {
  for (const status of ['arrived', 'cancelled', 'completed', 'no_show']) {
    const result = noShowEligibility({ status, booking_date: '2026-10-04', booking_time: '20:00' }, Date.parse('2026-10-05T12:00:00Z'));
    assert.equal(result.allowed, false);
    assert.ok(result.message);
  }
  assert.equal(noShowEligibility({ status: 'confirmed', booking_date: '2026-10-04', booking_time: '20:00' }, Date.parse('2026-10-04T18:30:00Z')).allowed, true);
});

test('20:00 Rome booking blocks before 20:30 and allows exactly at the boundary', () => {
  const booking = { booking_date: '2026-10-04', booking_time: '20:00' };
  assert.equal(noShowEligibility(booking, Date.parse('2026-10-04T18:29:59.999Z')).allowed, false);
  assert.equal(noShowEligibility(booking, Date.parse('2026-10-04T18:30:00Z')).allowed, true);
  assert.equal(noShowEligibility(booking, Date.parse('2026-10-03T22:00:00Z')).allowed, false);
  assert.equal(noShowEligibility(booking, Date.parse('2026-10-05T12:00:00Z')).allowed, true);
});

test('winter Rome time, seconds and midnight rollover are respected', () => {
  const booking = { booking_date: '2026-12-20', booking_time: '23:50:15' };
  const boundary = Date.parse('2026-12-20T23:20:15Z');
  assert.equal(noShowEligibility(booking, boundary - 1).allowed, false);
  assert.equal(noShowEligibility(booking, boundary).allowed, true);
});

test('DST interpretation agrees with PostgreSQL standard-time preference', () => {
  assert.equal(noShowEligibility({ booking_date: '2026-10-25', booking_time: '02:30' }, 0).eligibleAt, Date.parse('2026-10-25T02:00:00Z'));
  assert.equal(noShowEligibility({ booking_date: '2026-03-29', booking_time: '02:30' }, 0).eligibleAt, Date.parse('2026-03-29T02:00:00Z'));
});

test('missing or malformed scheduling data never allows no-show', () => {
  for (const booking of [{}, { booking_date: '2026-02-30', booking_time: '20:00' },
    { booking_date: '2026-10-04', booking_time: '24:00' }, { booking_date: '2026-10-04', booking_time: '' }]) {
    assert.equal(noShowEligibility(booking).allowed, false);
  }
});
