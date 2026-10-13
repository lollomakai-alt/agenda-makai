import { TABLE_LAYOUT } from '../config/tableLayout.js';
import { TABLE_ASSIGNMENTS } from '../config/tableAssignments.js';
import { physicalTableIds } from './tableConflicts.js';

export const FLOOR_PLAN_STATUSES = Object.freeze({ free: 'LIBERO', reserved: 'IN ARRIVO', occupied: 'OCCUPATO' });

// Aggregate the existing physical map for display only. Never compute availability.
export function floorPlanRooms(tableMap) {
  const byId = new Map(tableMap.map(table => [table.id, table]));
  const assignedBookings = [...new Map(tableMap.flatMap(table => table.bookings || [])
    .map(booking => [String(booking.id), booking])).values()];
  return TABLE_LAYOUT.map(room => {
    const joined = Object.keys(TABLE_ASSIGNMENTS)
      .filter(group => group.includes('+') && assignedBookings.some(booking =>
        String(booking.tables || '').split(',').map(value => value.trim()).includes(group)))
      .map(group => {
        const ids = physicalTableIds(group);
        const members = room.units.filter(unit => ids.includes(unit.group));
        if (members.length !== ids.length) return null;
        const left = Math.min(...members.map(unit => unit.x));
        const top = Math.min(...members.map(unit => unit.y));
        const right = Math.max(...members.map(unit => unit.x + unit.width));
        const bottom = Math.max(...members.map(unit => unit.y + unit.height));
        return { group, x: left, y: top, width: right - left, height: bottom - top };
      })
      .filter(Boolean)
      .sort((a, b) => physicalTableIds(b.group).length - physicalTableIds(a.group).length);
    const joinedIds = new Set();
    const visibleJoined = joined.filter(unit => {
      const ids = physicalTableIds(unit.group);
      if (ids.some(id => joinedIds.has(id))) return false;
      ids.forEach(id => joinedIds.add(id));
      return true;
    });
    const layoutUnits = [
      ...room.units.filter(unit => !physicalTableIds(unit.group).some(id => joinedIds.has(id))),
      ...visibleJoined,
    ];
    return { ...room, units: layoutUnits.map(unit => {
      const physicalIds = physicalTableIds(unit.group);
      const tables = physicalIds.map(id => byId.get(id));
      const bookings = [...new Map(tables.flatMap(table => table?.bookings || []).map(booking => [String(booking.id), booking])).values()];
      const status = tables.some(table => !table || table.status === 'occupied') ? 'occupied'
        : tables.some(table => table.status === 'reserved') ? 'reserved' : 'free';
      const capacity = TABLE_ASSIGNMENTS[unit.group]
        ?? tables.reduce((sum, table) => sum + (Number(table?.capacity) || 0), 0);
      return { ...unit, physicalIds, capacity, bookings, status };
    }) };
  });
}
