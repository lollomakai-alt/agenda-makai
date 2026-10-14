import { TABLE_ASSIGNMENTS, TABLE_15_19_CONFIGURATIONS } from '../config/tableAssignments.js';
import { bookingsOverlap } from './bookingTime.js';
import { assignedUnitCapacity, physicalTableIds } from './tableConflicts.js';
import { bookingStatus } from './bookingStatus.js';

export const DAILY_COVER_LIMIT = 26; // Physical maximum per service, enforced separately.
export function physicalDinnerCapacity() {
  const flexible = new Set(TABLE_15_19_CONFIGURATIONS.flat());
  const fixed = Object.entries(TABLE_ASSIGNMENTS).filter(([id]) => !flexible.has(id) && id !== '22+23').reduce((n,[,cap])=>n+cap,0);
  return fixed + Math.max(...TABLE_15_19_CONFIGURATIONS.map(config=>config.reduce((n,id)=>n+TABLE_ASSIGNMENTS[id],0)));
}

export function canAcceptBooking(bookings, date, partySize, time = null, tables = '', type = 'normale') {
  if (!Number.isSafeInteger(Number(partySize)) || Number(partySize) < 1) return false;
  const active = bookings.filter(b => b.booking_date === date && (b.booking_type || 'normale') === type && !['cancelled','no_show'].includes(bookingStatus(b.status)));
  if (type === 'dopocena') return !tables && active.reduce((n,b) => n+Number(b.party_size),0)+Number(partySize)<=26;
  const capacity = serviceCapacity(active, { booking_date:date, booking_time:time, booking_type:type });
  const required = tables ? assignedUnitCapacity(tables) : Number(partySize);
  return capacity.verified && required !== null
    && (!tables || required >= Number(partySize))
    && capacity.peopleRemaining >= Number(partySize)
    && capacity.physicalRemaining >= required;
}

// La capacità vendibile riguarda l'unità intera, non i soli commensali.
// Usa la stessa giornata dei conflitti e il catalogo operativo, senza
// sommare le etichette duplicate della vecchia piantina (es. 10 e 11).
export function serviceCapacity(bookings, reference) {
  const rows = bookings.filter(booking => !['cancelled','no_show'].includes(bookingStatus(booking.status))
    && (booking.booking_type || 'normale') === (reference.booking_type || 'normale')
    && (reference.id == null || String(booking.id) !== String(reference.id)) && bookingsOverlap(reference, booking));
  let occupied = 0, unused = 0, peopleReserved = 0;
  const used = new Set();
  for (const booking of rows) {
    const people = Number(booking.party_size);
    const hasTable = Boolean(String(booking.tables || '').trim());
    const released = !hasTable && (bookingStatus(booking.status) === 'completed' || booking.table_released_at);
    const cost = released ? 0 : hasTable ? assignedUnitCapacity(booking.tables) : people;
    const ids = physicalTableIds(booking.tables);
    if (cost === null || !Number.isSafeInteger(people) || people < 1 || ids.some(id => used.has(id))) {
      return { total: physicalDinnerCapacity(), occupied: null, peopleReserved: null, unused: null, remaining: 0, physicalRemaining: 0, peopleRemaining: 0, verified: false };
    }
    ids.forEach(id => used.add(id));
    occupied += cost;
    peopleReserved += people;
    unused += hasTable ? Math.max(0, cost - people) : 0;
  }
  const total = physicalDinnerCapacity();
  const physicalRemaining = Math.max(0, total - occupied);
  const peopleRemaining = Math.max(0, DAILY_COVER_LIMIT - peopleReserved);
  return { total, occupied, peopleReserved, unused, physicalRemaining, peopleRemaining,
    remaining: Math.min(physicalRemaining, peopleRemaining), verified: true };
}
