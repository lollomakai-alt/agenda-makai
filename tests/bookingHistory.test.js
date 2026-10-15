import test from 'node:test';
import assert from 'node:assert/strict';
import { historyChanges, loadBookingHistory } from '../src/utils/bookingHistory.js';

test('history shows relevant changed values and ignores private/untracked fields', () => {
  assert.deepEqual(historyChanges({
    old_data: { status: 'confirmed', notes: null, party_size: 2, phone: 'private', token: 'secret' },
    new_data: { status: 'cancelled', notes: 'Terrazza', party_size: 2, phone: 'other', token: 'other' },
  }), ['Stato: Confermata → Cancellata', 'Note: — → Terrazza']);
  for (const field of ['booking_date', 'booking_time', 'party_size', 'tables']) {
    assert.equal(historyChanges({ old_data: { [field]: 'prima' }, new_data: { [field]: 'dopo' } }).length, 1);
  }
  assert.deepEqual(historyChanges({ old_data: {}, new_data: {} }), []);
});

test('history reads only the chosen booking, latest first with a deterministic id order', async () => {
  const calls = [];
  const chain = {
    select(value) { calls.push(['select', value]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    order(...args) { calls.push(['order', ...args]); return this; },
    then(resolve) { return Promise.resolve({ data: [{ id: 9 }], error: null }).then(resolve); },
  };
  const client = { from(table) { calls.push(['from', table]); return chain; } };
  assert.deepEqual(await loadBookingHistory(client, 42), [{ id: 9 }]);
  assert.deepEqual(calls, [
    ['from', 'booking_history'], ['select', 'id,booking_id,action,old_data,new_data,created_at'],
    ['eq', 'booking_id', 42], ['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: false }],
  ]);
});

test('denied history reads are not presented as an empty history', async () => {
  const chain = { select() { return this; }, eq() { return this; }, order() { return this; },
    then(resolve) { return Promise.resolve({ error: { message: 'Accesso negato' } }).then(resolve); } };
  await assert.rejects(loadBookingHistory({ from: () => chain }, 42), /Storico non disponibile: Accesso negato/);
});

test('customer cancellation and staff alternative show their actual event without false field changes', () => {
  assert.deepEqual(historyChanges({action:'customer_cancelled',old_data:{booking_date:'2026-10-20',booking_time:'20:00',tables:'12'},new_data:{status:'cancelled',tables:''}}),
    ['Prenotazione cancellata dal cliente','Tavolo liberato: 12']);
  assert.deepEqual(historyChanges({action:'customer_request_alternative',new_data:{request_id:9,alternative:'Alle 21:00'}}),
    ['Richiesta #9: alternativa proposta','Alle 21:00']);
});
