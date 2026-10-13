import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import tables from '../src/config/tables.json' with { type: 'json' };
import { TABLE_ASSIGNMENTS, TABLE_15_19_CONFIGURATIONS } from '../src/config/tableAssignments.js';
import { floorPlanRooms } from '../src/utils/tableFloorPlan.js';
import { rankedMapAssignments, tableMapForDate } from '../src/utils/tableMap.js';
import { landscapeTablePosition, mobilePhysicalRows, mobileTableRooms, orderedMapChoices } from '../src/utils/tableMapPresentation.js';

const date = '2026-10-10';
const present = bookings => {
  const map = tableMapForDate(bookings, date);
  return mobileTableRooms(floorPlanRooms(map), map);
};
const groups = room => room.units.map(unit => unit.group);

test('iPhone list orders configured physical tables without a phantom table 24', () => {
  const rooms = present([]);
  const main = rooms.find(room => room.name === 'Sala Principale');
  const nami = rooms.find(room => room.name === 'Sala Nami');
  assert.deepEqual(groups(main), ['10+11', '12', '13+14', '15+16', '17', '18', '19']);
  assert.deepEqual(groups(nami), ['20+21', '22', '23']);
  const allIds = rooms.flatMap(room => room.units.flatMap(unit => unit.physicalIds));
  assert.deepEqual([...allIds].sort((a, b) => Number(a) - Number(b)), Object.keys(tables));
  assert.equal(Object.hasOwn(tables, '24'), false);
  assert.equal(new Set(allIds).size, allIds.length);
  assert.deepEqual(mobilePhysicalRows(main).map(row => [row.label, groups(row)]), [
    ['Fila 10–14', ['10+11', '12', '13+14']],
    ['Fila 15–19', ['15+16', '17', '18', '19']],
  ]);
  assert.deepEqual(mobilePhysicalRows(nami).map(row => [row.label, groups(row)]), [
    ['Fila 20–21', ['20+21']], ['Fila 22–23', ['22', '23']],
  ]);
});

test('iPhone presents the chosen valid row combination and combined Nami unit once', () => {
  const tableMap = tableMapForDate([], date);
  const rooms = floorPlanRooms(tableMap);
  for (const [preferred, expected] of [
    ['15+16+17', TABLE_15_19_CONFIGURATIONS[0]],
    ['18+19', TABLE_15_19_CONFIGURATIONS[1]],
    ['15+16', TABLE_15_19_CONFIGURATIONS[2]],
  ]) {
    const main = mobileTableRooms(rooms, tableMap, preferred).find(room => room.name === 'Sala Principale');
    assert.deepEqual(groups(main).slice(3), expected);
    const ids = main.units.flatMap(unit => unit.physicalIds);
    assert.equal(new Set(ids).size, ids.length);
  }
  const nami = mobileTableRooms(rooms, tableMap, '22+23').find(room => room.name === 'Sala Nami');
  assert.deepEqual(groups(nami), ['20+21', '22+23']);
});

test('recommendation orders existing available choices without excluding manual alternatives', () => {
  const booking = { id: 1, booking_date: date, booking_time: '20:00', booking_type: 'normale',
    status: 'confirmed', party_size: 4, tables: '' };
  const available = rankedMapAssignments(booking, []);
  const ordered = orderedMapChoices(available, booking.party_size);
  assert.equal(ordered[0][0], '15+16');
  assert.deepEqual(new Set(ordered.map(([group]) => group)), new Set(available.map(([group]) => group)));
  assert.ok(ordered.some(([group]) => group === '22+23'));
  assert.ok(ordered.some(([group]) => group === '12'), 'manual over-capacity remains a visible option');
  assert.equal(orderedMapChoices(available, 4, '15+16')[0][0], '18+19');
  assert.equal(orderedMapChoices(rankedMapAssignments({ ...booking, party_size: 6 }, []), 6)[0][0], '15+16+17');
});

for (const [index, configuration] of TABLE_15_19_CONFIGURATIONS.entries()) {
  test(`iPhone row 15–19 configuration ${index + 1} has no missing or overlapping tables`, () => {
    const bookings = configuration.map((group, position) => ({
      id: position + 1, booking_date: date, booking_time: '20:00', booking_type: 'normale',
      status: position ? 'arrived' : 'confirmed', tables: group, party_size: TABLE_ASSIGNMENTS[group],
      name: `Cliente ${position + 1}`,
    }));
    const room = present(bookings).find(item => item.name === 'Sala Principale');
    assert.deepEqual(groups(room).slice(3), configuration);
    const physicalIds = room.units.flatMap(unit => unit.physicalIds);
    assert.deepEqual([...physicalIds].sort((a, b) => Number(a) - Number(b)),
      ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19']);
    assert.equal(new Set(physicalIds).size, physicalIds.length);
    for (const unit of room.units.slice(3)) {
      assert.equal(unit.capacity, TABLE_ASSIGNMENTS[unit.group]);
      assert.deepEqual(unit.bookings.map(booking => booking.tables), [unit.group]);
    }
  });
}

test('iPad and desktop keep both physical sides distinct without clipping or overlap', () => {
  for (const width of [768, 1024, 1440]) {
    const canvas = Math.min(width - 32, 1100);
    const square = Math.max(44, Math.min(0.16 * canvas, 56));
    const layouts = [
      ...TABLE_15_19_CONFIGURATIONS.map(configuration =>
        ['Sala Principale', ['10+11', '12', '13+14', ...configuration], 300]),
      ['Sala Principale', Array.from({ length: 10 }, (_, index) => String(index + 10)), 300],
      ['Sala Nami', ['20+21', '22', '23'], 210],
      ['Sala Nami', ['20+21', '22+23'], 210],
      ['Sala Nami', ['20', '21', '22', '23'], 210],
    ];
    for (const [room, groups, height] of layouts) {
      const rectangles = groups.map(group => {
        const physicalIds = group.split('+');
        const position = landscapeTablePosition({ physicalIds }, room);
        const centerX = position.x / 100 * canvas;
        const centerY = position.y / 100 * height;
        const halfWidth = physicalIds.length * square / 2;
        const halfHeight = square / 2;
        return { group, left: centerX - halfWidth, right: centerX + halfWidth,
          top: centerY - halfHeight, bottom: centerY + halfHeight };
      });
      for (const rectangle of rectangles) {
        assert.ok(rectangle.left >= 0 && rectangle.right <= canvas && rectangle.top >= 0 && rectangle.bottom <= height,
          `${width}px: ${rectangle.group} rimane nel perimetro di ${room}`);
      }
      for (let first = 0; first < rectangles.length; first++) {
        for (let second = first + 1; second < rectangles.length; second++) {
          const left = rectangles[first], right = rectangles[second];
          assert.ok(left.right <= right.left || right.right <= left.left
            || left.bottom <= right.top || right.bottom <= left.top,
          `${width}px: ${left.group} e ${right.group} non si sovrappongono`);
        }
      }
    }
  }
  const css = readFileSync(new URL('../src/styles/admin-operations.css', import.meta.url), 'utf8');
  assert.match(css, /@media screen and \(max-width: 700px\)/);
  assert.match(css, /@media screen and \(min-width: 701px\)/);
  assert.match(css, /floor-plan-selected-detail/);
});
