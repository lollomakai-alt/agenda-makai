import { bookingStatus, bookingStatusAction, saveBookingStatus } from './bookingStatus.js';

// Una sola azione in memoria, limitata alla vita della pagina. Ogni scrittura
// passa dalla RPC esistente, compreso il ripristino e il relativo storico.
export function createBookingStatusUndo() {
  let last = null;
  let busy = false;
  return {
    getLast: () => last,
    async change(client, booking, status) {
      if (busy) return null;
      busy = true;
      try {
        const previousStatus = bookingStatus(booking.status);
        const result = await saveBookingStatus(client, booking.id, status);
        last = bookingStatusAction(previousStatus)?.status === status
          ? { bookingId: booking.id, name: booking.name, previousStatus, status }
          : null;
        return result;
      } finally { busy = false; }
    },
    async undo(client, booking) {
      if (busy || !last) return null;
      if (!booking || String(booking.id) !== String(last.bookingId) || bookingStatus(booking.status) !== last.status) {
        last = null;
        throw new Error('La prenotazione è cambiata. Aggiorna e verifica lo stato.');
      }
      busy = true;
      try {
        const result = await saveBookingStatus(client, last.bookingId, last.previousStatus);
        last = null;
        return result;
      } finally { busy = false; }
    },
  };
}
