import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { historyChanges, loadBookingHistory } from '../utils/bookingHistory';

const actionLabels = { waitlist_converted: 'Conversione lista d’attesa', status_changed: 'Cambio stato', booking_updated: 'Modifica prenotazione', customer_request_created: 'Richiesta cliente ricevuta', customer_request_approved: 'Richiesta cliente approvata', customer_request_rejected: 'Richiesta cliente rifiutata' };
const dateFormat = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Rome',
});

export default function BookingHistory({ bookingId, revision }) {
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ loading: false, entries: [], error: '' });
  useEffect(() => {
    if (!open) return;
    let active = true;
    setState({ loading: true, entries: [], error: '' });
    loadBookingHistory(supabase, bookingId).then(entries => {
      if (active) setState({ loading: false, entries, error: '' });
    }).catch(error => {
      if (active) setState({ loading: false, entries: [], error: error.message });
    });
    return () => { active = false; };
  }, [bookingId, revision, open, retry]);

  return <details className="booking-history" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Storico modifiche</summary>
    {open && <>
      <button className="admin-button admin-button-secondary" type="button"
        disabled={state.loading} onClick={() => setRetry(value => value + 1)}>Aggiorna storico</button>
      {state.loading && <p role="status">Caricamento storico…</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {!state.loading && !state.error && (state.entries.length ? <ol>
        {state.entries.map(entry => <li key={entry.id}>
          <p><time dateTime={entry.created_at}>{dateFormat.format(new Date(entry.created_at))}</time>
            {' · '}{actionLabels[entry.action] || 'Modifica prenotazione'}</p>
          {historyChanges(entry).map(change => <p key={change}>{change}</p>)}
        </li>)}
      </ol> : <p>Nessuna modifica registrata.</p>)}
    </>}
  </details>;
}
