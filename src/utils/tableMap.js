import tables from '../config/tables.json' with { type: 'json' };
import { TABLE_ASSIGNMENTS } from '../config/tableAssignments.js';
import { bookingStatus } from './bookingStatus.js';
import { bookingType } from './bookingType.js';
import { physicalTableIds, conflictingTableIds, tableConfigurationError, tableAssignmentError } from './tableConflicts.js';
import { editableBookingValues, saveBookingEdit, validateBookingEdit } from './bookingEdit.js';

export const TABLE_MAP_STATUSES = Object.freeze({ free: 'Libero', reserved: 'Prenotato', occupied: 'Occupato' });
const inactiveStatuses = new Set(['cancelled', 'no_show']);

export function tableMapForDate(appointments, date, type = 'all') {
  const linked = new Map();
  for (const booking of appointments || []) {
    if (booking.booking_date !== date || inactiveStatuses.has(bookingStatus(booking.status))) continue;
    if (type !== 'all' && bookingType(booking.booking_type) !== type) continue;
    for (const tableId of new Set(physicalTableIds(booking.tables))) {
      if (!Object.hasOwn(tables, tableId)) continue;
      if (!linked.has(tableId)) linked.set(tableId, []);
      linked.get(tableId).push(booking);
    }
  }
  return Object.entries(tables).map(([id, capacity]) => {
    const bookings = linked.get(id) || [];
    const occupied = bookings.some(booking => bookingStatus(booking.status) !== 'confirmed');
    return { id, capacity, status: occupied ? 'occupied' : bookings.length ? 'reserved' : 'free',
      bookingTypes: [...new Set(bookings.map(booking => bookingType(booking.booking_type)))], bookings };
  });
}

export function tableRooms(tableMap) {
  return [
    { name: 'Sala Principale', tables: tableMap.filter(table => Number(table.id) >= 10 && Number(table.id) <= 19) },
    { name: 'Sala Nami', tables: tableMap.filter(table => Number(table.id) >= 20 && Number(table.id) <= 23) },
  ];
}

export function unverifiedTableBookings(appointments, date, type = 'all') {
  return (appointments || []).filter(booking => booking.booking_date === date && !inactiveStatuses.has(bookingStatus(booking.status))
    && (type === 'all' || bookingType(booking.booking_type) === type)
    && (!physicalTableIds(booking.tables).length || Boolean(tableAssignmentError(booking.tables, Number(booking.party_size)))));
}

export function tableGroupsForPhysicalTable(id) {
  return Object.entries(TABLE_ASSIGNMENTS).filter(([group]) => physicalTableIds(group).includes(String(id)));
}

export function availableMapAssignments(booking, appointments, tableId) {
  if (!booking || !['confirmed','arrived'].includes(bookingStatus(booking.status))) return [];
  return tableGroupsForPhysicalTable(tableId).filter(([tables]) => {
    const values = { ...editableBookingValues(booking), tables };
    if (Object.keys(validateBookingEdit(values, booking).errors).length) return false;
    const candidate = { ...booking, tables };
    return !conflictingTableIds(candidate, appointments).length && !tableConfigurationError(candidate, appointments);
  });
}

export async function assignMapTable(client, booking, tables, appointments, tableId) {
  if (!availableMapAssignments(booking, appointments, tableId).some(([group]) => group === tables)) {
    throw new Error('Assegnazione non disponibile: controlla capienza, configurazione e conflitti.');
  }
  return saveBookingEdit(client, booking, { ...editableBookingValues(booking), tables }, appointments);
}

// Solo suggerimento UI: le disponibilità e il salvataggio usano i controlli esistenti.
export function rankedMapAssignments(booking, appointments) {
  return Object.entries(TABLE_ASSIGNMENTS)
    .filter(([group]) => availableMapAssignments(booking, appointments, physicalTableIds(group)[0]).some(([available]) => available === group))
    .sort((a, b) => a[1] - b[1] || physicalTableIds(a[0]).length - physicalTableIds(b[0]).length);
}
