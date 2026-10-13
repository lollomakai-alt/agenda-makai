export const BOOKING_TYPES = Object.freeze({
  normale: 'Cena',
  dopocena: 'Dopocena',
});

export function bookingType(value) {
  return value === 'dopocena' ? 'dopocena' : 'normale';
}

export function bookingTypeLabel(value) {
  return BOOKING_TYPES[bookingType(value)];
}
