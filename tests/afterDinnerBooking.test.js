import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Le fixture del servizio usano il 4 ottobre: isolare i test dalla data reale.
beforeEach(context => context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T12:00:00Z') }));
import { createAfterDinnerBooking, validateAfterDinnerBooking } from '../src/utils/afterDinnerBooking.js';

const values = {
  name: 'Mario Rossi', phone: '333 123 4567', email: '',
  date: '2026-10-04', time: '23:00', party_size: '2', notes: '', table: '',
};

test('dopocena starts at 23:00 and accepts creation without an initial table', () => {
  for (const time of ['23:00']) {
    assert.deepEqual(validateAfterDinnerBooking({ ...values, time }).errors, {});
  }
  for (const time of ['21:30', '22:00', '22:30', '22:59', '23:15', '23:30', '00:00', '00:01', '00:30']) {
    assert.ok(validateAfterDinnerBooking({ ...values, time }).errors.time);
  }
  assert.deepEqual(validateAfterDinnerBooking(values).errors, {});
  assert.ok(validateAfterDinnerBooking({ ...values, party_size: '26' }).errors.party_size);
  assert.ok(validateAfterDinnerBooking({ ...values, table: '99' }).errors.table);
  assert.ok(validateAfterDinnerBooking({ ...values, table: '12', party_size: '3' }).errors.table);
});

test('ADMIN dopocena creation sends only normalized fields and a fixed dopocena contract', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: { id: 77, booking_type: 'dopocena' }, error: null };
  } };
  const result = await createAfterDinnerBooking(client, values);
  assert.equal(result.data.id, 77);
  assert.deepEqual(calls, [{ name: 'admin_create_after_dinner_booking', args: {
    p_customer_name: 'Mario Rossi', p_customer_phone: '+393331234567', p_customer_email: '',
    p_booking_date: '2026-10-04', p_booking_time: '23:00', p_party_size: 2,
    p_notes: '', p_table_id: '',
  } }]);
  assert.equal(Object.values(calls[0].args).includes('normale'), false);
});

test('invalid dopocena never calls Supabase and missing RPC is explicit', async () => {
  const client = { rpc() { throw new Error('must not run'); } };
  const invalid = await createAfterDinnerBooking(client, { ...values, time: '21:30' });
  assert.ok(invalid.errors.time);
  await assert.rejects(createAfterDinnerBooking({ rpc: async () => ({ error: { code: 'PGRST202' } }) }, values), /non ancora configurate/);
});
