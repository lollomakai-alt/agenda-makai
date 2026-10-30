import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ACTIVITY_LIMIT,
  ACTIVITY_TYPES,
  activityActionLabel,
  activityDisplayName,
  activityEventType,
  activityOutcome,
  activityOutcomeTone,
  attachAdminActivityNames,
  filterAdminActivity,
  loadAdminActivity,
  loadAdminActivityContact,
  loadAdminActivityNames,
} from '../utils/adminActivity.js';

const eventDateFormat = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome',
});
const bookingDateFormat = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Rome',
});

function bookingDateLabel(value) {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? bookingDateFormat.format(date) : String(value);
}

function entryKey(entry) {
  return `${entry.source}-${entry.id}`;
}

function reference(entry) {
  if (entry.booking_id) return `Prenotazione #${entry.booking_id}`;
  if (entry.waitlist_id) return `Lista d’attesa #${entry.waitlist_id}`;
  return 'Attività generale';
}

function ContactBlock({ entry, contact }) {
  if (!entry.booking_id && !entry.waitlist_id) return <p className="makai-detail-muted">Nessun contatto collegato.</p>;
  if (!contact || contact.loading) return <p className="makai-detail-muted" role="status">Caricamento contatti…</p>;
  if (contact.error) return <p className="makai-detail-muted" role="alert">{contact.error}</p>;
  if (!contact.data) return <p className="makai-detail-muted">Contatti non disponibili.</p>;
  const data = contact.data;
  return <div className="makai-contact-card">
    <p className="makai-contact-name">{data.name || activityDisplayName(entry) || 'Cliente'}</p>
    <p>{data.phone ? <a href={`tel:${data.phone}`}>{data.phone}</a> : 'Telefono non disponibile'}</p>
    <p>{data.email ? <a href={`mailto:${data.email}`}>{data.email}</a> : 'Email non disponibile'}</p>
    {data.booking_date && <p className="makai-detail-muted">
      {bookingDateLabel(data.booking_date)} · {String(data.booking_time || '').slice(0, 5)} · {data.party_size} persone
      {data.tables ? ` · Tavolo ${data.tables}` : ''}
    </p>}
  </div>;
}

