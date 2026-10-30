import { backendJson, backendReachable, isBackendUnavailable } from '../lib/backendWrite.js';

export const BOOKING_STATUSES = Object.freeze({
  confirmed: 'Confermata',
  arrived: 'Arrivato',
  completed: 'Completata',
  cancelled: 'Cancellata',
  no_show: 'No-show',
});

// Normalize reads only; writes accept exclusively the five lowercase values.
export function bookingStatus(value) {
  return value == null || value === '' ? 'confirmed' : String(value).toLowerCase();
}

export function bookingStatusLabel(value) {
  const status = bookingStatus(value);
  return BOOKING_STATUSES[status] || `Stato non riconosciuto: ${value}`;
}

// Solo transizioni supportate dal contratto di stato esistente.
export function bookingStatusAction(value) {
  const status = bookingStatus(value);
  if (status === 'confirmed') return { label: 'Arrivato', status: 'arrived' };
  if (status === 'arrived') return { label: 'Libera tavolo', status: 'completed' };
  return null;
}

export async function saveBookingStatus(client, id, status) {
  if (!Object.hasOwn(BOOKING_STATUSES, status)) throw new Error('Stato non valido.');
  if (backendReachable()) {
    try {
      const data = await backendJson(`/api/admin/bookings/${id}/status`, { body: { status } });
      if (data?.status !== status || String(data?.booking_id) !== String(id)) {
        throw new Error('Modifica non confermata. Aggiorna e verifica lo stato prima di riprovare.');
      }
      return data;
    } catch (error) {
      if (!isBackendUnavailable(error)) throw error;
    }
  }
  const { data, error } = await client.rpc(status === 'completed' ? 'admin_release_booking_table' : 'admin_set_booking_status_with_history', status === 'completed' ? { booking_id: id } : {
    booking_id: id, booking_status: status,
  });
  if (error) {
    if (status === 'completed' && error.code === 'PGRST202') throw new Error('Liberazione tavolo non configurata: applicare supabase/complete-booking-system.sql.');
    if (['PGRST202', '42703', '23514'].includes(error.code)) {
      throw new Error('Gestione storico non ancora configurata in Supabase. È necessario applicare il file supabase/booking-history.sql.');
    }
    throw new Error(error.message || 'Stato non salvato.');
  }
  if (data?.status !== status || String(data?.booking_id) !== String(id)) {
    throw new Error('Modifica non confermata. Aggiorna e verifica lo stato prima di riprovare.');
  }
  return data;
}
