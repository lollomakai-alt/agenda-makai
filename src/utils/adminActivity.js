import { historyChanges } from './bookingHistory.js';

const romeDateFormat = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Rome',
});

export const ACTIVITY_ACTIONS = Object.freeze({
  booking_created: 'Prenotazione creata',
  booking_updated: 'Prenotazione modificata',
  status_changed: 'Cambio stato',
  customer_request_created: 'Richiesta cliente ricevuta',
  customer_request_approved: 'Richiesta cliente approvata',
  customer_request_rejected: 'Richiesta cliente rifiutata',
  created: 'Voce lista d’attesa creata',
  status_changed_waitlist: 'Stato lista d’attesa modificato',
  converted: 'Voce lista d’attesa convertita',
});

export function activityActionLabel(action) {
  return ACTIVITY_ACTIONS[action] || action;
}

function bookingActivity(entry) {
  return {
    ...entry,
    source: 'booking',
    actor_id: entry.actor_id || entry.new_data?.actor_id || null,
    details: entry.action === 'booking_created'
      ? [entry.new_data?.booking_date, entry.new_data?.booking_time, `${entry.new_data?.party_size ?? '—'} persone`, `Tavoli: ${entry.new_data?.tables || 'non assegnati'}`]
      : historyChanges(entry),
  };
}

function waitlistActivity(entry) {
  const details = [];
  if (entry.action === 'created') {
    details.push(`${entry.new_data?.party_size ?? '—'} persone`, `${entry.new_data?.booking_date ?? ''} ${entry.new_data?.booking_time ?? ''}`.trim());
  } else if (entry.old_data?.status !== entry.new_data?.status) {
    details.push(`${entry.old_data?.status || '—'} → ${entry.new_data?.status || '—'}`);
  }
  if (entry.new_data?.booking_id) details.push(`Prenotazione #${entry.new_data.booking_id}`);
  if (entry.new_data?.conversion_table) details.push(`Tavolo: ${entry.new_data.conversion_table}`);
  return {
    ...entry,
    action: entry.action === 'status_changed' ? 'status_changed_waitlist' : entry.action,
    source: 'waitlist',
    booking_id: entry.new_data?.booking_id || null,
    details,
  };
}

function activityDateInRome(value) {
  const parts = Object.fromEntries(romeDateFormat.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function normalizeAdminActivity(bookings, waitlist) {
  return [
    ...bookings.map(bookingActivity),
    ...waitlist.map(waitlistActivity),
  ].sort((first, second) => Date.parse(second.created_at) - Date.parse(first.created_at) || Number(second.id) - Number(first.id));
}

export function filterAdminActivity(entries, filters) {
  const search = filters.search.trim().toLowerCase();
  return entries.filter(entry => {
    const date = activityDateInRome(entry.created_at);
    if (filters.from && date < filters.from) return false;
    if (filters.to && date > filters.to) return false;
    if (filters.action && entry.action !== filters.action) return false;
    if (search && ![entry.booking_id, entry.actor_id, entry.action, ...entry.details].some(value => String(value || '').toLowerCase().includes(search))) return false;
    return true;
  });
}

export async function loadAdminActivity(client) {
  const [bookingResult, waitlistResult] = await Promise.all([
    client.from('booking_history').select('id,booking_id,action,old_data,new_data,actor_id,created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(500),
    client.from('waitlist_history').select('id,waitlist_id,action,old_data,new_data,actor_id,created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(500),
  ]);
  if (bookingResult.error || waitlistResult.error) {
    const error = bookingResult.error || waitlistResult.error;
    if (['PGRST204', '42703'].includes(error.code)) throw new Error('Activity log non configurato: applicare supabase/admin-activity-log.sql.');
    throw new Error(`Activity log non disponibile: ${error.message}`);
  }
  return normalizeAdminActivity(bookingResult.data || [], waitlistResult.data || []);
}