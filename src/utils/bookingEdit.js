import { isDay, todayInRome } from './calendar.js';
import { bookingType } from './bookingType.js';
import { conflictingTableIds, tableAssignmentError, tableConfigurationError } from './tableConflicts.js';

export const EDITABLE_BOOKING_FIELDS = ['booking_date', 'booking_time', 'party_size', 'tables', 'notes'];

export function editableBookingValues(booking) {
  return {
    booking_date: booking.booking_date,
    booking_time: booking.booking_time?.slice(0, 5) || '',
    party_size: String(booking.party_size),
    tables: booking.tables || '',
    notes: booking.notes || '',
  };
}

export function validateBookingEdit(values, original, { manualTables = false } = {}) {
  const errors = {};
  const partySize = Number(values.party_size);
  const tables = String(values.tables || '').trim();
  const notes = String(values.notes || '');
  const normalized = {
    booking_date: values.booking_date, booking_time: values.booking_time,
    party_size: partySize, tables: tables.replace(/\s*,\s*/g, ','), notes,
  };
  const previous = editableBookingValues(original);
  previous.tables = previous.tables.trim().replace(/\s*,\s*/g, ',');
  const changesAvailability = ['booking_date', 'booking_time', 'party_size', 'tables'].some(key =>
    key === 'party_size' ? normalized[key] !== Number(previous[key]) : normalized[key] !== previous[key]
  );

  if (changesAvailability && !isDay(values.booking_date)) errors.booking_date = 'Inserisci una data valida.';
  else if (changesAvailability) {
    const today = todayInRome();
    const lastDay = new Date(`${today}T12:00:00Z`);
    lastDay.setUTCDate(lastDay.getUTCDate() + 60);
    if (values.booking_date < today || values.booking_date > lastDay.toISOString().slice(0, 10)) {
      errors.booking_date = 'Scegli una data entro i prossimi 60 giorni.';
    } else if (new Date(`${values.booking_date}T12:00:00Z`).getUTCDay() === 1) {
      errors.booking_date = 'Il lunedì il locale è chiuso.';
    }
  }
  const timePattern = bookingType(original.booking_type) === 'dopocena'
    ? /^(22|23):(00|30)$/ : /^(18|19|20|21|22):(00|30)$|^23:00$/;
  if (changesAvailability && !timePattern.test(values.booking_time || '')) {
    errors.booking_time = bookingType(original.booking_type) === 'dopocena'
      ? 'Il dopocena è disponibile dalle 22:00 alle 23:30, ogni 30 minuti.'
      : 'Scegli un orario tra le 18:00 e le 23:00, ogni 30 minuti.';
  }
  if (changesAvailability && (!Number.isSafeInteger(partySize) || partySize < 1 || partySize > 6)) errors.party_size = 'Inserisci un numero intero da 1 a 6.';
  if (changesAvailability && tables && !/^[1-9]\d*(?:\+[1-9]\d*)*(?:\s*,\s*[1-9]\d*(?:\+[1-9]\d*)*)*$/.test(tables)) {
    errors.tables = 'Usa le assegnazioni tavoli separate da virgole, oppure lascia vuoto.';
  }
  if (tables.length > 200) errors.tables = 'La lista dei tavoli è troppo lunga.';
  if (notes.length > 300) errors.notes = 'Le note possono contenere al massimo 300 caratteri.';
  const changes = Object.fromEntries(EDITABLE_BOOKING_FIELDS.filter(key =>
    key === 'party_size' ? normalized[key] !== Number(previous[key]) : normalized[key] !== previous[key]
  ).map(key => [key, normalized[key]]));
  if (!errors.tables && changesAvailability) errors.tables = tableAssignmentError(tables, partySize, { allowOverCapacity: manualTables && Object.keys(changes).every(key => key === 'tables') });
  if (!errors.tables) delete errors.tables;
  if (!Object.keys(errors).length && !Object.keys(changes).length) errors.form = 'Non hai modificato nessun campo.';
  return { errors, changes };
}

export async function saveBookingEdit(client, original, values, appointments = [], { manualTables = false } = {}) {
  const { errors, changes } = validateBookingEdit(values, original, { manualTables });
  if (Object.keys(errors).length) throw new Error(errors.form || 'Controlla i campi della prenotazione.');
  if (['booking_date', 'booking_time', 'party_size', 'tables'].some(key => Object.hasOwn(changes, key))) {
    const candidate = { ...original, ...changes };
    const conflicts = conflictingTableIds(candidate, appointments);
    if (conflicts.length) throw new Error(`Tavoli già assegnati nella stessa data: ${conflicts.join(', ')}. Modifica non salvata.`);
    const configurationError = tableConfigurationError(candidate, appointments);
    if (configurationError) throw new Error(`${configurationError} Modifica non salvata.`);
  }
  const expected = Object.fromEntries(EDITABLE_BOOKING_FIELDS.map(key => [key, original[key] ?? null]));
  const { data, error } = await client.rpc(manualTables && Object.keys(changes).every(key => key === 'tables') ? 'admin_assign_booking_tables' : 'admin_update_booking', {
    booking_id: original.id, changes, expected,
  });
  if (error) {
    if (error.code === 'PGRST202') throw new Error('Modifica prenotazione non ancora configurata: applicare supabase/booking-edit.sql e supabase/manual-table-assignment.sql.');
    throw new Error(error.message || 'Modifica non salvata.');
  }
  if (!data?.booking || String(data.booking.id) !== String(original.id)) {
    throw new Error('Salvataggio non confermato. Aggiorna la pagina e verifica prima di riprovare.');
  }
  return data;
}
