import { bookingStatus } from './bookingStatus.js';
import { bookingScheduledAt } from './bookingTime.js';

const excludedStatuses = new Set(['arrived', 'completed', 'cancelled', 'no_show']);
const WARNING_AFTER_MINUTES = 15;
const NO_SHOW_AFTER_MINUTES = 30;

export function bookingDelayState(booking, now = Date.now()) {
  const status = bookingStatus(booking.status);
  const scheduledAt = bookingScheduledAt(booking);
  if (excludedStatuses.has(status) || scheduledAt === null || !Number.isFinite(now)) {
    return {
      scheduledAt, minutesLate: null, showWarning: false, canMarkNoShow: false,
    };
  }

  const elapsedMs = now - scheduledAt;
  const minutesLate = Math.floor(elapsedMs / 60000);
  return {
    scheduledAt,
    minutesLate,
    showWarning: elapsedMs >= WARNING_AFTER_MINUTES * 60000,
    canMarkNoShow: elapsedMs >= NO_SHOW_AFTER_MINUTES * 60000,
  };
}

export function bookingDelayNotification(booking, now = Date.now()) {
  if (booking.id == null) return null;
  const delay = bookingDelayState(booking, now);
  if (!delay.showWarning) return null;
  return {
    id: `customer-delay-${booking.id}`,
    bookingId: booking.id,
    minutesLate: delay.minutesLate,
    message: `Cliente non ancora arrivato · ${delay.minutesLate} min di ritardo`,
  };
}
