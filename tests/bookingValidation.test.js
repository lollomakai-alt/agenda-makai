import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, validateBooking } from '../src/utils/bookingValidation.js';
import { todayInRome } from '../src/utils/calendar.js';

const day = new Date(`${todayInRome()}T12:00:00Z`);
day.setUTCDate(day.getUTCDate() + 1);
if (day.getUTCDay() === 1) day.setUTCDate(day.getUTCDate() + 1);
const valid = { name: 'Nicolò D’Angelo', phone: '333 123 4567', email: '', date: day.toISOString().slice(0, 10), time: '21:00', party_size: '4', notes: '' };

test('valid booking preserves optional email and normalizes contacts', () => {
  const result = validateBooking(valid);
  assert.deepEqual(result.errors, {});
  assert.equal(result.data.phone, '+393331234567');
  assert.equal(result.data.email, '');
  assert.equal(normalizePhone('+44 7911 123456'), '+447911123456');
});
test('bad fields are individually identified', () => {
  for (const [field, value] of [['name', 'Marco123'], ['name', 'Marco'], ['phone', '34255678'], ['email', 'marco gmail@gmail.com'], ['email', 'a@b'], ['party_size', '2.5'], ['party_size', ''], ['time', '21:15'], ['time', '25:00'], ['date', '2026-02-30'], ['notes', 'x'.repeat(301)]]) {
    assert.ok(validateBooking({ ...valid, [field]: value }).errors[field], `${field}: ${value}`);
  }
});
