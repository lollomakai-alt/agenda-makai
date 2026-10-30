import { historyChanges } from './bookingHistory.js';

const romeDateFormat = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Rome',
});

export const ACTIVITY_LIMIT = 500;

export const ACTIVITY_ACTIONS = Object.freeze({
  booking_created: 'Prenotazione creata',
  booking_updated: 'Prenotazione modificata',
  status_changed: 'Stato prenotazione modificato',
  table_assigned: 'Tavolo assegnato',
  customer_reconfirmed: 'Prenotazione riconfermata dal cliente',
  customer_cancelled: 'Prenotazione cancellata dal cliente',
  customer_request_created: 'Richiesta cliente ricevuta',
  customer_request_approved: 'Richiesta cliente accettata',
  customer_request_rejected: 'Richiesta cliente rifiutata',
  customer_request_alternative: 'Alternativa proposta',
  customer_alternative_proposed: 'Alternativa proposta al cliente',
  created: 'Voce lista d’attesa creata',
  status_changed_waitlist: 'Stato lista d’attesa modificato',
  converted: 'Voce lista d’attesa convertita',
  waitlist_converted: 'Voce lista d’attesa convertita',
});

export const ACTIVITY_TYPES = Object.freeze({
  prenotazioni: 'Prenotazioni',
  richieste: 'Richieste clienti',
  lista_attesa: 'Lista d’attesa',
  altri: 'Altri eventi',
});

const BOOKING_OUTCOMES = Object.freeze({
  confirmed: 'Confermata',
  arrived: 'Arrivata',
  completed: 'Conclusa',
  cancelled: 'Annullata',
  no_show: 'Non venuta',
  pending: 'In attesa',
});

const WAITLIST_OUTCOMES = Object.freeze({
  WAITING: 'In attesa',
  CONTACTED: 'Contattata',
  CONVERTED: 'Convertita',
  CANCELLED: 'Annullata',
});

const OUTCOME_TONES = Object.freeze({
  Confermata: 'ok', Arrivata: 'ok', Conclusa: 'ok', Convertita: 'ok',
  Accettata: 'ok', Riconfermata: 'ok', Assegnato: 'ok', Proposta: 'wait',
  'In attesa': 'wait', Modificata: 'wait', Aggiornata: 'wait', Contattata: 'wait',
  Rifiutata: 'no', Annullata: 'no', 'Non venuta': 'no',
});

export function activityActionLabel(action) {
  return ACTIVITY_ACTIONS[action] || 'Evento amministrativo';
}

export function activityEventType(entry) {
  if (String(entry.action || '').startsWith('customer_request_')
    || entry.action === 'customer_alternative_proposed') return 'richieste';
  if (['created', 'status_changed_waitlist', 'converted', 'waitlist_converted'].includes(entry.action)) return 'lista_attesa';
  if (['booking_created', 'booking_updated', 'status_changed', 'table_assigned',
    'customer_reconfirmed', 'customer_cancelled'].includes(entry.action)) return 'prenotazioni';
  return 'altri';
}

export function activityOutcome(entry) {
  const data = entry.new_data || {};
  switch (entry.action) {
    case 'customer_request_created': return 'In attesa';
    case 'customer_request_approved': return 'Accettata';
    case 'customer_request_rejected': return 'Rifiutata';
    case 'customer_request_alternative':
    case 'customer_alternative_proposed': return 'Proposta';
    case 'status_changed': return BOOKING_OUTCOMES[data.status] || 'Aggiornata';
    case 'status_changed_waitlist':
    case 'created': return WAITLIST_OUTCOMES[data.status] || 'In attesa';
    case 'converted':
    case 'waitlist_converted': return 'Convertita';
    case 'booking_created': return 'Confermata';
    case 'booking_updated': return 'Modificata';
    case 'customer_reconfirmed': return 'Riconfermata';
    case 'customer_cancelled': return 'Annullata';
    case 'table_assigned': return 'Assegnato';
    default: return '—';
  }
}

