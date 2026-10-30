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
  assert.deepEqual(validateBookingEdit(values, booking, { now:Date.parse('2026-10-04T12:00:00Z') }), { errors: {}, changes: { ...values, party_size: 3, tables: '12,13+14' } });
  const historical = { ...booking, booking_time: '20:00:00', tables: '10, 11' };
  assert.deepEqual(validateBookingEdit({ ...editableBookingValues(historical), notes: 'Testo' }, historical).changes, { notes: 'Testo' });
});

test('DOPOCENA accepts the 23:00, 23:30 and 00:00 slots when editing', () => {
  const original = { ...booking, booking_type: 'dopocena', booking_date: '2026-10-10', booking_time: '23:00', tables: '' };
  for (const booking_time of ['23:00', '23:30', '00:00']) {
    const values = { ...editableBookingValues(original), booking_time };
    assert.equal(validateBookingEdit(values, original, { now: Date.parse('2026-10-04T12:00:00Z') }).errors.booking_time, undefined);
  }
  const values = { ...editableBookingValues(original), booking_time: '23:30' };
  for (const booking_time of ['22:29', '22:30', '22:59', '23:15', '00:01', '21:59']) {
    assert.ok(validateBookingEdit({ ...values, booking_time }, original, { now: Date.parse('2026-10-04T12:00:00Z') }).errors.booking_time);
  }
});

test('database failure and unexpected id are rejected', async () => {
  const values = { ...editableBookingValues(booking), notes: 'Seggiolone' };
  await assert.rejects(saveBookingEdit({ rpc: async () => ({ error: { message: 'Conflitto' } }) }, booking, values), /Conflitto/);
  await assert.rejects(saveBookingEdit({ rpc: async () => ({ data: { booking: { id: 999 } } }) }, booking, values), /non confermato/);
});

test('type change resets the time/table and uses the guarded server RPC on the same booking', async () => {
  const original = { ...booking, booking_type: 'normale', tables: '12', status: 'confirmed' };
  const values = { ...editableBookingValues(original), booking_type: 'dopocena', booking_time: '23:00', tables: '' };
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: { booking: { ...original, ...args.changes, tables: '' } }, error: null };
  } };
  const saved = await saveBookingEdit(client, original, values, [], { manualTables: true });
  assert.equal(saved.booking.id, original.id);
  assert.equal(saved.booking.booking_type, 'dopocena');
  assert.equal(saved.booking.tables, '');
  assert.equal(calls[0].name, 'admin_change_booking_type');
  assert.deepEqual(calls[0].args.changes, { booking_time: '23:00', tables: '', booking_type: 'dopocena' });
  assert.equal(calls[0].args.expected.booking_type, 'normale');
  assert.equal(calls[0].args.expected.tables, '12');
  assert.equal(calls[0].args.booking_id, original.id);
});

test('type change rejects invalid slots, sizes, occupied status and missing server migration', async () => {
  const original = { ...booking, booking_type: 'dopocena', booking_time: '23:00', tables: '', status: 'confirmed' };
  const base = { ...editableBookingValues(original), booking_type: 'normale', booking_time: '19:00', tables: '17' };
  assert.match(validateBookingEdit({ ...base, booking_time: '23:00' }, original, { manualTables: true }).errors.booking_time, /CENA/);
  assert.equal(validateBookingEdit({ ...base, party_size: '7' }, original, { manualTables: true }).errors.party_size, undefined);
  assert.match(validateBookingEdit({ ...base, tables: '' }, original, { manualTables: true }).errors.tables, /Seleziona/);
  assert.match(validateBookingEdit(base, { ...original, status: 'arrived' }, { manualTables: true }).errors.booking_type, /confermate/);
  const after = { ...booking, booking_type: 'normale', tables: '12', status: 'confirmed' };
  const afterValues = { ...editableBookingValues(after), booking_type: 'dopocena', booking_time: '23:00', tables: '', party_size: '25' };
  assert.equal(validateBookingEdit(afterValues, after, { manualTables: true }).errors.party_size, undefined);
  assert.equal(validateBookingEdit({ ...afterValues, booking_time: '23:00' }, after, { manualTables: true }).errors.booking_time, undefined);
  assert.match(validateBookingEdit({ ...afterValues, party_size: '26' }, after, { manualTables: true }).errors.party_size, /25/);
  await assert.rejects(saveBookingEdit({ rpc: async () => ({ error: { code: 'PGRST202' } }) }, original, base, [], { manualTables: true }), /migrazione ADMIN/);
});
