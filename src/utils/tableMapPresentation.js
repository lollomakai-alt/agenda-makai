import { TABLE_ASSIGNMENTS, TABLE_15_19_CONFIGURATIONS } from '../config/tableAssignments.js';
import { physicalTableIds } from './tableConflicts.js';

const sortedIds = ids => [...ids].sort((a, b) => Number(a) - Number(b));
const firstId = group => Number(physicalTableIds(group)[0]);

function configuredRowGroups(tableMap, preferredGroup = '') {
  const assigned = new Set(tableMap.flatMap(table => table.bookings || [])
    .flatMap(booking => String(booking.tables || '').split(',').map(value => value.trim()))
    .filter(group => physicalTableIds(group).some(id => Number(id) >= 15 && Number(id) <= 19)));
  if (preferredGroup && physicalTableIds(preferredGroup).some(id => Number(id) >= 15 && Number(id) <= 19)) {
    assigned.add(preferredGroup);
  }
  const matching = [...TABLE_15_19_CONFIGURATIONS].reverse().find(configuration =>
    [...assigned].every(group => configuration.includes(group)));
  return matching || null;
}

function visibleUnit(group, tableMap) {
  const physicalIds = physicalTableIds(group);
  const tables = physicalIds.map(id => tableMap.find(table => table.id === id)).filter(Boolean);
  if (tables.length !== physicalIds.length) return null;
  const bookings = [...new Map(tables.flatMap(table => table.bookings || [])
    .map(booking => [String(booking.id), booking])).values()];
  const status = tables.some(table => table.status === 'occupied') ? 'occupied'
    : tables.some(table => table.status === 'reserved') ? 'reserved' : 'free';
  return { group, physicalIds, capacity: TABLE_ASSIGNMENTS[group]
    ?? tables.reduce((sum, table) => sum + Number(table.capacity || 0), 0), bookings, status };
}

// Presentation only: each room is a partition of configured physical tables.
export function mobileTableRooms(rooms, tableMap, preferredGroup = '') {
  const byId = new Set(tableMap.map(table => table.id));
  return rooms.map(room => {
    let groups;
    if (room.name === 'Sala Principale') {
      const row = configuredRowGroups(tableMap, preferredGroup);
      const rowGroups = row || room.units.filter(unit => unit.physicalIds.some(id => Number(id) >= 15 && Number(id) <= 19))
        .map(unit => unit.group);
      groups = ['10+11', '12', '13+14', ...rowGroups];
    } else {
      const hasCombined22 = preferredGroup === '22+23' || room.units.some(unit => unit.group === '22+23');
      groups = ['20+21', ...(hasCombined22 ? ['22+23'] : ['22', '23'])];
      if (byId.has('24')) groups.push('24');
    }
    const units = groups.map(group => visibleUnit(group, tableMap)).filter(Boolean)
      .sort((left, right) => firstId(left.group) - firstId(right.group));
    return { ...room, units };
  }).sort((left, right) => Number(left.name !== 'Sala Principale') - Number(right.name !== 'Sala Principale'));
}

export function mobilePhysicalRows(room) {
  const definitions = room.name === 'Sala Principale'
    ? [['Fila 10–14', 10, 14], ['Fila 15–19', 15, 19]]
    : [['Fila 20–21', 20, 21], ['Fila 22–24', 22, 24]];
  return definitions.map(([label, start, end]) => ({
    label: room.name === 'Sala Nami' && end === 24 && !room.units.some(unit => unit.physicalIds.includes('24'))
      ? 'Fila 22–23' : label,
    units: room.units.filter(unit => {
      const first = Number(unit.physicalIds[0]);
      return first >= start && first <= end;
    }),
  })).filter(row => row.units.length);
}

// Order only the valid candidates returned by the existing availability helper.
export function orderedMapChoices(choices, partySize, currentGroup = '') {
  const people = Number(partySize);
  return [...choices].sort(([leftGroup, leftCapacity], [rightGroup, rightCapacity]) => {
    const score = (group, capacity) => [
      capacity >= people ? 0 : 1,
      group === currentGroup ? 1 : 0,
      capacity >= people ? capacity - people : people - capacity,
      physicalTableIds(group).length,
      Number(physicalTableIds(group)[0]),
    ];
    const left = score(leftGroup, leftCapacity);
    const right = score(rightGroup, rightCapacity);
    for (let index = 0; index < left.length; index++) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return leftGroup.localeCompare(rightGroup);
  });
}

// Keep the two sides of the main room and the Nami clusters distinct in a wide plan.
export function landscapeTablePosition(unit, roomName) {
  const ids = sortedIds(unit.physicalIds).map(Number);
  const positions = roomName === 'Sala Nami'
    ? ids.map(id => ({
      20: { x: 25, y: 75 }, 21: { x: 25, y: 25 },
      22: { x: 75, y: 15 }, 23: { x: 75, y: 50 }, 24: { x: 75, y: 85 },
    })[id])
    : ids.map(id => ({ x: id <= 14 ? 25 : 75,
      y: ({ 10: 90, 11: 70, 12: 50, 13: 30, 14: 10,
        15: 10, 16: 30, 17: 50, 18: 70, 19: 90 })[id] }));
  return {
    x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
    y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
  };
}
