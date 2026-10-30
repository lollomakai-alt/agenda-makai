import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_ASSIGNMENTS, TABLE_15_19_CONFIGURATIONS } from '../src/config/tableAssignments.js';
import tables from '../src/config/tables.json' with { type: 'json' };
import { physicalTableIds } from '../src/utils/tableConflicts.js';
import { tableMapForDate } from '../src/utils/tableMap.js';
import { floorPlanRooms } from '../src/utils/tableFloorPlan.js';

const date = '2026-10-10';
const units = rows => floorPlanRooms(tableMapForDate(rows, date)).flatMap(room => room.units);
const unit = (rows, group) => units(rows).find(item => item.group === group);

test('floor plan covers the 14 physical tables and renders assigned groups for 2/3 covers', () => {
  const rooms = floorPlanRooms(tableMapForDate([], date));
  const plan = rooms.flatMap(room => room.units);
  assert.equal(plan.length, 14);
  assert.deepEqual(plan.flatMap(item => item.physicalIds).sort(), Object.keys(tables).sort());
  const rows = [
    { id: 1, booking_date: date, booking_time: '20:00', status: 'confirmed', party_size: 2, tables: '10+11' },
    { id: 2, booking_date: date, booking_time: '20:30', status: 'confirmed', party_size: 3, tables: '13+14' },
  ];
  const assigned = units(rows);
  assert.equal(assigned.length, 12);
  for (const group of ['10+11', '13+14']) {
    const item = assigned.find(unit => unit.group === group);
    assert.equal(item.capacity, TABLE_ASSIGNMENTS[group]);
    assert.deepEqual(item.physicalIds, physicalTableIds(group));
    assert.deepEqual(item.bookings.map(booking => booking.id), [group === '10+11' ? 1 : 2]);
  }
  assert.ok(TABLE_15_19_CONFIGURATIONS.some(configuration => configuration.includes('15+16+17')));
});

test('relative coordinates stay inside each room and units do not overlap', () => {
  for (const room of floorPlanRooms(tableMapForDate([], date))) {
    for (const item of room.units) {
      assert.ok(item.x >= 0 && item.y >= 0 && item.width > 0 && item.height > 0);
      assert.ok(item.x + item.width <= 100 && item.y + item.height <= 100);
      for (const other of room.units.filter(candidate => candidate !== item)) {
        assert.ok(item.x + item.width <= other.x || other.x + other.width <= item.x
          || item.y + item.height <= other.y || other.y + other.height <= item.y);
      }
    }
  }
});

test('grouped arrivals/occupancy retain whole assignments without double-counting linked bookings', () => {
  const rows = [
    { id: 1, booking_date: date, booking_time: '20:00', booking_type: 'cena', status: 'confirmed', party_size: 2, tables: '10+11' },
    { id: 2, booking_date: date, booking_time: '20:00', booking_type: 'cena', status: 'completed', party_size: 6, tables: '' },
    { id: 3, booking_date: date, booking_time: '23:00', booking_type: 'dopocena', status: 'confirmed', party_size: 3, tables: '15+16' },
    { id: 4, booking_date: date, booking_time: '20:00', booking_type: 'cena', status: 'arrived', party_size: 4, tables: '18+19' },
  ];
  assert.equal(unit(rows, '10+11').status, 'reserved');
  assert.equal(unit(rows, '10+11').bookings.length, 1);
  assert.equal(unit(rows, '15+16').status, 'reserved');
  assert.deepEqual(unit(rows, '15+16').bookings.map(booking => booking.id), [3]);
  assert.equal(unit(rows, '17').status, 'free');
  assert.equal(unit(rows, '18+19').status, 'occupied');
  const rowConfiguration = units(rows).filter(item => item.physicalIds.some(id => Number(id) >= 15 && Number(id) <= 19));
  const groupNames = rowConfiguration.map(item => item.group);
  assert.ok(TABLE_15_19_CONFIGURATIONS.some(configuration => configuration.length === groupNames.length
    && configuration.every(group => groupNames.includes(group))));
  const rowIds = rowConfiguration.flatMap(item => item.physicalIds);
  assert.equal(new Set(rowIds).size, rowIds.length);
  assert.equal(unit(rows, '23').status, 'free');
  assert.deepEqual(unit(rows, '17').physicalIds, physicalTableIds('17'));
});

test('elapsed times never release assigned tables; existing completed/unknown status remains conservative', t => {
  const rows = [
    { id: 1, booking_date: date, booking_time: '20:00', booking_type: 'cena', party_size: 2, status: 'confirmed', tables: '10+11' },
    { id: 2, booking_date: date, booking_time: '20:00', booking_type: 'cena', party_size: 2, status: 'arrived', tables: '12' },
    { id: 3, booking_date: date, booking_time: '20:00', booking_type: 'cena', party_size: 3, status: 'completed', tables: '13+14' },
    { id: 4, booking_date: date, booking_time: '00:00', booking_type: 'dopocena', party_size: 2, status: 'unknown', tables: '23' },
  ];
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T06:00:00Z') });
  const before = units(rows);
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.deepEqual(units(rows), before);
  assert.equal(unit(rows, '10+11').status, 'reserved');
  for (const group of ['12', '13+14', '23']) assert.equal(unit(rows, group).status, 'occupied');
  assert.ok(units(rows.map(booking => ({ ...booking, status: 'cancelled' }))).every(item => item.status === 'free'));
  assert.ok(units(rows.map(booking => ({ ...booking, status: 'no_show' }))).every(item => item.status === 'free'));
});
