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
  const wallTime = Date.parse(`${booking.booking_date}T${time[1]}:${time[2]}:${time[3] || '00'}Z`);
  // Interpret the stored wall time in Rome, independently of the browser zone.
  const offsets = [...new Set([-86400000, 0, 86400000].map(delta =>
    localTimestamp(wallTime + delta) - (wallTime + delta)))];
  const matches = offsets.map(offset => wallTime - offset).filter(epoch => localTimestamp(epoch) === wallTime);
  // Match PostgreSQL: standard-time occurrence for ambiguous/nonexistent DST times.
  return matches.length ? Math.max(...matches) : wallTime - Math.min(...offsets);
}
