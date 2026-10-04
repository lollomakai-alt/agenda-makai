import tables from '../config/tables.json' with { type: 'json' };
import { TABLE_ASSIGNMENTS } from '../config/tableAssignments.js';
import { bookingStatus } from './bookingStatus.js';
import { bookingType } from './bookingType.js';
import { physicalTableIds, conflictingTableIds, tableConfigurationError, tableAssignmentError, assignedTableIds } from './tableConflicts.js';
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
    && (!physicalTableIds(booking.tables).length || Boolean(tableAssignmentError(booking.tables, Number(booking.party_size), { allowOverCapacity: true }))));
}

export function tableGroupsForPhysicalTable(id) {
  return Object.entries(TABLE_ASSIGNMENTS).filter(([group]) => physicalTableIds(group).includes(String(id)));
}

export function availableMapAssignments(booking, appointments, tableId, { manualTables = false } = {}) {
  if (!booking || !['confirmed','arrived'].includes(bookingStatus(booking.status))) return [];
  return tableGroupsForPhysicalTable(tableId).filter(([tables]) => {
    const values = { ...editableBookingValues(booking), tables };
    if (Object.keys(validateBookingEdit(values, booking, { manualTables }).errors).length) return false;
    const candidate = { ...booking, tables };
    return !conflictingTableIds(candidate, appointments).length && !tableConfigurationError(candidate, appointments) && preservesUnassignedBookings(candidate, appointments);
  });
}

export async function assignMapTable(client, booking, tables, appointments, tableId) {
  if (!availableMapAssignments(booking, appointments, tableId, { manualTables: true }).some(([group]) => group === tables)) {
    throw new Error('Assegnazione non disponibile: controlla capienza, configurazione e conflitti.');
  }
  return saveBookingEdit(client, booking, { ...editableBookingValues(booking), tables }, appointments, { manualTables: true });
}

// Solo suggerimento UI: le disponibilità e il salvataggio usano i controlli esistenti.
export function rankedMapAssignments(booking, appointments) {
  return Object.entries(TABLE_ASSIGNMENTS)
    .filter(([group]) => availableMapAssignments(booking, appointments, physicalTableIds(group)[0]).some(([available]) => available === group))
    .sort((a, b) => a[1] - b[1] || physicalTableIds(a[0]).length - physicalTableIds(b[0]).length);
}

// An explicit staff assignment must leave room for every pending confirmed
// group. Choices remain suggestions; this search never saves another booking.
export function preservesUnassignedBookings(candidate, appointments) {
  const rows = [...appointments.filter(item => String(item.id) !== String(candidate.id)), candidate]
    .filter(item => item.booking_date === candidate.booking_date && bookingType(item.booking_type) === bookingType(candidate.booking_type)
      && !inactiveStatuses.has(bookingStatus(item.status)));
  const pending = rows.filter(item => !String(item.tables || '').trim());
  if (!pending.length) return true;
  const used = new Set();
  const groups = [];
  for (const item of rows.filter(item => String(item.tables || '').trim())) {
    if (tableAssignmentError(item.tables, Number(item.party_size), { allowOverCapacity: true })) return false;
    for (const id of physicalTableIds(item.tables)) { if (used.has(id)) return false; used.add(id); }
    groups.push(...assignedTableIds(item.tables));
  }
  const parties = pending.map(item => Number(item.party_size)).sort((a,b) => b-a);
  if (parties.some(size => !Number.isSafeInteger(size) || size < 1) || parties.length > 10) return false;
  function fit(index, occupied, selected, minimum = '') {
    if (index === parties.length) return true;
    for (const [group, capacity] of Object.entries(TABLE_ASSIGNMENTS)) {
      const ids = physicalTableIds(group);
      if (capacity < parties[index] || group <= minimum || ids.some(id => occupied.has(id))) continue;
      const next = [...selected, group];
      if (tableConfigurationError({ ...candidate, tables: next.join(',') }, [])) continue;
      if (fit(index+1, new Set([...occupied,...ids]), next, parties[index+1] === parties[index] ? group : '')) return true;
    }
    return false;
  }
  return !tableConfigurationError({ ...candidate, tables: groups.join(',') }, []) && fit(0,used,groups);
}
