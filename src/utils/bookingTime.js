import { isDay } from './calendar.js';

const romeParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function localTimestamp(epoch) {
  const parts = Object.fromEntries(romeParts.formatToParts(epoch).map(part => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
}


export function bookingScheduledAt(booking) {
  const time = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(booking.booking_time || '');
  if (!isDay(booking.booking_date) || !time) {
    return null;
  }
  const operationalOffset = booking.booking_type === 'dopocena' && time[1] === '00' ? 86400000 : 0;
  const wallTime = operationalOffset + Date.parse(`${booking.booking_date}T${time[1]}:${time[2]}:${time[3] || '00'}Z`);
  // Interpret the stored wall time in Rome, independently of the browser zone.
  const offsets = [...new Set([-86400000, 0, 86400000].map(delta =>
    localTimestamp(wallTime + delta) - (wallTime + delta)))];
  const matches = offsets.map(offset => wallTime - offset).filter(epoch => localTimestamp(epoch) === wallTime);
  // Match PostgreSQL: standard-time occurrence for ambiguous/nonexistent DST times.
  return matches.length ? Math.max(...matches) : wallTime - Math.min(...offsets);
}

export function isValidBookingTimeForType(booking) {
  const scheduledAt = bookingScheduledAt(booking);
  if (scheduledAt === null) return false;

  const start = booking.booking_type === 'dopocena' ? '22:30' : '19:00';
  const end = booking.booking_type === 'dopocena' ? '00:00' : '22:30';
  if (!['normale', 'dopocena'].includes(booking.booking_type)) return false;

  const startAt = bookingScheduledAt({ ...booking, booking_time: start });
  const endAt = bookingScheduledAt({ ...booking, booking_time: end });
  const slotDuration = 30 * 60 * 1000;
  if (scheduledAt < startAt || scheduledAt > endAt) return false;
  return booking.booking_type === 'dopocena' || scheduledAt % slotDuration === 0;
}


// The date scopes the service; elapsed time never releases an assignment.
// Keep the existing predicate name for callers shared with the SQL/backend.
export function bookingsOverlap(left, right) {
  return !isDay(left.booking_date) || !isDay(right.booking_date)
    || left.booking_date === right.booking_date;
}
