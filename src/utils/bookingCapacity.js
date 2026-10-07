import { bookingsOverlap } from './bookingTime.js';
import { assignedUnitCapacity, physicalTableIds } from './tableConflicts.js';
import { bookingStatus } from './bookingStatus.js';

export const DAILY_COVER_LIMIT = 25;

export function canAcceptBooking(bookings, date, partySize, time = null, tables = '') {
  const confirmedCovers = bookings
    .filter(booking => booking.booking_date === date && bookingStatus(booking.status) === 'confirmed')
    .reduce((total, booking) => total + Number(booking.party_size), 0);
  if (confirmedCovers + Number(partySize) > DAILY_COVER_LIMIT) return false;
  if (!time) return true; // Conserva il limite giornaliero per i chiamanti senza fascia.
  const reference = { booking_date: date, booking_time: time };
  const capacity = serviceCapacity(bookings, reference);
  const required = tables ? assignedUnitCapacity(tables) : Number(partySize);
  return capacity.verified && required !== null && capacity.remaining >= required;
}

// La capacità vendibile riguarda l'unità intera, non i soli commensali.
// Usa la stessa giornata dei conflitti e il catalogo operativo, senza
// sommare le etichette duplicate della vecchia piantina (es. 10 e 11).
export function serviceCapacity(bookings, reference) {
  const rows = bookings.filter(booking => !['cancelled','no_show'].includes(bookingStatus(booking.status))
    && (reference.id == null || String(booking.id) !== String(reference.id)) && bookingsOverlap(reference, booking));
  let occupied = 0, unused = 0;
  const used = new Set();
  for (const booking of rows) {
    const people = Number(booking.party_size);
    const hasTable = Boolean(String(booking.tables || '').trim());
    const cost = hasTable ? assignedUnitCapacity(booking.tables) : people;
    const ids = physicalTableIds(booking.tables);
    if (cost === null || cost < people || !Number.isSafeInteger(people) || people < 1 || ids.some(id => used.has(id))) {
      return { total: DAILY_COVER_LIMIT, occupied: null, unused: null, remaining: 0, verified: false };
    }
    ids.forEach(id => used.add(id));
    occupied += cost;
    unused += hasTable ? Math.max(0, cost - people) : 0;
  }
  return { total: DAILY_COVER_LIMIT, occupied, unused, remaining: Math.max(0, DAILY_COVER_LIMIT - occupied), verified: true };
}
