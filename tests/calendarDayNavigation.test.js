import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftDay } from '../src/utils/calendar.js';

test('day navigation crosses month, year and leap-day boundaries', () => {
  assert.equal(shiftDay('2026-10-01', -1), '2026-09-30');
  assert.equal(shiftDay('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2027-01-01', -1), '2026-12-31');
  assert.equal(shiftDay('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftDay('2028-02-29', 1), '2028-03-01');
});

test('day navigation rejects invalid dates and non-integer shifts', () => {
  assert.equal(shiftDay('2026-02-30', 1), null);
  assert.equal(shiftDay('invalid', 1), null);
  assert.equal(shiftDay('2026-10-10', 0.5), null);
});
