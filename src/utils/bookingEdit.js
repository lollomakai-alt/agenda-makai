import { isDay, todayInRome, operationalDayInRome } from './calendar.js';
import { bookingType } from './bookingType.js';
import { conflictingTableIds, tableAssignmentError, tableConfigurationError } from './tableConflicts.js';
import { isValidBookingTimeForType } from './bookingTime.js';

export const EDITABLE_BOOKING_FIELDS = ['booking_date', 'booking_time', 'party_size', 'tables', 'notes'];

export function editableBookingValues(booking) {
  return {
    booking_type: bookingType(booking.booking_type),
    booking_date: booking.booking_date,
    booking_time: booking.booking_time?.slice(0, 5) || '',
    party_size: String(booking.party_size),
    tables: booking.tables || '',
    notes: booking.notes || '',
  };
}

export function validateBookingEdit(values, original, { manualTables = false, now = Date.now() } = {}) {
  const errors = {};
  const partySize = Number(values.party_size);
  const tables = String(values.tables || '').trim();
  const notes = String(values.notes || '');
  const normalized = {
    booking_type: values.booking_type || bookingType(original.booking_type),
    booking_date: values.booking_date, booking_time: values.booking_time,
    party_size: partySize, tables: tables.replace(/\s*,\s*/g, ','), notes,
  };
  const previous = editableBookingValues(original);
  previous.tables = previous.tables.trim().replace(/\s*,\s*/g, ',');
  const changesAvailability = ['booking_date', 'booking_time', 'party_size', 'tables'].some(key =>
    key === 'party_size' ? normalized[key] !== Number(previous[key]) : normalized[key] !== previous[key]
  );
  const changesType = normalized.booking_type !== bookingType(original.booking_type);
  if (!['normale', 'dopocena'].includes(normalized.booking_type)) errors.booking_type = 'Scegli CENA o DOPOCENA.';
  if (changesType) {
    if (original.status !== 'confirmed') errors.booking_type = 'Il cambio turno è disponibile solo per prenotazioni confermate.';
    if (!isDay(values.booking_date)) errors.booking_date = 'Inserisci una data valida.';
    if (!isValidBookingTimeForType(normalized)) errors.booking_time = normalized.booking_type === 'dopocena'
      ? 'Il DOPOCENA è disponibile dalle 22:30 alle 00:00, ogni 30 minuti.'
      : 'La CENA è disponibile dalle 19:00 alle 22:30, ogni 30 minuti.';
    if (normalized.booking_type === 'normale' && (!Number.isSafeInteger(partySize) || partySize < 1)) {
      errors.party_size = 'Inserisci un numero intero positivo.';
    }
    if (normalized.booking_type === 'dopocena' && (!Number.isSafeInteger(partySize) || partySize < 1 || partySize > 26)) {
      errors.party_size = 'Per il cambio a DOPOCENA scegli da 1 a 26 persone.';
    }
    if (normalized.booking_type === 'normale' && !tables) errors.tables = 'Seleziona un tavolo CENA.';
    if (normalized.booking_type === 'dopocena' && tables) errors.tables = 'Il DOPOCENA inizia senza tavolo.';
  }

  if (!manualTables && changesAvailability && !isDay(values.booking_date)) errors.booking_date = 'Inserisci una data valida.';
  else if (!manualTables && changesAvailability) {
    const today = todayInRome(now);
    const lastDay = new Date(`${today}T12:00:00Z`);
    lastDay.setUTCDate(lastDay.getUTCDate() + 60);
    if (values.booking_date < operationalDayInRome(now) || values.booking_date > lastDay.toISOString().slice(0, 10)) {
      errors.booking_date = 'Scegli una data entro i prossimi 60 giorni.';
    } else if (new Date(`${values.booking_date}T12:00:00Z`).getUTCDay() === 1) {
      errors.booking_date = 'Il lunedì il locale è chiuso.';
    }
  }
  const timePattern = normalized.booking_type === 'dopocena'
    ? /^(22:30|23:(00|30)|00:00)$/ : /^(19|20|21):(00|30)$|^22:(00|30)$/;
  if (!manualTables && changesAvailability && !changesType && !timePattern.test(values.booking_time || '')) {
    errors.booking_time = normalized.booking_type === 'dopocena'
      ? 'Il dopocena è disponibile dalle 22:30 alle 00:00, ogni 30 minuti.'
      : 'Scegli un orario tra le 19:00 e le 22:30, ogni 30 minuti.';
  }
  if (!changesType && changesAvailability && (!Number.isSafeInteger(partySize) || partySize < 1 || (!manualTables && partySize > 6))) errors.party_size = manualTables ? 'Inserisci un numero intero positivo.' : 'Inserisci un numero intero da 1 a 6.';
  if (changesAvailability && tables && !/^[1-9]\d*(?:\+[1-9]\d*)*(?:\s*,\s*[1-9]\d*(?:\+[1-9]\d*)*)*$/.test(tables)) {
    errors.tables = 'Usa le assegnazioni tavoli separate da virgole, oppure lascia vuoto.';
  }
  if (tables.length > 200) errors.tables = 'La lista dei tavoli è troppo lunga.';
  if (notes.length > 300) errors.notes = 'Le note possono contenere al massimo 300 caratteri.';
  const changes = Object.fromEntries(EDITABLE_BOOKING_FIELDS.filter(key =>
    key === 'party_size' ? normalized[key] !== Number(previous[key]) : normalized[key] !== previous[key]
  ).map(key => [key, normalized[key]]));
  if (changesType) changes.booking_type = normalized.booking_type;
  if (!manualTables && !errors.tables && changesAvailability) errors.tables = tableAssignmentError(tables, partySize);
  if (!errors.tables) delete errors.tables;
  if (!Object.keys(errors).length && !Object.keys(changes).length) errors.form = 'Non hai modificato nessun campo.';
  return { errors, changes };
}

