import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookingStatusUndo } from '../src/utils/bookingStatusUndo.js';

function fixture(status = 'confirmed') {
  const booking = { id: 42, name: 'Cliente', status };
  const calls = [];
  const client = { rpc: async (name, body) => {
    calls.push({ name, body });
    booking.status = body.booking_status;
    return { data: { booking_id: booking.id, status: booking.status } };
  }};
  return { booking, calls, client };
}

for (const [previous, next] of [['confirmed', 'arrived'], ['arrived', 'completed']]) {
  test(`${previous} → ${next} → ANNULLA restores previous status through history RPC`, async () => {
    const session = createBookingStatusUndo();
    const { booking, calls, client } = fixture(previous);
    assert.equal(session.getLast(), null);
    await session.change(client, { ...booking }, next);
    assert.equal(booking.status, next);
    assert.equal(session.getLast().previousStatus, previous);
    const restored = await session.undo(client, booking);
    assert.equal(restored.status, previous);
    assert.equal(booking.status, previous);
    assert.equal(session.getLast(), null);
    assert.deepEqual(calls, [next, previous].map(status => ({
      name: 'admin_set_booking_status_with_history', body: { booking_id: 42, booking_status: status },
    })));
    assert.equal(await session.undo(client, booking), null);
    assert.equal(calls.length, 2);
  });
}

test('only the latest successful action is available; new UI session has no undo', async () => {
  const session = createBookingStatusUndo();
  const { booking, client } = fixture();
  await session.change(client, { ...booking }, 'arrived');
  await session.change(client, { ...booking }, 'completed');
  await session.undo(client, booking);
  assert.equal(booking.status, 'arrived');
  assert.equal(session.getLast(), null);
  assert.equal(createBookingStatusUndo().getLast(), null);
});

test('latest action across different bookings replaces previous undo', async () => {
  const session = createBookingStatusUndo();
  const first = fixture();
  const second = fixture('arrived');
  second.booking.id = 99;
  await session.change(first.client, { ...first.booking }, 'arrived');
  await session.change(second.client, { ...second.booking }, 'completed');
  await session.undo(second.client, second.booking);
  assert.equal(first.booking.status, 'arrived');
  assert.equal(second.booking.status, 'arrived');
  assert.equal(first.calls.length, 1);
});

test('failed undo keeps current state and allows retry without reporting success', async () => {
  const session = createBookingStatusUndo();
  const { booking, client } = fixture();
  await session.change(client, { ...booking }, 'arrived');
  const pending = session.getLast();
  await assert.rejects(session.undo({ rpc: async () => ({ error: { message: 'Accesso negato' } }) }, booking), /Accesso negato/);
  assert.equal(booking.status, 'arrived');
  assert.equal(session.getLast(), pending);
  await session.undo(client, booking);
  assert.equal(booking.status, 'confirmed');
});

test('failed change has no undo; external state changes prevent a stale restore', async () => {
  const session = createBookingStatusUndo();
  const { booking, client, calls } = fixture();
  await assert.rejects(session.change({ rpc: async () => ({ error: { message: 'Errore' } }) }, booking, 'arrived'), /Errore/);
  assert.equal(session.getLast(), null);
  await session.change(client, { ...booking }, 'arrived');
  booking.status = 'cancelled';
  await assert.rejects(session.undo(client, booking), /prenotazione è cambiata/);
  assert.equal(booking.status, 'cancelled');
  assert.equal(calls.length, 1);
  assert.equal(session.getLast(), null);
});

test('duplicate undo clicks send only one restore', async () => {
  const session = createBookingStatusUndo();
  const { booking, client } = fixture();
  await session.change(client, { ...booking }, 'arrived');
  let release;
  let count = 0;
  const delayed = { rpc: async () => { count++; return new Promise(resolve => { release = resolve; }); } };
  const restoring = session.undo(delayed, booking);
  assert.equal(await session.undo(delayed, booking), null);
  assert.equal(await session.change(delayed, booking, 'completed'), null);
  assert.equal(count, 1);
  release({ data: { booking_id: 42, status: 'confirmed' } });
  await restoring;
  assert.equal(session.getLast(), null);
});
