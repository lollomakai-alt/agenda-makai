import { useEffect, useState } from 'react';
import { adminFetch } from '../lib/adminFetch';

const formatDate = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome',
});

export default function MaintenanceSettingsPage() {
  const [status, setStatus] = useState({ loading: true, saving: false, active: false, history: [], error: '' });

  async function refresh() {
    try {
      const response = await adminFetch('/api/admin/site-maintenance', { cache: 'no-store' });
      if (!response.ok) throw new Error('Stato manutenzione non disponibile.');
      const data = await response.json();
      if (typeof data.active !== 'boolean' || !Array.isArray(data.history)) throw new Error('Risposta manutenzione non valida.');
      setStatus(previous => ({ ...previous, loading: false, active: data.active, history: data.history, error: '' }));
    } catch (error) {
      setStatus(previous => ({ ...previous, loading: false, error: error.message }));
    }
  }

  useEffect(() => { refresh(); }, []);

  async function changeStatus() {
    if (status.loading || status.saving || status.error) return;
    setStatus(previous => ({ ...previous, saving: true, error: '' }));
    try {
      const response = await adminFetch('/api/admin/site-maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
        body: JSON.stringify({ active: !status.active }),
      });
      if (!response.ok) throw new Error('Cambio manutenzione non confermato. Rileggi lo stato prima di riprovare.');
      await refresh();
    } catch (error) {
      setStatus(previous => ({ ...previous, error: error.message }));
    } finally {
      setStatus(previous => ({ ...previous, saving: false }));
    }
  }

  return <main className="booking-admin maintenance-settings">
    <a href="/prenotazioni">← Calendario</a>
    <div className="agenda-heading"><div><p className="agenda-eyebrow">Sito Makai</p><h1>Manutenzione</h1></div></div>
    <p>La manutenzione sospende le nuove prenotazioni online. Le prenotazioni esistenti e le operazioni Agenda restano disponibili.</p>
    {status.loading ? <p role="status">Lettura dello stato…</p> : <>
      <p className="maintenance-settings-state" role="status">Stato: <strong>{status.error ? 'non verificabile' : status.active ? 'Attiva' : 'Disattiva'}</strong></p>
      {status.error && <p role="alert">{status.error}</p>}
      <button type="button" className="admin-button" disabled={status.saving || Boolean(status.error)} onClick={changeStatus}>
        {status.saving ? 'Salvataggio…' : status.active ? 'Disattiva manutenzione' : 'Attiva manutenzione'}
      </button>
      {status.error && <button type="button" className="admin-button admin-button-secondary" onClick={() => { setStatus(previous => ({ ...previous, loading: true })); refresh(); }}>Rileggi stato</button>}
      <section aria-labelledby="maintenance-history-title">
        <h2 id="maintenance-history-title">Storico amministrativo</h2>
        {status.history.length ? <ol>{status.history.map(item => <li key={item.id}>
          {item.active ? 'Attivata' : 'Disattivata'} · <time dateTime={item.created_at}>{formatDate.format(new Date(item.created_at))}</time> · {item.actor_id}
        </li>)}</ol> : <p>Nessun cambio registrato.</p>}
      </section>
    </>}
  </main>;
}
