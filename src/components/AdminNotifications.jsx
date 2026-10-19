import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { loadAdminNotifications, loadRecentOnlineBookings, notificationBookingUrl, NOTIFICATION_PRIORITIES } from '../utils/adminNotifications';

const bookingStatusLabels = {
  confirmed: 'Confermata',
  arrived: 'Arrivata',
  completed: 'Conclusa',
  cancelled: 'Annullata',
  no_show: 'Non arrivata',
};

function createdAtLabel(value) {
  return new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
}

export default function AdminNotifications() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({
    entries: [], recentOnline: [], loading: true, recentLoading: true, error: '', recentError: '',
  });
  const active = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    const [actionResult, recentResult] = await Promise.allSettled([
      loadAdminNotifications(supabase),
      loadRecentOnlineBookings(supabase),
    ]);
    if (!active.current || current !== generation.current) return;
    setState(previous => ({
      entries: actionResult.status === 'fulfilled' ? actionResult.value : previous.entries,
      recentOnline: recentResult.status === 'fulfilled' ? recentResult.value : previous.recentOnline,
      loading: false,
      recentLoading: false,
      error: actionResult.status === 'rejected' ? actionResult.reason.message : '',
      recentError: recentResult.status === 'rejected' ? recentResult.reason.message : '',
    }));
  }, []);
  useEffect(() => {
    active.current = true;
    void load();
    const timer = window.setInterval(load, 30000);
    const channel = supabase.channel('online-notifications-' + crypto.randomUUID())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_requests' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_communications' }, load)
      .subscribe(status => { if (status === 'SUBSCRIBED') void load(); });
    function visible() { if (document.visibilityState === 'visible') void load(); }
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('admin-notifications-changed', load);
    const { data } = supabase.auth.onAuthStateChange(() => {
      generation.current++;
      setState({ entries: [], recentOnline: [], loading: true, recentLoading: true, error: '', recentError: '' });
      setTimeout(() => { if (active.current) void load(); }, 0);
    });
    return () => {
      active.current = false; generation.current++;
      window.clearInterval(timer); data.subscription.unsubscribe(); void supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('admin-notifications-changed', load);
    };
  }, [load]);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener('admin-header-menu-open', close);
    return () => window.removeEventListener('admin-header-menu-open', close);
  }, []);
  const count = state.entries.length;
  const openBookingIds = new Set(state.entries.filter(entry => entry.booking_id).map(entry => String(entry.booking_id)));
  const recentOnline = state.recentOnline.filter(booking => !openBookingIds.has(String(booking.id)));
  return <section className="admin-notifications" aria-label="Avvisi da gestire e nuove prenotazioni">
    <button type="button" className="admin-button admin-button-secondary" aria-label={'Notifiche: ' + count + ' da gestire'} aria-expanded={open} aria-controls="admin-notification-panel"
      onClick={() => {
        const next = !open;
        if (next) window.dispatchEvent(new Event('admin-header-notifications-open'));
        setOpen(next);
        if (next) void load();
      }}>
      <svg className="notification-bell" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      <span className="notification-button-label">Notifiche</span>
      <span className="notification-badge" aria-live="polite">{state.loading || state.error ? '—' : count}</span>
      <span className="notification-count-label"> da gestire</span>
    </button>
    {open && <div id="admin-notification-panel" className="notification-panel">
      <section aria-labelledby="notification-actions-title">
        <h2 id="notification-actions-title">Da gestire</h2>
        <p className="notification-panel-help">Gli avvisi si aggiornano quando cambia lo stato della prenotazione.</p>
        {state.loading && <p role="status">Caricamento avvisi…</p>}
        {state.error && <p role="alert">{state.error}</p>}
        {!state.loading && !state.error && !count && <p>Nessun avviso da gestire.</p>}
        {!!state.entries.length && <ul>{state.entries.map(entry => {
          const href = notificationBookingUrl(entry);
          return <li key={entry.id} className="notification-item">
            <p><strong>{NOTIFICATION_PRIORITIES[entry.priority] || entry.priority}</strong></p>
            <p>{href ? <a href={href} onClick={() => setOpen(false)}>{entry.message}{entry.booking_id ? ' · Prenotazione #' + entry.booking_id : ''}</a> : entry.message}</p>
            <time dateTime={entry.created_at}>{createdAtLabel(entry.created_at)}</time>
          </li>;
        })}</ul>}
      </section>
      <section className="notification-history" aria-labelledby="notification-history-title">
        <h2 id="notification-history-title">Nuove prenotazioni online</h2>
        <p className="notification-panel-help">Registro degli ultimi due giorni, dalla più recente.</p>
        {state.recentLoading && <p role="status">Caricamento registro…</p>}
        {state.recentError && <p role="alert">{state.recentError}</p>}
        {!state.recentLoading && !state.recentError && !recentOnline.length && <p>Nessuna nuova prenotazione online nelle ultime 48 ore.</p>}
        {!!recentOnline.length && <ul>{recentOnline.map(booking => {
          const href = notificationBookingUrl({ kind: 'online_booking', booking_id: booking.id, booking_date: booking.booking_date });
          return <li key={booking.id} className="notification-item">
            <p>{href ? <a href={href} onClick={() => setOpen(false)}><strong>{booking.name}</strong> · Prenotazione #{booking.id}</a> : <strong>{booking.name} · Prenotazione #{booking.id}</strong>}</p>
            <p>{booking.booking_date} · {booking.booking_time} · {booking.party_size} persone{booking.booking_type === 'dopocena' ? ' · DOPOCENA' : ''} · {bookingStatusLabels[booking.status] || booking.status}</p>
            <time dateTime={booking.created_at}>Ricevuta il {createdAtLabel(booking.created_at)}</time>
          </li>;
        })}</ul>}
      </section>
    </div>}
  </section>;
}
