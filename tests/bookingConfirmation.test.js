import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationWhatsAppUrl } from '../src/utils/bookingConfirmation.js';

test('confirmed booking WhatsApp link opens with a prefilled message and never sends it', () => {
  const booking = {
    status: 'confirmed', name: 'Mario Rossi', phone: '+393331234567',
    booking_date: '2026-10-15', booking_time: '20:00', party_size: 3,
  };
  const url = confirmationWhatsAppUrl(booking);
  assert.match(url, /^https:\/\/wa\.me\/393331234567\?text=/);
  assert.match(decodeURIComponent(url), /PRENOTAZIONE CONFERMATA/);
  assert.match(decodeURIComponent(url), /Persone: 3/);
  assert.equal(confirmationWhatsAppUrl({ ...booking, status: 'cancelled' }), null);
});