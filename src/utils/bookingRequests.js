export const REQUEST_TYPES = Object.freeze({ data: 'Data', ora: 'Ora', persone: 'Persone', cancellazione: 'Cancellazione', note: 'Note' });
export const REQUEST_FIELDS = Object.freeze({ data: 'booking_date', ora: 'booking_time', persone: 'party_size', note: 'notes' });

export function requestValue(type, value) {
  if (!Object.hasOwn(REQUEST_TYPES, type)) throw new Error('Tipo richiesta non valido.');
  if (type === 'cancellazione') return null;
  if (type === 'persone') {
    if (!/^[1-6]$/.test(String(value))) throw new Error('Inserisci un numero intero da 1 a 6.');
    return Number(value);
  }
  if (typeof value !== 'string') throw new Error('Valore richiesta non valido.');
  if (type === 'data') {
    const date = new Date(`${value}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Data non valida.');
  }
  if (type === 'ora' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Ora non valida.');
  if (type === 'note' && value.length > 300) throw new Error('Note: massimo 300 caratteri.');
  return value;
}

function failure(error) {
  throw new Error(error.code === 'PGRST202' || error.code === '42P01'
    ? 'Richieste non configurate: applicare supabase/booking-requests.sql.'
    : error.message || 'Operazione non confermata.');
}

export async function loadBookingRequests(client) {
  const { data, error } = await client.from('booking_requests').select('id,booking_id,request_type,requested_value,status,created_at,reviewed_at').order('created_at', { ascending: false }).order('id', { ascending: false });
  if (error) failure(error);
  return data || [];
}

export async function createBookingRequest(client, bookingId, type, value) {
  const { data, error } = await client.rpc('admin_create_booking_request', {
    booking_id: bookingId, request_type: type, requested_value: requestValue(type, value),
  });
  if (error) failure(error);
  if (!data?.id || String(data.booking_id) !== String(bookingId) || data.status !== 'pending') throw new Error('Richiesta non confermata. Aggiorna prima di riprovare.');
  return data;
}

export async function reviewBookingRequest(client, request, decision) {
  if (!['approved', 'rejected'].includes(decision) || request.status !== 'pending') throw new Error('Decisione non valida o richiesta già gestita.');
  const { data, error } = await client.rpc('admin_review_booking_request', { request_id: request.id, decision });
  if (error) failure(error);
  if (String(data?.id) !== String(request.id) || data?.status !== decision) throw new Error('Decisione non confermata. Aggiorna prima di riprovare.');
  return data;
}
