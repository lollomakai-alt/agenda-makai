import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingWhatsAppConfirmationUrl, openBookingWhatsApp } from '../src/utils/bookingCommunications.js';

const booking = { id: 42, name: 'Anna & Luca', phone: '333 1234567', booking_date: '2026-10-15', booking_time: '20:30:00', party_size: 3 };
test('Italian mobile, international prefix and landline normalize for WhatsApp', () => {
 for (const phone of ['333 1234567', '+39 333 1234567', '0039 333 1234567', '393331234567']) {
  const url = new URL(bookingWhatsAppConfirmationUrl({ ...booking, phone }));
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/393331234567');
 }
 assert.equal(new URL(bookingWhatsAppConfirmationUrl({ ...booking, phone: '06 12345678' })).pathname, '/390612345678');
});
test('prefilled confirmation is URL encoded, with assigned table only when present', () => {
 for (const tables of [undefined, '', '   ', '10+11']) {
  const raw = bookingWhatsAppConfirmationUrl({ ...booking, tables });
  assert.ok(raw.includes('%F0%9F')); // Emoji encoded, including the pirate flag.
  assert.ok(raw.includes('Anna%20%26%20Luca'));
  const url = new URL(raw);
  assert.equal([...url.searchParams.keys()].length, 1);
  const text = url.searchParams.get('text');
  assert.match(text, /Ahoy Anna & Luca! 🏴‍☠️/);
  assert.match(text, /rotta verso Makai Pigneto è confermata/);
  assert.match(text, /15\/10\/2026/);assert.match(text, /20:30/);assert.match(text, /3 persone/);
  assert.match(text, /L'equipaggio Makai ti aspetta/);
  if (tables === '10+11') assert.match(text, /🪑 Tavolo 10\+11/);
  else assert.doesNotMatch(text, /🪑|Tavolo/);
 }
});
test('missing or invalid number never opens a window or writes a log', async () => {
 for (const phone of [undefined, null, '', 'invalid']) {
  assert.equal(bookingWhatsAppConfirmationUrl({ ...booking, phone }), null);
  await assert.rejects(openBookingWhatsApp({ rpc() { assert.fail('unexpected RPC'); } }, { ...booking, phone }, true, () => assert.fail('unexpected window')), /Numero/);
 }
});
test('opens actual wa.me URL before logging; no automatic message send', async () => {
 const events = [];
 const chat = { opener: {}, close() { assert.fail('chat must remain open'); } };
 const client = { rpc: async (name, body) => {
  events.push({ name, body });
  return { data: { booking_id: 42, channel: 'whatsapp' } };
 }};
 await openBookingWhatsApp(client, booking, true, (url, target) => { events.push({ url, target }); return chat; });
 assert.equal(events[0].url, bookingWhatsAppConfirmationUrl(booking));
 assert.equal(events[0].target, '_blank');
 assert.deepEqual(events[1], { name: 'admin_prepare_booking_communication', body: { p_booking_id: 42, p_channel: 'whatsapp' } });
 assert.equal(events.length, 2);assert.equal(chat.opener, null);
});
test('logging failure leaves chat open; blocked popup prevents RPC', async () => {
 let url;
 await assert.rejects(openBookingWhatsApp({ rpc: async () => ({ error: { message: 'Denied' } }) }, booking, true,
  value => { url = value; return { close() { assert.fail('must not close'); } }; }), /Chat WhatsApp aperta/);
 assert.equal(url, bookingWhatsAppConfirmationUrl(booking));
 await assert.rejects(openBookingWhatsApp({ rpc() { assert.fail('unexpected RPC'); } }, booking, true, () => null), /bloccato/);
});
