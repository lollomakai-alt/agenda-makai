import test from 'node:test';
import assert from 'node:assert/strict';
import { conflictingTableIds, tableAssignmentError, tableConfigurationError } from '../src/utils/tableConflicts.js';
import { editableBookingValues, saveBookingEdit } from '../src/utils/bookingEdit.js';

const original = { id: 42, booking_date: '2026-10-04', booking_time: '19:00', party_size: 2, tables: '12', notes: '', status: 'confirmed' };

test('same-date table conflicts ignore time; cancelled/no-show, different dates and own id are excluded', () => {
  const rows = [original,
    { ...original, id: 1, booking_time: '23:00', tables: '12,13+14', status: 'completed' },
    { ...original, id: 2, booking_date: '2026-10-05', tables: '22' }];
  assert.deepEqual(conflictingTableIds({ ...original, tables: '12,22' }, rows), ['12']);
  for (const status of ['confirmed', 'arrived', 'completed']) {
    assert.deepEqual(conflictingTableIds(original, [{ ...original, id: 99, status }]), ['12']);
  }
  for (const status of ['cancelled', 'no_show']) {
    assert.deepEqual(conflictingTableIds(original, [{ ...original, id: 99, status }]), []);
  }
  assert.deepEqual(conflictingTableIds(original, [original]), []);
  assert.deepEqual(conflictingTableIds({ ...original, tables: '' }, rows), []);
});

test('normal and dopocena may reuse a table, while same-type bookings still conflict', () => {
  const normal = { ...original, booking_type: 'normale' };
  const afterDinner = { ...original, id: 99, booking_type: 'dopocena', booking_time: '22:00' };
  assert.deepEqual(conflictingTableIds(afterDinner, [normal]), []);
  assert.deepEqual(conflictingTableIds(afterDinner, [{ ...afterDinner, id: 100 }]), ['12']);
  assert.deepEqual(conflictingTableIds(normal, [{ ...normal, id: 101 }]), ['12']);
});

test('configuration validates grouped tables, physical duplicates and capacity', () => {
  assert.equal(tableAssignmentError('10+11, 12,23', 7), '');
  assert.equal(tableAssignmentError(''), '');
  assert.match(tableAssignmentError('99'), /configurat/);
  assert.match(tableAssignmentError('12,12'), /due volte/);
  assert.match(tableAssignmentError('15+16+17,15+16'), /fisico/);
  assert.match(tableAssignmentError('12', 3), /capienza/);
});

test('15-19 assignments follow one of the three permitted configurations', () => {
  const candidate = { ...original, tables: '15+16+17' };
  assert.equal(tableConfigurationError(candidate, [{ ...original, id: 1, tables: '18+19' }]), '');
  assert.match(tableConfigurationError(candidate, [{ ...original, id: 1, tables: '18' }]), /non è consentita/);
  assert.deepEqual(conflictingTableIds(candidate, [{ ...original, id: 1, tables: '15+16' }]), ['15', '16']);
});

test('editor blocks date or table changes that conflict before invoking the update RPC', async () => {
  const client = { rpc() { throw new Error('Database must not be called'); } };
  const rows = [{ ...original, id: 1, booking_date: '2026-10-06' }, { ...original, id: 2, tables: '22' }];
  await assert.rejects(saveBookingEdit(client, original, { ...editableBookingValues(original), booking_date: '2026-10-06' }, rows), /già assegnati/);
  await assert.rejects(saveBookingEdit(client, original, { ...editableBookingValues(original), tables: '22' }, rows), /già assegnati/);
});

test('free assignments preserve the selected table and id; unrelated edits do not alter preexisting conflicts', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push(args);
    return { data: { booking: { ...original, ...args.changes } } };
  } };
  const rows = [{ ...original, id: 1 }];
  const snapshot = structuredClone(rows);
  const result = await saveBookingEdit(client, original, { ...editableBookingValues(original), tables: '13+14' }, rows);
  assert.equal(result.booking.id, 42);
  assert.equal(result.booking.tables, '13+14');
  await saveBookingEdit(client, original, { ...editableBookingValues(original), notes: 'Note' }, rows);
  assert.deepEqual(calls.map(call => call.changes), [{ tables: '13+14' }, { notes: 'Note' }]);
  assert.deepEqual(rows, snapshot);
});
