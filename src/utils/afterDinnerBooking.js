import { validateManualBooking } from './bookingValidation.js';
import { TABLE_ASSIGNMENTS } from '../config/tableAssignments.js';

export function validateAfterDinnerBooking(values) {
  const validation = validateManualBooking(values, { requirePhone: false });
  const errors = { ...validation.errors };
  const time = String(values.time || '');
  if (!/^(23:(00|30)|00:00)$/.test(time)) {
    errors.time = 'Il dopocena è disponibile dalle 23:00 alle 00:00.';
  }
  if (Number(validation.data.party_size) > 25) {
    errors.party_size = 'Il dopocena ammette al massimo 25 persone per prenotazione.';
  }
  const table = String(values.table || '').trim();
  if (table && !Object.hasOwn(TABLE_ASSIGNMENTS, table)) {
    errors.table = 'Scegli un’assegnazione tavoli configurata.';
  } else if (table && Number(validation.data.party_size) > TABLE_ASSIGNMENTS[table]) {
    errors.table = `L’assegnazione ${table} non ha posti sufficienti.`;
  }
  return { errors, data: { ...validation.data, table, booking_type: 'dopocena' } };
}

export async function createAfterDinnerBooking(client, values) {
  const validation = validateAfterDinnerBooking(values);
  if (Object.keys(validation.errors).length) return validation;
  const { name, phone, email, date, time, party_size, notes, table } = validation.data;
  const { data, error } = await client.rpc('admin_create_after_dinner_booking', {
    p_customer_name: name, p_customer_phone: phone, p_customer_email: email,
    p_booking_date: date, p_booking_time: time, p_party_size: party_size,
    p_notes: notes, p_table_id: table,
  });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42703') {
      throw new Error('Prenotazioni dopocena non ancora configurate: applicare supabase/after-dinner-bookings.sql.');
    }
    throw new Error(error.message || 'Prenotazione dopocena non salvata.');
  }
  if (!data?.id || data.booking_type !== 'dopocena') throw new Error('Salvataggio dopocena non confermato.');
  return { errors: {}, data };
}
