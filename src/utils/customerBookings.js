import { normalizePhone } from './bookingValidation.js';
import { bookingScheduledAt } from './bookingTime.js';
import { bookingStatus } from './bookingStatus.js';

function contactValues(booking) {
  return {
    userId: typeof booking.user_id === 'string' ? booking.user_id.trim() : '',
    phone: typeof booking.phone === 'string' ? normalizePhone(booking.phone) : null,
    email: typeof booking.email === 'string' ? booking.email.trim().toLowerCase() : '',
  };
}

function sameCustomer(contact, other) {
  if (contact.userId && other.userId) return contact.userId === other.userId;
  return Boolean((contact.phone && contact.phone === other.phone)
    || (contact.email && contact.email === other.email));
}

function bookingTimeValue(booking) {
  return bookingScheduledAt(booking) ?? Number.NEGATIVE_INFINITY;
}

export function customerBookings(booking, appointments) {
  const contact = contactValues(booking);
  const identifiable = Boolean(contact.userId || contact.phone || contact.email);
  const bookings = (appointments || []).filter(candidate => {
    if (String(candidate.id) === String(booking.id)) return true;
    return identifiable && sameCustomer(contact, contactValues(candidate));
  }).sort((first, second) => bookingTimeValue(second) - bookingTimeValue(first)
    || String(second.id).localeCompare(String(first.id), undefined, { numeric: true }));
  return { identifiable, bookings };
}

export function customerBookingSummary(booking, appointments) {
  const linked = customerBookings(booking, appointments);
  const noShows = linked.bookings.filter(item => bookingStatus(item.status) === 'no_show').length;
  const latestBooking = linked.bookings.find(item => bookingScheduledAt(item) !== null) || null;
  const latestVisit = linked.bookings.find(item => ['arrived', 'completed'].includes(bookingStatus(item.status))) || null;
  return {
    ...linked,
    totalBookings: linked.bookings.length,
    noShows,
    latestBooking,
    latestVisit,
  };
}

// Prefer the existing authenticated user_id. Fall back to normalized contacts
// for manual and historical rows without a customer account.
export function previousCustomerBookings(booking, appointments, now = Date.now()) {
  const contact = contactValues(booking);
  const identifiable = Boolean(contact.userId || contact.phone || contact.email);
  const currentTime = bookingScheduledAt(booking);
  if (!identifiable || currentTime === null || !Number.isFinite(now)) return { identifiable, bookings: [] };
  const boundary = Math.min(currentTime, now);
  const bookings = customerBookings(booking, appointments).bookings.filter(candidate => {
    if (String(candidate.id) === String(booking.id)) return false;
    const candidateTime = bookingScheduledAt(candidate);
    if (candidateTime === null || candidateTime >= boundary) return false;
    return true;
  });
  return { identifiable, bookings };
}

export function previousCustomerNoShowCount(booking, appointments, now = Date.now()) {
  if (['cancelled', 'no_show', 'completed'].includes(bookingStatus(booking.status))) return 0;
  return previousCustomerBookings(booking, appointments, now).bookings
    .filter(previous => bookingStatus(previous.status) === 'no_show').length;
}
