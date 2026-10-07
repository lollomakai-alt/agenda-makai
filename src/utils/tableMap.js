import tables from '../config/tables.json' with { type: 'json' };
import { TABLE_ASSIGNMENTS } from '../config/tableAssignments.js';
import { bookingStatus } from './bookingStatus.js';
import { bookingsOverlap } from './bookingTime.js';
import { bookingType } from './bookingType.js';
import { physicalTableIds, conflictingTableIds, tableConfigurationError, tableAssignmentError } from './tableConflicts.js';
import { editableBookingValues, saveBookingEdit, validateBookingEdit } from './bookingEdit.js';

export const TABLE_MAP_STATUSES = Object.freeze({ free: 'Libero', reserved: 'Prenotato', occupied: 'Occupato' });
const inactiveStatuses = new Set(['cancelled', 'no_show']);

export function tableMapForDate(appointments, date, type = 'all', referenceBooking = null) {
  const linked = new Map();
  for (const booking of appointments || []) {
    if (inactiveStatuses.has(bookingStatus(booking.status))) continue;
    if (referenceBooking ? !bookingsOverlap(referenceBooking, booking) : booking.booking_date !== date) continue;
    if (!referenceBooking && type !== 'all' && bookingType(booking.booking_type) !== type) continue;
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
    if (conflictingTableIds(candidate, appointments).length) return false;
    return manualTables || (!tableConfigurationError(candidate, appointments) && preservesUnassignedBookings(candidate, appointments));
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
  const preferences = new Map();
  const choices = Object.entries(TABLE_ASSIGNMENTS)
    .filter(([group]) => availableMapAssignments(booking, appointments, physicalTableIds(group)[0], { manualTables: true }).some(([available]) => available === group));
  for (const [group] of choices) {
    const candidate = { ...booking, tables: group };
    preferences.set(group, Number(Boolean(tableConfigurationError(candidate, appointments)))
      + Number(!preservesUnassignedBookings(candidate, appointments)));
  }
  return choices.sort((a,b) => (a[1] - Number(booking.party_size)) - (b[1] - Number(booking.party_size))
    || preferences.get(a[0]) - preferences.get(b[0])
    || physicalTableIds(a[0]).length - physicalTableIds(b[0]).length);
}

// Prefer choices that leave room for pending groups. This advisory search
// never vetoes a manual assignment or saves another booking.
export function preservesUnassignedBookings(candidate, appointments) {
  const rows = [...appointments.filter(item => String(item.id) !== String(candidate.id)), candidate]
    .filter(item => bookingsOverlap(candidate, item) && !inactiveStatuses.has(bookingStatus(item.status)));
  const pending = rows.filter(item => !String(item.tables || '').trim())
    .sort((a,b) => Number(b.party_size) - Number(a.party_size));
  if (!pending.length) return true;
  if (pending.length > 10 || pending.some(item => !Number.isSafeInteger(Number(item.party_size)) || Number(item.party_size) < 1)) return false;
  const fixed = rows.filter(item => String(item.tables || '').trim());
  if (fixed.some(item => tableAssignmentError(item.tables, Number(item.party_size), { allowOverCapacity: true })
    || conflictingTableIds(item, fixed).length || tableConfigurationError(item, fixed))) return false;
  function fit(index, assigned) {
    if (index === pending.length) return true;
    for (const [group, capacity] of Object.entries(TABLE_ASSIGNMENTS)) {
      if (capacity < Number(pending[index].party_size)) continue;
      const next = { ...pending[index], tables: group };
      if (conflictingTableIds(next, assigned).length || tableConfigurationError(next, assigned)) continue;
      if (fit(index + 1, [...assigned, next])) return true;
    }
    return false;
  }
  return fit(0, fixed);
}
