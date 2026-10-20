import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingWhatsAppConfirmationUrl, openBookingWhatsApp, usesDirectWhatsAppConfirmation } from '../src/utils/bookingCommunications.js';

const booking = { id: 42, name: 'Anna & Luca', phone: '333 1234567', booking_date: '2026-10-15', booking_time: '20:30:00', party_size: 3 };
test('Italian mobile, international prefixes and landline normalize for WhatsApp', () => {
 for (const phone of ['333 1234567', '+39 333 1234567', '0039 333 1234567', '393331234567']) {
  const url = new URL(bookingWhatsAppConfirmationUrl({ ...booking, phone }));
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/393331234567');
 }
 assert.equal(new URL(bookingWhatsAppConfirmationUrl({ ...booking, phone: '06 12345678' })).pathname, '/390612345678');
 assert.equal(new URL(bookingWhatsAppConfirmationUrl({ ...booking, phone: '+44 7911 123456' })).pathname, '/447911123456');
 assert.equal(new URL(bookingWhatsAppConfirmationUrl({ ...booking, phone: '0044 7911 123456' })).pathname, '/447911123456');
});
test('prefilled confirmation preserves emoji and omits all internal table information', () => {
 for (const tables of [undefined, '', '   ', '10+11', ' 10+11 ']) {
  const raw = bookingWhatsAppConfirmationUrl({ ...booking, tables });
  assert.ok(raw.includes('%F0%9F')); // Emoji encoded, including the pirate flag.
  assert.ok(raw.includes('Anna%20%26%20Luca'));
  const url = new URL(raw);
  assert.equal([...url.searchParams.keys()].length, 1);
  const text = url.searchParams.get('text');
  assert.match(text, /Ahoy Anna & Luca! 🏴‍☠️/);
  assert.match(text, /La prenotazione al Makai è confermata/);
  assert.match(text, /15\/10\/2026/);assert.match(text, /20:30/);assert.match(text, /3 persone/);
  assert.match(text, /A presto a bordo! 🌴/);
  assert.doesNotMatch(text, /🪑|tavol|assegnazion|10\+11/i);
 }
});
test('missing or invalid number never opens a window or writes a log', async () => {
 for (const phone of [undefined, null, '', 'invalid', '123', 'tel:+393331234567', 'javascript:alert(1)', '+39 333 1234567x']) {
  assert.equal(bookingWhatsAppConfirmationUrl({ ...booking, phone }), null);
  await assert.rejects(openBookingWhatsApp({ rpc() { assert.fail('unexpected RPC'); } }, { ...booking, phone }, true, () => assert.fail('unexpected window')), /Numero/);
 }
});
test('opens the universal wa.me URL before logging; desktop and mobile sending stays manual', async () => {
 const events = [];
 const chat = { opener: {}, close() { assert.fail('chat must remain open'); } };
 const previousFetch = globalThis.fetch;
 const client = { auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})} };
 globalThis.fetch = async (name, options) => {
  const body=JSON.parse(options.body);
  events.push({ name, body });
  return Response.json({communication:{booking_id:42,channel:'whatsapp'}});
 };
 await openBookingWhatsApp(client, booking, true, (url, target) => { events.push({ url, target }); return chat; });
 assert.equal(events[0].url, bookingWhatsAppConfirmationUrl(booking));
 assert.match(events[0].url, /^https:\/\/wa\.me\/393331234567\?text=/);
 assert.equal(events[0].target, '_blank');
 globalThis.fetch=previousFetch;
 assert.deepEqual(events[1], { name: '/api/admin/bookings/42/communications/prepare', body: { channel: 'whatsapp' } });
 assert.equal(events.length, 2);assert.equal(chat.opener, null);
});
test('logging failure leaves chat open; blocked popup prevents RPC', async () => {
 let url;
 await assert.rejects(openBookingWhatsApp({auth:{getSession:async()=>({data:{session:null}})}}, booking, true,
  value => { url = value; return { close() { assert.fail('must not close'); } }; }), /Chat WhatsApp aperta/);
 assert.equal(url, bookingWhatsAppConfirmationUrl(booking));
 await assert.rejects(openBookingWhatsApp({ rpc() { assert.fail('unexpected RPC'); } }, booking, true, () => null), /bloccato/);
});

test('cancelled compact message prepares the existing cancellation template for the cancelled booking', async () => {
 const previousFetch = globalThis.fetch;
 const events = [];
 const chat = { opener: {}, location: {}, close() { assert.fail('chat should stay open'); } };
 const client = { auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})} };
 const cancelled = { ...booking, status: 'cancelled' };
 globalThis.fetch = async (name, options) => {
  events.push({ name, body: JSON.parse(options.body) });
  return Response.json({communication:{booking_id:42,channel:'whatsapp',status:'opened',kind:'cancelled',recipient:'+393331234567',snapshot:cancelled}});
 };
 try {
  await openBookingWhatsApp(client, cancelled, false, (url,target) => { events.push({url,target}); return chat; });
  assert.equal(events[0].url, 'about:blank');
  assert.equal(events[0].target, '_blank');
  assert.equal(events[1].name, '/api/admin/bookings/42/communications/prepare');
  assert.equal(chat.opener, null);
  assert.match(chat.location.href, /^https:\/\/wa\.me\/393331234567\?text=/);
  assert.match(new URL(chat.location.href).searchParams.get('text'), /prenotazione è stata cancellata/);
 } finally { globalThis.fetch = previousFetch; }
});

test('compact WhatsApp uses the direct confirmation only for non-cancelled bookings', () => {
 assert.equal(usesDirectWhatsAppConfirmation({status:'confirmed'}, true), true);
 assert.equal(usesDirectWhatsAppConfirmation({status:'cancelled'}, true), false);
 assert.equal(usesDirectWhatsAppConfirmation({status:'confirmed'}, false), false);
});