export function activityOutcomeTone(entry) {
  return OUTCOME_TONES[activityOutcome(entry)] || 'neutral';
}

export function activityDisplayName(entry) {
  return entry.booking_name || entry.waitlist_name || '';
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
  const search = String(filters.search || '').trim().toLowerCase();
  return entries.filter(entry => {
    const date = activityDateInRome(entry.created_at);
    if (filters.from && date < filters.from) return false;
    if (filters.to && date > filters.to) return false;
    if (filters.action && entry.action !== filters.action) return false;
    if (filters.type && activityEventType(entry) !== filters.type) return false;
    if (search && ![
      entry.booking_id ? `#${entry.booking_id}` : '',
      entry.booking_id,
      entry.waitlist_id ? `#${entry.waitlist_id}` : '',
      entry.waitlist_id,
      entry.booking_name,
      entry.waitlist_name,
      entry.actor_id,
      entry.action,
      entry.new_data?.rejection_reason,
      ...(entry.details || []),
    ].some(value => String(value || '').toLowerCase().includes(search))) return false;
    return true;
  });
}

export async function loadAdminActivity(client) {
  const [bookingResult, waitlistResult] = await Promise.all([
    client.from('booking_history').select('id,booking_id,action,old_data,new_data,actor_id,created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(ACTIVITY_LIMIT),
    client.from('waitlist_history').select('id,waitlist_id,action,old_data,new_data,actor_id,created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(ACTIVITY_LIMIT),
  ]);
  if (bookingResult.error || waitlistResult.error) {
    const error = bookingResult.error || waitlistResult.error;
    if (['PGRST204', '42703'].includes(error.code)) throw new Error('Activity log non configurato: applicare supabase/admin-activity-log.sql.');
    throw new Error(`Activity log non disponibile: ${error.message}`);
  }
  return normalizeAdminActivity(bookingResult.data || [], waitlistResult.data || []);
}

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function uniqueIds(entries, field) {
  return [...new Set(entries.map(entry => entry[field]).filter(value => value !== null && value !== undefined && value !== '').map(String))];
}

async function loadNames(client, table, ids) {
  const names = new Map();
  for (const idsChunk of chunks(ids)) {
    const { data, error } = await client.from(table).select('id,name').in('id', idsChunk);
    if (error) throw new Error(`Nomi non disponibili: ${error.message}`);
    for (const row of data || []) if (row?.id !== undefined) names.set(String(row.id), row.name || '');
  }
  return names;
}

// Names are only used to make the archive readable and searchable. A failure
// here must never hide the events themselves.
export async function loadAdminActivityNames(client, entries) {
  const bookingIds = uniqueIds(entries, 'booking_id');
  const waitlistIds = uniqueIds(entries, 'waitlist_id');
  const [bookings, waitlists] = await Promise.all([
    bookingIds.length ? loadNames(client, 'bookings', bookingIds) : new Map(),
    waitlistIds.length ? loadNames(client, 'waitlist', waitlistIds) : new Map(),
  ]);
  return { bookings, waitlists };
}

export function attachAdminActivityNames(entries, names) {
  return entries.map(entry => ({
    ...entry,
    booking_name: entry.booking_id ? names?.bookings?.get(String(entry.booking_id)) || '' : '',
    waitlist_name: entry.waitlist_id ? names?.waitlists?.get(String(entry.waitlist_id)) || '' : '',
  }));
}

export async function loadAdminActivityContact(client, entry) {
  if (entry.booking_id) {
    const { data, error } = await client.from('bookings')
      .select('id,name,phone,email,booking_date,booking_time,party_size,tables,status')
      .eq('id', entry.booking_id).maybeSingle();
    if (!error && data) return { ...data, kind: 'booking' };
  }
  if (entry.waitlist_id) {
    const { data, error } = await client.from('waitlist')
      .select('id,name,phone,email,booking_date,booking_time,party_size,status')
      .eq('id', entry.waitlist_id).maybeSingle();
    if (!error && data) return { ...data, kind: 'waitlist' };
  }
  return null;
}