export async function saveBookingEdit(client, original, values, appointments = [], { manualTables = false } = {}) {
  const { errors, changes } = validateBookingEdit(values, original, { manualTables });
  if (Object.keys(errors).length) throw new Error(errors.form || 'Controlla i campi della prenotazione.');
  if (['booking_date', 'booking_time', 'party_size', 'tables'].some(key => Object.hasOwn(changes, key))) {
    if (!manualTables) {
      const candidate = { ...original, ...changes };
      const conflicts = conflictingTableIds(candidate, appointments);
      if (conflicts.length) throw new Error(`Tavoli già assegnati nello stessa giornata: ${conflicts.join(', ')}. Modifica non salvata.`);
      const configurationError = tableConfigurationError(candidate, appointments);
      if (configurationError) throw new Error(`${configurationError} Modifica non salvata.`);
    }
  }
  const changesType = Object.hasOwn(changes, 'booking_type');
  const expected = Object.fromEntries(EDITABLE_BOOKING_FIELDS.map(key => [key, original[key] ?? null]));
  if (changesType) {
    expected.booking_type = bookingType(original.booking_type);
  }
  const rpcName = changesType ? 'admin_change_booking_type'
    : manualTables && Object.keys(changes).every(key => key === 'tables') ? 'admin_assign_booking_tables' : 'admin_update_booking';
  const { data, error } = await client.rpc(rpcName, {
    booking_id: original.id, changes, expected,
  });
  if (error) {
    if (error.code === 'PGRST202') throw new Error(changesType
      ? 'Cambio turno non ancora disponibile sul database: la migrazione ADMIN deve essere applicata e verificata.'
      : 'Modifica prenotazione non ancora configurata: applicare supabase/booking-edit.sql e supabase/manual-table-assignment.sql.');
    throw new Error(error.message || 'Modifica non salvata.');
  }
  if (!data?.booking || String(data.booking.id) !== String(original.id)) {
    throw new Error('Salvataggio non confermato. Aggiorna la pagina e verifica prima di riprovare.');
  }
  if (changesType && (data.booking.booking_type !== changes.booking_type ||
    (changes.booking_type === 'dopocena' && String(data.booking.tables || '').trim()) ||
    (changes.booking_type === 'normale' && !String(data.booking.tables || '').trim()))) {
    throw new Error('Cambio turno non confermato. Aggiorna la pagina e verifica prima di riprovare.');
  }
  return data;
}
