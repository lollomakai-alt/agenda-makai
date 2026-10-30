import { bookingStatus, bookingStatusAction, saveBookingStatus } from './bookingStatus.js';
import { backendJson, backendReachable, isBackendUnavailable } from '../lib/backendWrite.js';

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
          ? { bookingId: booking.id, name: booking.name, previousStatus, status, ...(status === "completed" ? { previousTables:booking.tables || "" } : {}) }
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
        let result;
        if(last.status==='completed') {
          if (backendReachable()) {
            try {
              result = await backendJson(`/api/admin/bookings/${last.bookingId}/restore-table`, {
                body: { previous_tables: last.previousTables },
              });
              if(result?.status!=='arrived' || String(result.booking_id)!==String(last.bookingId)) throw new Error('Ripristino non confermato. Aggiorna la pagina.');
            } catch (error) {
              if (!isBackendUnavailable(error)) throw error;
              result = null;
            }
          }
          if (!result) {
            const response=await client.rpc('admin_restore_released_table',{booking_id:last.bookingId,previous_tables:last.previousTables});
            if(response.error) throw new Error(response.error.message || 'Tavolo già riassegnato: impossibile annullare.');
            result=response.data;
            if(result?.status!=='arrived' || String(result.booking_id)!==String(last.bookingId)) throw new Error('Ripristino non confermato. Aggiorna la pagina.');
          }
        } else result = await saveBookingStatus(client, last.bookingId, last.previousStatus);
        last = null;
        return result;
      } finally { busy = false; }
    },
  };
}
