import { bookingStatus } from './bookingStatus.js';

export const DAILY_COVER_LIMIT = 25;

export function canAcceptBooking(bookings, date, partySize) {
  const confirmedCovers = bookings
    .filter(booking => booking.booking_date === date && bookingStatus(booking.status) === 'confirmed')
    .reduce((total, booking) => total + Number(booking.party_size), 0);
  return confirmedCovers + Number(partySize) <= DAILY_COVER_LIMIT;
}