export default function ArchivePage() {
  const [entries, setEntries] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', type: '', search: '' });
  const [state, setState] = useState({ loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  const [contacts, setContacts] = useState({});

  useEffect(() => {
    let active = true;
    setState({ loading: true, error: '' });
    (async () => {
      const rows = await loadAdminActivity(supabase);
      const latest = rows.slice(0, ACTIVITY_LIMIT);
      let named = latest;
      try {
        named = attachAdminActivityNames(latest, await loadAdminActivityNames(supabase, latest));
      } catch {
        // Names improve search and readability, but the archive stays usable
        // with the event data already loaded.
      }
      if (active) { setEntries(named); setState({ loading: false, error: '' }); }
    })().catch(error => {
      if (active) setState({ loading: false, error: error.message });
    });
    return () => { active = false; };
  }, [revision]);

  const visible = useMemo(() => filterAdminActivity(entries, filters), [entries, filters]);
  const activeFilters = Number(Boolean(filters.from)) + Number(Boolean(filters.to))
    + Number(Boolean(filters.type)) + Number(Boolean(filters.search.trim()));

  async function loadContact(entry) {
    const key = entryKey(entry);
    if (contacts[key]?.loading || contacts[key]?.data || contacts[key]?.error) return;
    setContacts(previous => ({ ...previous, [key]: { loading: true, data: null, error: '' } }));
    try {
      const data = await loadAdminActivityContact(supabase, entry);
      setContacts(previous => ({ ...previous, [key]: { loading: false, data, error: '' } }));
    } catch (error) {
      setContacts(previous => ({ ...previous, [key]: { loading: false, data: null, error: error.message } }));
    }
  }

  return <main className="booking-admin makai-page archive-page">
    <header className="makai-page-header">
      <div>
        <p className="agenda-eyebrow">Archivio · solo titolare</p>
        <h1>Eventi</h1>
      </div>
      <button className="admin-button admin-button-secondary" type="button" disabled={state.loading}
        onClick={() => { setContacts({}); setRevision(value => value + 1); }}>Aggiorna</button>
    </header>

    {state.loading && <p role="status">Caricamento archivio…</p>}
    {state.error && <p role="alert">{state.error}</p>}

    {!state.loading && !state.error && <>
      <div className="makai-toolbar">
        <p className="makai-count" aria-live="polite">{visible.length} eventi · ultimi {ACTIVITY_LIMIT}</p>
        <details className="makai-filter-panel">
          <summary>Filtri{activeFilters ? ` · ${activeFilters}` : ''}</summary>
          <div className="makai-filter-grid">
            <label className="makai-filter-search">Cerca
              <input type="search" value={filters.search} placeholder="Numero prenotazione o nome"
                onChange={event => setFilters(previous => ({ ...previous, search: event.target.value }))} />
            </label>
            <label>Tipo evento
              <select value={filters.type} onChange={event => setFilters(previous => ({ ...previous, type: event.target.value }))}>
                <option value="">Tutti</option>
                {Object.entries(ACTIVITY_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>Dal
              <input type="date" value={filters.from} onChange={event => setFilters(previous => ({ ...previous, from: event.target.value }))} />
            </label>
            <label>Al
              <input type="date" value={filters.to} onChange={event => setFilters(previous => ({ ...previous, to: event.target.value }))} />
            </label>
            <button className="admin-button admin-button-secondary makai-filter-reset" type="button"
              disabled={!activeFilters} onClick={() => setFilters({ from: '', to: '', type: '', search: '' })}>Azzera filtri</button>
          </div>
        </details>
      </div>

      {!visible.length ? <p className="makai-empty">Nessun evento corrisponde ai filtri.</p> : <ul className="makai-list archive-list">
        {visible.map(entry => {
          const key = entryKey(entry);
          const tone = activityOutcomeTone(entry);
          return <li key={key} className="makai-list-item">
            <details className="makai-record" onToggle={event => { if (event.currentTarget.open) void loadContact(entry); }}>
              <summary className="makai-record-summary">
                <time className="makai-record-date" dateTime={entry.created_at}>{eventDateFormat.format(new Date(entry.created_at))}</time>
                <span className="makai-record-title">{activityActionLabel(entry.action)}</span>
                <span className="makai-record-ref">{reference(entry)}{activityDisplayName(entry) ? ` · ${activityDisplayName(entry)}` : ''}</span>
                <span className={`makai-badge is-${tone}`}>{activityOutcome(entry)}</span>
              </summary>
              <div className="makai-record-detail">
                <div className="makai-detail-section">
                  <h3>Dettaglio</h3>
                  <p>{activityActionLabel(entry.action)} · <span>{ACTIVITY_TYPES[activityEventType(entry)] || 'Evento'}</span></p>
                  {(entry.details || []).filter(Boolean).map((detail, index) => <p key={index}>{detail}</p>)}
                  {entry.new_data?.rejection_reason && <p className="makai-reason"><strong>Motivazione del rifiuto:</strong> {entry.new_data.rejection_reason}</p>}
                </div>
                <div className="makai-detail-section">
                  <h3>Contatti</h3>
                  <ContactBlock entry={entry} contact={contacts[key]} />
                </div>
                <div className="makai-detail-section">
                  <h3>Identificativi</h3>
                  <dl className="makai-identifiers">
                    <div><dt>Evento</dt><dd>#{entry.id}</dd></div>
                    {entry.booking_id && <div><dt>Prenotazione</dt><dd>#{entry.booking_id}</dd></div>}
                    {entry.waitlist_id && <div><dt>Lista d’attesa</dt><dd>#{entry.waitlist_id}</dd></div>}
                    <div><dt>Autore</dt><dd>{entry.actor_id || 'non disponibile'}</dd></div>
                    <div><dt>Data evento</dt><dd><time dateTime={entry.created_at}>{eventDateFormat.format(new Date(entry.created_at))}</time></dd></div>
                  </dl>
                </div>
              </div>
            </details>
          </li>;
        })}
      </ul>}
    </>}
  </main>;
}
