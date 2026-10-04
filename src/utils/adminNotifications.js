import { isDay } from './calendar.js';

export const NOTIFICATION_PRIORITIES = Object.freeze({ high: 'Alta', normal: 'Normale' });

export function notificationBookingUrl(notification) {
  if (!/^[1-9]\d*$/.test(String(notification.booking_id)) || !isDay(notification.booking_date)) return null;
  return `/prenotazioni/giorno?date=${notification.booking_date}#booking-${notification.booking_id}`;
}

export function unreadNotificationCount(notifications) {
  return notifications.filter(notification => !notification.read_at).length;
}

export function sortNotifications(notifications) {
  return [...notifications].sort((a, b) => Number(!b.read_at) - Number(!a.read_at)
    || Number(b.priority === 'high') - Number(a.priority === 'high')
    || String(b.created_at).localeCompare(String(a.created_at)) || String(a.id).localeCompare(String(b.id)));
}

function fail(error) {
  throw new Error(error.code === 'PGRST202' || error.code === '42P01'
    ? 'Centro notifiche non configurato: applicare supabase/admin-notifications.sql.'
    : error.message || 'Notifiche non disponibili.');
}

export async function loadAdminNotifications(client) {
  const { data, error } = await client.rpc('admin_list_notifications');
  if (error) fail(error);
  if (!Array.isArray(data)) throw new Error('Lettura notifiche non confermata.');
  return sortNotifications(data);
}

export async function markNotificationRead(client, id) {
  const { data, error } = await client.rpc('admin_mark_notification_read', { notification_id: id });
  if (error) fail(error);
  if (data?.id !== id || !data?.read_at || !Number.isFinite(Date.parse(data.read_at))) throw new Error('Lettura non confermata. Aggiorna prima di riprovare.');
  return data;
}
