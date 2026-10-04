import { REQUEST_TYPES } from './bookingRequests.js';
import { bookingStatusLabel } from './bookingStatus.js';

const fields = {
  status: 'Stato', booking_date: 'Data', booking_time: 'Orario',
  party_size: 'Persone', tables: 'Tavolo', notes: 'Note',
};

export function historyChanges(entry) {
  if (entry.action === 'waitlist_converted') return [`Voce lista d’attesa #${entry.new_data?.waitlist_id}`, `Tavolo: ${entry.new_data?.tables || '—'}`];
  if (entry.action?.startsWith('customer_request_')) {
    const data = entry.new_data || {};
    return [`Richiesta #${data.request_id}: ${REQUEST_TYPES[data.request_type] || data.request_type}${data.requested_value == null ? '' : ` → ${data.requested_value}`}`, `Esito: ${{ pending: 'In attesa', approved: 'Approvata', rejected: 'Rifiutata' }[data.request_status] || data.request_status}`];
  }
  return Object.entries(fields).flatMap(([key, label]) => {
    const before = entry.old_data?.[key];
    const after = entry.new_data?.[key];
    if (before === after) return [];
    const display = value => value == null || value === '' ? '—'
      : key === 'status' ? bookingStatusLabel(value) : String(value);
    return [`${label}: ${display(before)} → ${display(after)}`];
  });
}

export async function loadBookingHistory(client, bookingId) {
  const { data, error } = await client.from('booking_history')
    .select('id,booking_id,action,old_data,new_data,created_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false }).order('id', { ascending: false });
  if (error) throw new Error(`Storico non disponibile: ${error.message}`);
  return data || [];
}
