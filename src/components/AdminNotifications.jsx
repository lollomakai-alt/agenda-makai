import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { loadAdminNotifications, markNotificationRead, notificationBookingUrl, NOTIFICATION_PRIORITIES, unreadNotificationCount, sortNotifications } from '../utils/adminNotifications';

export default function AdminNotifications() {
  const [open, setOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [state, setState] = useState({ entries: [], loading: true, error: '' });
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(null);
  const active = useRef(false);
  const generation = useRef(0);
  const mutation = useRef(false);
  const sessionRevision = useRef(0);
  const load = useCallback(async () => {
    if (mutation.current) return;
    const current = ++generation.current;
    try {
      const entries = await loadAdminNotifications(supabase);
      if (active.current && current === generation.current) setState({ entries, loading: false, error: '' });
    } catch (error) {
      if (active.current && current === generation.current) setState(previous => ({ ...previous, loading: false, error: error.message }));
    }
  }, []);
  useEffect(() => {
    active.current = true;
    void load();
    const timer = window.setInterval(load, 30000);
    function visible() { if (document.visibilityState === 'visible') void load(); }
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('admin-notifications-changed', load);
    const { data } = supabase.auth.onAuthStateChange(() => {
      generation.current++; sessionRevision.current++; setActionError('');
      setState({ entries: [], loading: true, error: '' });
      setTimeout(() => { if (active.current) void load(); }, 0);
    });
    return () => {
      active.current = false; generation.current++;
      window.clearInterval(timer); data.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('admin-notifications-changed', load);
    };
  }, [load]);
  async function read(id) {
    if (mutation.current) return;
    const session = sessionRevision.current;
    mutation.current = true; generation.current++; setSaving(id); setActionError('');
    try {
      const result = await markNotificationRead(supabase, id);
      if (active.current && session === sessionRevision.current) setState(previous => ({ ...previous, error: '', entries: sortNotifications(previous.entries.map(entry => entry.id === id ? { ...entry, read_at: result.read_at } : entry)) }));
    } catch (error) {
      if (active.current && session === sessionRevision.current) setActionError(error.message);
    } finally {
      mutation.current = false;
      if (active.current) { setSaving(null); void load(); }
    }
  }
  const unread = unreadNotificationCount(state.entries);
  const entries = onlyUnread ? state.entries.filter(entry => !entry.read_at) : state.entries;
  return <section className="admin-notifications" aria-label="Centro notifiche ADMIN">
    <button type="button" className="admin-button admin-button-secondary" aria-expanded={open} aria-controls="admin-notification-panel"
      onClick={() => { setOpen(value => !value); void load(); }}>
      <svg className="notification-bell" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      <span className="notification-button-label">Notifiche</span> <span className="notification-badge" aria-live="polite">{state.loading || state.error ? '—' : unread}</span>
      <span className="notification-count-label"> non lette</span>
    </button>
    {open && <div id="admin-notification-panel" className="notification-panel">
      <h2>Centro notifiche</h2>
      <button type="button" className="admin-button admin-button-secondary" disabled={saving !== null} onClick={load}>Aggiorna notifiche</button>
      <label className="notification-filter"><input type="checkbox" checked={onlyUnread} onChange={event => setOnlyUnread(event.target.checked)} /> Solo non lette</label>
      {state.loading && <p role="status">Caricamento notifiche…</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {!state.loading && !state.error && !entries.length && <p>{onlyUnread ? 'Nessuna notifica non letta.' : 'Nessuna notifica attiva.'}</p>}
      <ul>{entries.map(entry => {
        const href = notificationBookingUrl(entry);
        return <li key={entry.id} className={`notification-item ${entry.read_at ? 'is-read' : 'is-unread'}`}>
          <p><strong>{NOTIFICATION_PRIORITIES[entry.priority] || entry.priority}</strong> · {entry.read_at ? 'Letta' : 'Non letta'}</p>
          <p>{href ? <a href={href} onClick={() => setOpen(false)}>{entry.message} · Prenotazione #{entry.booking_id}</a> : entry.message}</p>
          <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</time>
          {!entry.read_at && <button type="button" className="admin-button admin-button-secondary" disabled={saving !== null} onClick={() => read(entry.id)}>
            {saving === entry.id ? 'Salvataggio…' : 'Segna come letta'}
          </button>}
        </li>;
      })}</ul>
    </div>}
  </section>;
}
