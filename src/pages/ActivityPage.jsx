import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { activityActionLabel, ACTIVITY_ACTIONS, filterAdminActivity, loadAdminActivity } from '../utils/adminActivity.js';

const dateFormat = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' });

export default function ActivityPage() {
  const [entries, setEntries] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', action: '', search: '' });
  const [state, setState] = useState({ loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true, error: '' });
    loadAdminActivity(supabase).then(rows => {
      if (active) { setEntries(rows); setState({ loading: false, error: '' }); }
    }).catch(error => {
      if (active) setState({ loading: false, error: error.message });
    });
    return () => { active = false; };
  }, [revision]);
  const visible = useMemo(() => filterAdminActivity(entries, filters), [entries, filters]);

  return <main className="booking-admin activity-page">
    <a href="/prenotazioni">← Calendario</a>
    <div className="agenda-heading"><div><p className="agenda-eyebrow">Audit amministrativo</p><h1>Attività</h1></div>
      <button className="admin-button admin-button-secondary" type="button" disabled={state.loading}
        onClick={() => setRevision(value => value + 1)}>Aggiorna</button>
    </div>
    <section className="activity-filters" aria-label="Filtri attività">
      <label>Dal<input type="date" value={filters.from} onChange={event => setFilters(previous => ({ ...previous, from: event.target.value }))} /></label>
      <label>Al<input type="date" value={filters.to} onChange={event => setFilters(previous => ({ ...previous, to: event.target.value }))} /></label>
      <label>Azione<select value={filters.action} onChange={event => setFilters(previous => ({ ...previous, action: event.target.value }))}>
        <option value="">Tutte</option>{Object.entries(ACTIVITY_ACTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="activity-search">Booking, autore o dettaglio<input type="search" value={filters.search}
        onChange={event => setFilters(previous => ({ ...previous, search: event.target.value }))} placeholder="ID o testo" /></label>
    </section>
    {state.loading && <p role="status">Caricamento attività…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {!state.loading && !state.error && <>
      <p className="activity-count" aria-live="polite">{visible.length} eventi mostrati · massimo 500 per archivio</p>
      {!visible.length ? <p>Nessuna attività corrisponde ai filtri.</p> : <ol className="activity-list">
        {visible.map(entry => <li key={`${entry.source}-${entry.id}`}>
          <div className="activity-event-heading"><strong>{activityActionLabel(entry.action)}</strong>
            <time dateTime={entry.created_at}>{dateFormat.format(new Date(entry.created_at))}</time></div>
          <p>{entry.booking_id ? `Prenotazione #${entry.booking_id}`
            : entry.waitlist_id ? `Lista d’attesa #${entry.waitlist_id}` : 'Attività generale'}
            {' · '}Autore: {entry.actor_id || 'non disponibile'}</p>
          {entry.details.map((detail, detailIndex) => detail && <p key={detailIndex}>{detail}</p>)}
        </li>)}
      </ol>}
    </>}
  </main>;
}