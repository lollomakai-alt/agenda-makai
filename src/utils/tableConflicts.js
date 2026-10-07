import { TABLE_ASSIGNMENTS, TABLE_15_19_CONFIGURATIONS } from '../config/tableAssignments.js';
import { bookingStatus } from './bookingStatus.js';
import { bookingsOverlap } from './bookingTime.js';

export function assignedTableIds(value) {
  return String(value || '').split(',').map(id => id.trim()).filter(Boolean);
}

export function physicalTableIds(value) {
  return assignedTableIds(value).flatMap(assignment => assignment.split('+').map(id => id.trim()).filter(Boolean));
}

export function tableAssignmentError(value, partySize, { allowOverCapacity = false } = {}) {
  const ids = assignedTableIds(value);
  if (ids.some(id => !Object.hasOwn(TABLE_ASSIGNMENTS, id))) return 'Usa soltanto le assegnazioni tavoli configurate.';
  if (new Set(ids).size !== ids.length) return 'La stessa assegnazione non può essere indicata due volte.';
  const physicalIds = physicalTableIds(value);
  if (new Set(physicalIds).size !== physicalIds.length) return 'Lo stesso tavolo fisico non può essere indicato due volte.';
  const capacity = ids.reduce((sum, id) => sum + TABLE_ASSIGNMENTS[id], 0);
  if (!allowOverCapacity && ids.length && Number.isSafeInteger(partySize) && partySize > capacity) {
    return `I tavoli selezionati hanno capienza massima ${capacity}.`;
  }
  return '';
}

function isAvailabilityBlocking(booking) {
  return !['cancelled', 'no_show'].includes(bookingStatus(booking.status));
}

export function tableConfigurationError(booking, appointments) {
  if (!isAvailabilityBlocking(booking)) return '';
  const others = appointments.filter(other => String(other.id) !== String(booking.id)
    && isAvailabilityBlocking(other) && bookingsOverlap(booking, other));
  const assignments = new Set(assignedTableIds(booking.tables));
  for (const other of others) {
    for (const assignment of assignedTableIds(other.tables)) assignments.add(assignment);
  }
  const selected = [...assignments].filter(assignment => physicalTableIds(assignment).some(id => Number(id) >= 15 && Number(id) <= 19));
  if (selected.length && !TABLE_15_19_CONFIGURATIONS.some(configuration => selected.every(assignment => configuration.includes(assignment)))) {
    return 'La configurazione dei tavoli 15-19 non è consentita.';
  }
  return '';
}

export function conflictingTableIds(booking, appointments) {
  if (!isAvailabilityBlocking(booking)) return [];
  const selected = new Set(physicalTableIds(booking.tables));
  const conflicts = new Set();
  for (const other of appointments) {
    if (String(other.id) === String(booking.id) || !bookingsOverlap(booking, other)) continue;
    if (!isAvailabilityBlocking(other)) continue;
    for (const id of physicalTableIds(other.tables)) if (selected.has(id)) conflicts.add(id);
  }
  return [...conflicts].sort((a, b) => Number(a) - Number(b));
}

export function assignedUnitCapacity(value) {
  if (tableAssignmentError(value)) return null;
  return assignedTableIds(value).reduce((sum, id) => sum + TABLE_ASSIGNMENTS[id], 0);
}

export function tableCapacityWarning(value, partySize) {
  const ids = assignedTableIds(value);
  if (!ids.length || ids.some(id => !Object.hasOwn(TABLE_ASSIGNMENTS, id))) return '';
  const capacity = ids.reduce((sum,id) => sum + TABLE_ASSIGNMENTS[id],0);
  return Number(partySize) > capacity ? `Sovracapienza: ${partySize} persone su ${capacity} posti consigliati. Scegli un’unità con capienza sufficiente.` : '';
}
