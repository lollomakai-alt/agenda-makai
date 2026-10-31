import { isDay, operationalDayInRome } from './calendar.js';

export const NOTIFICATION_PRIORITIES = Object.freeze({ high: 'Alta', normal: 'Normale' });

export function notificationBookingUrl(notification) {
  if (notification.kind === 'dopocena_request') {
    return isDay(notification.booking_date) ? `/prenotazioni/giorno?date=${notification.booking_date}` : null;
  }
  if (notification.kind === 'customer_request') {
    const requestId = /^request:([1-9]\d*)$/.exec(String(notification.id || ''))?.[1];
    return requestId ? `/richieste-clienti#request-${requestId}` : '/richieste-clienti';
  }
  if (!/^[1-9]\d*$/.test(String(notification.booking_id)) || !isDay(notification.booking_date)) return null;
  const map = notification.kind === 'online_unassigned' ? `&assign=${notification.booking_id}` : '';
  return `/prenotazioni/giorno?date=${notification.booking_date}${map}#booking-${notification.booking_id}`;
}

export function unreadNotificationCount(notifications) {
  return notifications.filter(notification => !notification.read_at).length;
}

export function isActionableNotification(notification) {
  if (['customer_request', 'delay', 'waiting_table', 'reconfirmation', 'communication_failed', 'online_unassigned'].includes(notification.kind)) return true;
  if (notification.kind === 'online_booking') return /conferma cliente da inviare o verificare/i.test(notification.message || '');
  return false;
}

const romeDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function notificationDayInRome(now = new Date()) {
  const parts = Object.fromEntries(romeDayFormat.formatToParts(new Date(now))
    .map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function currentDayNotifications(notifications, now = new Date()) {
  const today = notificationDayInRome(now);
  return notifications.filter(notification => {
    if (['delay','waiting_table','reconfirmation'].includes(notification.kind)) return notification.booking_date === operationalDayInRome(now);
    if (['customer_request', 'customer_information', 'communication_failed', 'dopocena_request'].includes(notification.kind)) return true;
    if (notification.kind === 'online_booking' && isDay(notification.booking_date)) return notification.booking_date >= today;
    if (!Number.isFinite(Date.parse(notification.created_at))) return true;
    return notificationDayInRome(notification.created_at) === today;
  });
}

export function sortNotifications(notifications) {
  return [...notifications].sort((a, b) =>
    Date.parse(b.created_at) - Date.parse(a.created_at)
    || String(a.id).localeCompare(String(b.id))
  );
}

function fail(error) {
  throw new Error(error.code === 'PGRST202' || error.code === '42P01'
    ? 'Centro notifiche non configurato: applicare supabase/admin-notifications.sql.'
    : error.message || 'Notifiche non disponibili.');
}

function withAbortSignal(query, signal) {
  if (signal && typeof query?.abortSignal === 'function') query.abortSignal(signal);
  return query;
}

export async function loadAdminNotifications(client, now = new Date(), signal) {
  const request = withAbortSignal(client.rpc('admin_list_notifications'), signal);
  const { data, error } = await request;
  if (error) fail(error);
  if (!Array.isArray(data)) throw new Error('Lettura notifiche non confermata.');
  return sortNotifications(currentDayNotifications(data, now).filter(isActionableNotification));
}

export async function loadRecentOnlineBookings(client, now = new Date(), signal) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 48 * 60 * 60 * 1000);
  const request = withAbortSignal(client.from('bookings')
    .select('id,booking_date,booking_time,name,party_size,booking_type,status,created_at')
    .eq('source', 'booking')
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString())
    .order('created_at', { ascending: false })
    .order('id', { ascending: false }), signal);
  const { data, error } = await request;
  if (error) throw new Error('Registro delle nuove prenotazioni non disponibile.');
  if (!Array.isArray(data)) throw new Error('Lettura del registro non confermata.');
  return data;
}

export async function markNotificationRead(client, id) {
  const { data, error } = await client.rpc('admin_mark_notification_read', { notification_id: id });
  if (error) fail(error);
  if (data?.id !== id || !data?.read_at || !Number.isFinite(Date.parse(data.read_at))) throw new Error('Lettura non confermata. Aggiorna prima di riprovare.');
  return data;
}

export async function archiveNotification(client, id) {
 const {data,error}=await client.rpc('admin_archive_notification',{notification_id:id});
 if(error) fail(error);
 if(data?.id!==id || !data?.archived_at) throw new Error('Archiviazione non confermata. Aggiorna prima di riprovare.');
 return data;
}
