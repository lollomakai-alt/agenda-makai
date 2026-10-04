import { normalizePhone } from './bookingValidation.js';

export function bookingCallUrl(phone) {
  if (typeof phone !== 'string' || !phone.trim()) return null;
  const normalized = normalizePhone(phone);
  return normalized ? `tel:${normalized}` : null;
}
