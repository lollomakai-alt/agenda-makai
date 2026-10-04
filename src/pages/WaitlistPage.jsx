import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAppointments } from '../hooks/useAppointments';
import { todayInRome } from '../utils/calendar';
import { availableWaitlistTables, createWaitlistEntry, convertWaitlistEntry, loadWaitlist, loadWaitlistHistory, setWaitlistStatus, WAITLIST_STATUSES } from '../utils/waitlist';
import { notificationBookingUrl } from '../utils/adminNotifications';

function WaitlistHistory({ id, revision }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ entries: [], error: '', loading: false });
  useEffect(() => {
    if (!open) return;
    let active = true;
    setState({ entries: [], error: '', loading: true });
    loadWaitlistHistory(supabase, id).then(entries => { if (active) setState({ entries, error: '', loading: false }); })
      .catch(error => { if (active) setState({ entries: [], error: error.message, loading: false }); });
    return () => { active = false; };
  }, [id, revision, open]);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>Storico lista d’attesa</summary>
    {state.loading && <p role="status">Caricamento storico…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {open && !state.loading && !state.error && <ol>{state.entries.map(entry => <li key={entry.id}>
      {new Date(entry.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}{' · '}
      {entry.action === 'created' ? 'Inserimento' : entry.action === 'converted' ? 'Conversione' : 'Cambio stato'}{' · '}
      {entry.old_data?.status && `${WAITLIST_STATUSES[entry.old_data.status]} → `}{WAITLIST_STATUSES[entry.new_data?.status]}
      {entry.new_data?.booking_id && ` · Prenotazione #${entry.new_data.booking_id}`}
    </li>)}</ol>}
  </details>;
}
export default function WaitlistPage() {
  const { appointments, loading: appointmentsLoading, error: appointmentsError, refresh } = useAppointments('all');
  const [state, setState] = useState({ entries: [], loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [errors, setErrors] = useState({});
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [dateFilter, setDateFilter] = useState('');
  const [tables, setTables] = useState({});
  useEffect(() => {
    let active = true;
    let generation = 0;
    async function load() {
      const current = ++generation;
      try {
        const entries = await loadWaitlist(supabase);
        if (active && current === generation) setState({ entries, loading: false, error: '' });
      } catch (error) { if (active && current === generation) setState(previous => ({ ...previous, loading: false, error: error.message })); }
    }
    void load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; generation++; window.clearInterval(timer); };
  }, [revision]);
  function changed(message) { setFeedback(message); setRevision(value => value + 1); refresh(); window.dispatchEvent(new Event('admin-notifications-changed')); }
  async function create(event) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    setSaving(true); setActionError(''); setFeedback(''); setErrors({});
    try {
      const result = await createWaitlistEntry(supabase, Object.fromEntries(new FormData(form)));
      setErrors(result.errors);
      if (!Object.keys(result.errors).length) { form.reset(); changed('Cliente aggiunto alla lista d’attesa.'); }
    } catch (error) { setActionError(error.message); }
    finally { setSaving(false); }
  }
  async function act(entry, status) {
    if (saving) return;
    setSaving(true); setActionError(''); setFeedback('');
    try {
      if (status === 'CONVERTED') {
        await convertWaitlistEntry(supabase, entry, tables[entry.id], appointments);
        changed('Conversione completata. Prenotazione creata e storico conservato.');
      } else { await setWaitlistStatus(supabase, entry, status); changed('Stato aggiornato.'); }
    } catch (error) { setActionError(error.message); }
    finally { setSaving(false); }
  }
  const entries = state.entries.filter(entry => (!dateFilter || entry.booking_date === dateFilter)
    && (statusFilter === 'ALL' || statusFilter === 'ACTIVE' ? statusFilter === 'ALL' || ['WAITING','CONTACTED'].includes(entry.status) : entry.status === statusFilter));
  const fields = [['name','Cliente (nome e cognome)','text'],['phone','Telefono','tel'],['email','Email','email'],['date','Data','date'],['time','Ora','time'],['party_size','Persone','number']];
  return <main className="booking-admin waitlist-page">
    <a href="/prenotazioni">← Calendario</a><h1>Lista d’attesa</h1>
    <details><summary>Aggiungi cliente</summary><form className="booking-admin-form" noValidate onSubmit={create}>
      <fieldset disabled={saving}>{fields.map(([name,label,type]) => <label key={name}>{label}
        <input name={name} type={type} defaultValue={name === 'date' ? todayInRome() : name === 'party_size' ? '2' : ''}
          min={name === 'party_size' ? 1 : undefined} max={name === 'party_size' ? 6 : undefined} step={name === 'time' ? 1800 : undefined}
          maxLength={name === 'name' ? 60 : name === 'email' ? 120 : undefined} aria-invalid={Boolean(errors[name])} />
        {errors[name] && <small className="field-error">{errors[name]}</small>}
      </label>)}<label>Note<textarea name="notes" maxLength={300} aria-invalid={Boolean(errors.notes)} /></label>
        {errors.notes && <small className="field-error">{errors.notes}</small>}
        <p>Inserisci almeno telefono o email. Nessun messaggio viene inviato.</p>
        <button className="admin-button" type="submit">Aggiungi alla lista</button>
      </fieldset>
    </form></details>
    <div className="waitlist-filters">
      <label>Stato<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
        <option value="ACTIVE">In attesa e contattati</option><option value="ALL">Tutti</option>
        {Object.entries(WAITLIST_STATUSES).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Data<input type="date" value={dateFilter} onChange={event => setDateFilter(event.target.value)} /></label>
      <button className="admin-button admin-button-secondary" disabled={saving} onClick={() => { setRevision(value => value + 1); refresh(); }}>Aggiorna lista e disponibilità</button>
    </div>
    {state.loading && <p role="status">Caricamento lista d’attesa…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {actionError && <p role="alert">{actionError}</p>}{feedback && <p role="status">{feedback}</p>}
    {appointmentsError && <p role="alert">Disponibilità non verificabile: {appointmentsError.message}</p>}
    {!state.loading && !state.error && !entries.length && <p>Nessuna voce per i filtri selezionati.</p>}
    <div className="waitlist-entries">{entries.map(entry => {
      const available = availableWaitlistTables(entry, appointments);
      const active = ['WAITING','CONTACTED'].includes(entry.status);
      const href = entry.booking_id && notificationBookingUrl(entry);
      return <article className="waitlist-entry" key={entry.id}>
        <h2>{entry.name}</h2><p>{entry.phone || entry.email}{entry.phone && entry.email && ` · ${entry.email}`}</p>
        <p>{entry.booking_date} · {entry.booking_time} · {entry.party_size} persone · {WAITLIST_STATUSES[entry.status]}</p>
        {entry.notes && <p>{entry.notes}</p>}
        {active && <div className="waitlist-actions">
          {entry.status === 'WAITING' && <button className="admin-button admin-button-secondary" disabled={saving} onClick={() => act(entry,'CONTACTED')}>Segna contattato</button>}
          <button className="admin-button admin-button-secondary" disabled={saving} onClick={() => act(entry,'CANCELLED')}>Cancella voce</button>
          <label>Tavolo disponibile<select disabled={saving || appointmentsLoading || Boolean(appointmentsError)} value={tables[entry.id] || ''} onChange={event => setTables(previous => ({ ...previous, [entry.id]:event.target.value }))}>
            <option value="">Seleziona tavolo</option>{available.map(([id,capacity]) => <option key={id} value={id}>{id} · {capacity} posti</option>)}
          </select></label>
          <button className="admin-button" disabled={saving || appointmentsLoading || Boolean(appointmentsError) || !available.some(([id]) => id === tables[entry.id])} onClick={() => act(entry,'CONVERTED')}>Converti in prenotazione</button>
          {!appointmentsLoading && !appointmentsError && !available.length && <p>Nessun tavolo disponibile: la voce resta in attesa.</p>}
        </div>}
        {href && <a href={href}>Apri prenotazione #{entry.booking_id}</a>}
        <WaitlistHistory id={entry.id} revision={`${entry.status}:${entry.booking_id || ''}`} />
      </article>;
    })}</div>
  </main>;
}
