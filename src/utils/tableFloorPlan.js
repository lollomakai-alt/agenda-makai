import { TABLE_LAYOUT } from '../config/tableLayout.js';
import { TABLE_ASSIGNMENTS } from '../config/tableAssignments.js';
import { physicalTableIds } from './tableConflicts.js';

export const FLOOR_PLAN_STATUSES = Object.freeze({ free: 'LIBERO', reserved: 'IN ARRIVO', occupied: 'OCCUPATO' });

// Aggregate the existing physical map for display only. Never compute availability.
export function floorPlanRooms(tableMap) {
  const byId = new Map(tableMap.map(table => [table.id, table]));
  return TABLE_LAYOUT.map(room => ({ ...room, units: room.units.map(unit => {
    const physicalIds = physicalTableIds(unit.group);
    const tables = physicalIds.map(id => byId.get(id));
    const bookings = [...new Map(tables.flatMap(table => table?.bookings || []).map(booking => [String(booking.id), booking])).values()];
    const status = tables.some(table => !table || table.status === 'occupied') ? 'occupied'
      : tables.some(table => table.status === 'reserved') ? 'reserved' : 'free';
    return { ...unit, physicalIds, capacity: TABLE_ASSIGNMENTS[unit.group], bookings, status };
  }) }));
}
