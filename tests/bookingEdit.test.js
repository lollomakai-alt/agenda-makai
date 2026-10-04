import test from 'node:test';
import assert from 'node:assert/strict';
import { editableBookingValues, saveBookingEdit, validateBookingEdit } from '../src/utils/bookingEdit.js';

const booking = {
  id: 42, booking_date: '2026-10-10', booking_time: '20:00', party_size: 2,
  tables: '10,11', notes: '', status: 'confirmed', name: 'Nome Cliente',
  email: 'private@example.invalid', phone: 'private', created_at: '2026-10-01',
};

test('unchanged or invalid edits are blocked before any database call', async () => {
  const client = { rpc: () => { throw new Error('Must not call database'); } };
  assert.match(validateBookingEdit(editableBookingValues(booking), booking).errors.form, /nessun campo/);
  await assert.rejects(saveBookingEdit(client, booking, editableBookingValues(booking)), /nessun campo/);
  for (const [field, value] of [['booking_date', ''], ['booking_date', '2026-02-30'], ['booking_time', ''],
    ['booking_time', '24:00'], ['booking_time', '20:15'], ['party_size', '0'], ['party_size', '2.5'], ['party_size', '7'], ['party_size', ''],
    ['tables', 'foo'], ['tables', '0'], ['notes', 'x'.repeat(301)]]) {
    const values = { ...editableBookingValues(booking), [field]: value };
    assert.ok(validateBookingEdit(values, booking).errors[field], `${field}: ${value}`);
    await assert.rejects(saveBookingEdit(client, booking, values));
  }
});

test('save keeps id and sends only changed editable fields, never state or customer fields', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: { booking: { ...booking, ...args.changes }, history_error: null }, error: null };
  } };
  const values = { ...editableBookingValues(booking), notes: 'Seggiolone',
    id: 999, status: 'cancelled', name: 'Changed', email: 'changed', phone: 'changed', created_at: 'changed' };
  const result = await saveBookingEdit(client, booking, values);
  assert.equal(result.booking.id, 42);
  assert.equal(result.booking.status, 'confirmed');
  assert.deepEqual(calls, [{ name: 'admin_update_booking', args: {
    booking_id: 42, changes: { notes: 'Seggiolone' }, expected: {
      booking_date: '2026-10-10', booking_time: '20:00', party_size: 2, tables: '10,11', notes: '',
    },
  } }]);
});

test('all five editable fields are supported and equivalent existing time/table formats remain unchanged', () => {
  const values = { booking_date: '2026-10-11', booking_time: '21:00', party_size: '3', tables: '12, 13+14', notes: 'Terrazza' };
  assert.deepEqual(validateBookingEdit(values, booking), { errors: {}, changes: { ...values, party_size: 3, tables: '12,13+14' } });
  const historical = { ...booking, booking_time: '20:00:00', tables: '10, 11' };
  assert.deepEqual(validateBookingEdit({ ...editableBookingValues(historical), notes: 'Testo' }, historical).changes, { notes: 'Testo' });
});

test('database failure and unexpected id are rejected', async () => {
  const values = { ...editableBookingValues(booking), notes: 'Seggiolone' };
  await assert.rejects(saveBookingEdit({ rpc: async () => ({ error: { message: 'Conflitto' } }) }, booking, values), /Conflitto/);
  await assert.rejects(saveBookingEdit({ rpc: async () => ({ data: { booking: { id: 999 } } }) }, booking, values), /non confermato/);
});
