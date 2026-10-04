import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingCallUrl } from '../src/utils/bookingCall.js';

test('stored international and local numbers use the existing phone normalization for tel links', () => {
  assert.equal(bookingCallUrl('+39 333 123 4567'), 'tel:+393331234567');
  assert.equal(bookingCallUrl('3331234567'), 'tel:+393331234567');
  assert.equal(bookingCallUrl('06 12345678'), 'tel:+390612345678');
  assert.equal(bookingCallUrl('0044 7911 123456'), 'tel:+447911123456');
});

test('missing, malformed and injected URI values never produce a usable link', () => {
  for (const phone of [null, undefined, '', '   ', '123', 'test', 'tel:+393331234567',
    '+393331234567?body=secret', '+393331234567;extension=123', 3331234567]) {
    assert.equal(bookingCallUrl(phone), null);
  }
});
