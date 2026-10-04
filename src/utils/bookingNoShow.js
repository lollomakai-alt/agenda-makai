import { bookingDelayState } from './bookingDelay.js';
import { bookingStatus } from './bookingStatus.js';

const labelFormat = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'medium',
});

export function noShowEligibility(booking, now = Date.now()) {
  const status = bookingStatus(booking.status);
  if (status === 'no_show') return { allowed: false, message: 'La prenotazione è già No-show: nessuna nuova operazione necessaria.' };
  if (status === 'arrived' || status === 'cancelled' || status === 'completed') {
    return { allowed: false, message: 'Lo stato attuale non consente il passaggio a No-show.' };
  }
  const delay = bookingDelayState(booking, now);
  if (delay.scheduledAt === null || delay.minutesLate === null) {
    return { allowed: false, message: 'Data o orario non validi: impossibile verificare i 30 minuti.' };
  }
  const eligibleAt = delay.scheduledAt + 30 * 60000;
  return {
    allowed: delay.canMarkNoShow,
    eligibleAt,
    message: delay.canMarkNoShow
      ? `No-show disponibile: sono trascorsi ${delay.minutesLate} minuti dall’orario previsto.`
      : `No-show disponibile dal ${labelFormat.format(eligibleAt)} (ora di Roma), dopo 30 minuti dall’orario previsto.`,
  };
}
