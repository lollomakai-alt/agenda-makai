import tables from '../config/tables.json' with { type: 'json' };
import { validateBooking } from './bookingValidation.js';

export function validateAfterDinnerBooking(values) {
  const validation = validateBooking(values);
  const errors = { ...validation.errors };
  if (/^(22|23):(00|30)$/.test(values.time || '')) {
    delete errors.time;
  } else {
    errors.time = 'Il dopocena è disponibile dalle 22:00 alle 23:30, ogni 30 minuti.';
  }
  const table = String(values.table || '').trim();
  if (!Object.hasOwn(tables, table)) errors.table = 'Scegli un tavolo configurato.';
  else if (Number(values.party_size) > tables[table]) errors.table = `Il tavolo ${table} ha ${tables[table]} posti.`;
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
