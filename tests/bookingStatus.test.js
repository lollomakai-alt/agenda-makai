import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKING_STATUSES, bookingStatus, bookingStatusLabel, saveBookingStatus } from '../src/utils/bookingStatus.js';

test('historical and missing states remain readable without inventing cancellations', () => {
  for (const missing of [undefined, null, '']) assert.equal(bookingStatus(missing), 'confirmed');
  assert.equal(bookingStatus('confirmed'), 'confirmed');
  assert.equal(bookingStatus('cancelled'), 'cancelled');
  assert.equal(bookingStatus('CONFIRMED'), 'confirmed');
  assert.match(bookingStatusLabel('unknown'), /non riconosciuto/);
});

test('all five states send only the booking id and canonical status to the database API', async () => {
  assert.equal(Object.keys(BOOKING_STATUSES).length, 5);
  const calls = [];
  const client = { rpc: async (name, body) => {
    calls.push({ name, body });
    return { data: { booking_id: body.booking_id, status: body.booking_status }, error: null };
  } };
  for (const status of Object.keys(BOOKING_STATUSES)) {
    assert.deepEqual(await saveBookingStatus(client, 42, status), { booking_id: 42, status });
    assert.deepEqual(calls.at(-1), {
      name: 'admin_set_booking_status_with_history', body: { booking_id: 42, booking_status: status },
    });
  }
  const count = calls.length;
  await assert.rejects(saveBookingStatus(client, 42, 'CANCELLED'), /Stato non valido/);
  await assert.rejects(saveBookingStatus(client, 42, 'DELETE'), /Stato non valido/);
  assert.equal(calls.length, count);
});

test('missing SQL, denied access and unconfirmed writes never report success', async () => {
  await assert.rejects(saveBookingStatus({ rpc: async () => ({ error: { code: 'PGRST202' } }) }, 42, 'arrived'), /non ancora configurata/);
  await assert.rejects(saveBookingStatus({ rpc: async () => ({ error: { code: '42501', message: 'Accesso negato' } }) }, 42, 'no_show'), /Accesso negato/);
  await assert.rejects(saveBookingStatus({ rpc: async () => ({ data: null }) }, 42, 'cancelled'), /non confermata/);
  await assert.rejects(saveBookingStatus({ rpc: async () => ({ data: { booking_id: 99, status: 'arrived' } }) }, 42, 'arrived'), /non confermata/);
});
