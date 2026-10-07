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

test('floor plan covers every physical table once, using only valid units and existing capacities', () => {
  const rooms = floorPlanRooms(tableMapForDate([], date));
  const plan = rooms.flatMap(room => room.units);
  assert.equal(plan.length, 10);
  assert.deepEqual(plan.flatMap(item => item.physicalIds).sort(), Object.keys(tables).sort());
  for (const item of plan) {
    assert.ok(Object.hasOwn(TABLE_ASSIGNMENTS, item.group));
    assert.equal(item.capacity, TABLE_ASSIGNMENTS[item.group]);
  }
  assert.equal(plan.find(item => item.group === '10+11').capacity, 3);
  assert.ok(TABLE_15_19_CONFIGURATIONS.some(configuration => plan.filter(item =>
    item.physicalIds.some(id => Number(id) >= 15 && Number(id) <= 19)).every(item => configuration.includes(item.group))));
});

test('relative coordinates stay inside each room, do not overlap and preserve touch targets at iPhone widths', () => {
  for (const room of floorPlanRooms(tableMapForDate([], date))) {
    for (const item of room.units) {
      assert.ok(item.x >= 0 && item.y >= 0 && item.width > 0 && item.height > 0);
      assert.ok(item.x + item.width <= 100 && item.y + item.height <= 100);
      // Even a 320px viewport with 100px of total shell/room padding fits 44px targets.
      assert.ok(220 * item.width / 100 >= 44);
      assert.ok((room.name === 'Sala Nami' ? 260 : 420) * item.height / 100 >= 44);
      for (const other of room.units.filter(candidate => candidate !== item)) {
        assert.ok(item.x + item.width <= other.x || other.x + other.width <= item.x
          || item.y + item.height <= other.y || other.y + other.height <= item.y);
      }
    }
  }
});

test('grouped arrivals/occupancy retain whole assignments without double-counting linked bookings', () => {
  const rows = [
    { id: 1, booking_date: date, booking_time: '20:00', status: 'confirmed', tables: '10+11' },
    { id: 2, booking_date: date, booking_time: '20:00', status: 'arrived', tables: '15+16+17' },
    { id: 3, booking_date: date, booking_time: '22:00', status: 'confirmed', tables: '15+16', booking_type: 'dopocena' },
  ];
  assert.equal(unit(rows, '10+11').status, 'reserved');
  assert.equal(unit(rows, '10+11').bookings.length, 1);
  assert.equal(unit(rows, '15+16').status, 'occupied');
  assert.deepEqual(unit(rows, '15+16').bookings.map(booking => booking.id), [2, 3]);
  assert.equal(unit(rows, '17').status, 'occupied');
  assert.equal(unit(rows, '23').status, 'free');
  assert.deepEqual(unit(rows, '17').physicalIds, physicalTableIds('17'));
});

test('elapsed times never release assigned tables; existing completed/unknown status remains conservative', t => {
  const rows = ['confirmed', 'arrived', 'completed', 'unknown'].map((status, index) => ({
    id: index + 1, booking_date: date, booking_time: '00:00', status, tables: ['10+11', '12', '13+14', '23'][index],
  }));
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T06:00:00Z') });
  const before = units(rows);
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.deepEqual(units(rows), before);
  assert.equal(unit(rows, '10+11').status, 'reserved');
  for (const group of ['12', '13+14', '23']) assert.equal(unit(rows, group).status, 'occupied');
  assert.ok(units(rows.map(booking => ({ ...booking, status: 'cancelled' }))).every(item => item.status === 'free'));
  assert.ok(units(rows.map(booking => ({ ...booking, status: 'no_show' }))).every(item => item.status === 'free'));
});
