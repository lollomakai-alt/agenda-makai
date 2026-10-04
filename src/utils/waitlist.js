import { validateBooking } from './bookingValidation.js';
import { TABLE_ASSIGNMENTS } from '../config/tableAssignments.js';
import { conflictingTableIds, tableConfigurationError } from './tableConflicts.js';

export const WAITLIST_STATUSES = Object.freeze({ WAITING: 'In attesa', CONTACTED: 'Contattato', CONVERTED: 'Convertito', CANCELLED: 'Cancellato' });
export function validateWaitlist(values) {
  const input = Object.fromEntries(['name','phone','email','date','time','party_size','notes'].map(key => [key, String(values[key] ?? '')]));
  const { errors, data } = validateBooking(input);
  if (!input.phone.trim() && input.email.trim() && !errors.email) delete errors.phone;
  if (!input.phone.trim() && !input.email.trim()) errors.phone = 'Inserisci almeno telefono o email.';
  return { errors, data: { ...data, phone: input.phone.trim() ? data.phone : '' } };
}
export function availableWaitlistTables(entry, appointments) {
  if (!['WAITING','CONTACTED'].includes(entry.status)) return [];
  // Assegnazioni e controlli ADMIN esistenti; il database ricontrolla al salvataggio.
  return Object.entries(TABLE_ASSIGNMENTS).filter(([tables, capacity]) => {
    const candidate = { id: null, booking_date: entry.booking_date, booking_time: entry.booking_time, party_size: entry.party_size, booking_type: 'normale', status: 'confirmed', tables };
    return capacity >= entry.party_size && !conflictingTableIds(candidate, appointments).length && !tableConfigurationError(candidate, appointments);
  }).sort((a,b) => a[1]-b[1] || a[0].localeCompare(b[0]));
}
function failure(error) {
  throw new Error(['PGRST202','42P01'].includes(error.code) ? 'Lista d’attesa non configurata: applicare supabase/waitlist.sql.' : error.message || 'Operazione non confermata.');
}
export async function loadWaitlist(client) {
  const { data, error } = await client.from('waitlist').select('*').order('booking_date').order('booking_time').order('created_at').order('id');
  if (error) failure(error);
  return data || [];
}
export async function loadWaitlistHistory(client, id) {
  const { data, error } = await client.from('waitlist_history').select('id,action,old_data,new_data,created_at').eq('waitlist_id', id).order('created_at', { ascending: false }).order('id', { ascending: false });
  if (error) failure(error);
  return data || [];
}
export async function createWaitlistEntry(client, values) {
  const { errors, data: valuesToSave } = validateWaitlist(values);
  if (Object.keys(errors).length) return { errors };
  const { name, phone, email, date, time, party_size, notes } = valuesToSave;
  const { data, error } = await client.rpc('admin_create_waitlist_entry', { p_name:name, p_phone:phone, p_email:email, p_date:date, p_time:time, p_party_size:party_size, p_notes:notes });
  if (error) failure(error);
  if (!data?.id || data.status !== 'WAITING') throw new Error('Inserimento non confermato. Aggiorna prima di riprovare.');
  return { errors: {}, data };
}
export async function setWaitlistStatus(client, entry, status) {
  if (!['WAITING','CONTACTED'].includes(entry.status) || !['CONTACTED','CANCELLED'].includes(status) || status === entry.status) throw new Error('Cambio stato non valido.');
  const { data, error } = await client.rpc('admin_set_waitlist_status', { p_entry_id:entry.id, p_status:status, p_expected_status:entry.status });
  if (error) failure(error);
  if (String(data?.id) !== String(entry.id) || data.status !== status) throw new Error('Cambio stato non confermato. Aggiorna prima di riprovare.');
  return data;
}
export async function convertWaitlistEntry(client, entry, table, appointments) {
  if (!availableWaitlistTables(entry, appointments).some(([id]) => id === table)) throw new Error('Scegli un tavolo disponibile con capienza sufficiente.');
  const { data, error } = await client.rpc('admin_convert_waitlist_entry', { p_entry_id:entry.id, p_table_id:table });
  if (error) failure(error);
  if (String(data?.id) !== String(entry.id) || data.status !== 'CONVERTED' || !data.booking_id) throw new Error('Conversione non confermata. Aggiorna prima di riprovare.');
  return data;
}
