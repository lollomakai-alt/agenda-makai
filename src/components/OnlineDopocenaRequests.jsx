import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { loadOnlineDopocenaRequests, reviewOnlineDopocenaRequest } from '../utils/onlineDopocenaRequests';

function displayDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
}

export default function OnlineDopocenaRequests({ disabled = false, onChanged }) {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const rows = await loadOnlineDopocenaRequests(supabase);
      setRequests(rows);
      setError('');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => window.clearInterval(timer);
  }, [refresh, revision]);

  async function decide(request, decision) {
    if (busyId || disabled) return;
    const question = decision === 'accepted'
      ? `Accettare la richiesta di ${request.name} e creare la prenotazione DOPOCENA senza tavolo?`
      : `Rifiutare la richiesta DOPOCENA di ${request.name}?`;
    if (!window.confirm(question)) return;
    setBusyId(request.request_id);
    setError('');
    setFeedback('');
    try {
      const result = await reviewOnlineDopocenaRequest(supabase, request, decision);
      setFeedback(decision === 'accepted'
        ? `Richiesta accettata. Prenotazione #${result.booking_id} creata senza tavolo.`
        : 'Richiesta rifiutata.');
      await refresh();
      onChanged?.();
      window.dispatchEvent(new Event('admin-notifications-changed'));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusyId(null);
    }
  }

  const pending = requests.filter(request => request.status === 'pending').length;
  return <section className="online-dopocena-requests" aria-labelledby="online-dopocena-title">
    <div className="online-dopocena-heading">
      <div>
        <h2 id="online-dopocena-title">Richieste DOPOCENA</h2>
        <p>In attesa: {pending}. Accettare crea una prenotazione senza assegnare un tavolo; l’invio della risposta al cliente verrà collegato separatamente.</p>
      </div>
      <button className="admin-button admin-button-secondary" type="button" disabled={busyId !== null} onClick={() => setRevision(value => value + 1)}>
        Ricarica richieste
      </button>
    </div>
    {loading && <p role="status">Caricamento richieste…</p>}
    {error && <p role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {!loading && !error && requests.length === 0 && <p role="status">Nessuna richiesta DOPOCENA ricevuta.</p>}
    {requests.length > 0 && <ul className="online-dopocena-list">{requests.map(request => <li className={`online-dopocena-item is-${request.status}`} key={request.request_id}>
      <div className="online-dopocena-customer">
        <strong>{request.name}</strong>
        <span>{displayDate(request.booking_date)} · {request.booking_time} · {request.party_size} {request.party_size === 1 ? 'persona' : 'persone'}</span>
        <a href={`tel:${request.phone}`}>{request.phone}</a>
        {request.email && <a href={`mailto:${request.email}`}>{request.email}</a>}
        {request.notes && <p>Note: {request.notes}</p>}
      </div>
      <div className="online-dopocena-status">
        <span>{request.status === 'pending' ? 'In attesa' : request.status === 'accepted' ? `Accettata${request.booking_id ? ` · pren. #${request.booking_id}` : ''}` : 'Rifiutata'}</span>
        {request.status === 'pending' && <div className="online-dopocena-actions">
          <button type="button" className="admin-button" disabled={disabled || busyId !== null} onClick={() => decide(request, 'accepted')}>
            {busyId === request.request_id ? 'Salvataggio…' : 'Accetta'}
          </button>
          <button type="button" className="admin-button admin-button-secondary" disabled={disabled || busyId !== null} onClick={() => decide(request, 'rejected')}>
            Rifiuta
          </button>
        </div>}
      </div>
    </li>)}</ul>}
  </section>;
}
