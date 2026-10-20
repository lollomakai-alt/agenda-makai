import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { dopocenaEmailLabel, dopocenaWhatsAppFallbackAllowed, loadOnlineDopocenaRequests, onlineDopocenaWhatsAppUrl, reviewOnlineDopocenaRequest } from '../utils/onlineDopocenaRequests';

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
  const decisionPending = useRef(false);
  const [whatsAppOffer, setWhatsAppOffer] = useState(null);
  const [whatsAppError, setWhatsAppError] = useState('');
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

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

  async function decide(request, decision, reason = '') {
    if (decisionPending.current || busyId || disabled) return;
    const question = decision === 'accepted'
      ? `Accettare la richiesta DOPOCENA di ${request.name}? La prenotazione sarà registrata senza tavolo: l’accettazione non assegna un tavolo.`
      : `Rifiutare la richiesta DOPOCENA di ${request.name}?`;
    if (decision === 'accepted' && !window.confirm(question)) return;
    decisionPending.current = true;
    setWhatsAppOffer(null);
    setWhatsAppError('');
    setBusyId(request.request_id);
    setError('');
    setFeedback('');
    try {
      const result = await reviewOnlineDopocenaRequest(supabase, request, decision, undefined, reason);
      const whatsAppFallback = dopocenaWhatsAppFallbackAllowed(result.email_status);
      const url = whatsAppFallback
        ? onlineDopocenaWhatsAppUrl({ ...request, rejection_reason: result.rejection_reason }, decision, result.booking_id) : null;
      if (url) setWhatsAppOffer({ url, label: 'Apri WhatsApp (email non disponibile)' });
      if (whatsAppFallback && !url) setWhatsAppError('Decisione salvata. Messaggio WhatsApp non preparato: verifica il numero del cliente.');
      setFeedback(decision === 'accepted'
        ? `Richiesta DOPOCENA accettata. Prenotazione #${result.booking_id} registrata senza tavolo assegnato. ${dopocenaEmailLabel(result.email_status)}.${whatsAppFallback ? ' Email non disponibile: puoi contattare il cliente su WhatsApp.' : ''}`
        : `Richiesta DOPOCENA rifiutata. ${dopocenaEmailLabel(result.email_status)}.${whatsAppFallback ? ' Email non disponibile: puoi contattare il cliente su WhatsApp.' : ''}`);
      setRejectingId(null);
      setRejectionReason('');
      await refresh();
      onChanged?.();
      window.dispatchEvent(new Event('after-dinner-requests-changed'));
      window.dispatchEvent(new Event('admin-notifications-changed'));
    } catch (failure) {
      await refresh();
      setError(failure.message);
    } finally {
      decisionPending.current = false;
      setBusyId(null);
    }
  }

  const pendingRequests = requests.filter(request => request.status === 'pending');
  const archivedRequests = requests.filter(request => request.status !== 'pending');
  function renderRequest(request) {
    const whatsappUrl = request.status !== 'pending' && busyId !== request.request_id
      && dopocenaWhatsAppFallbackAllowed(request.email_status)
      ? onlineDopocenaWhatsAppUrl(request, request.status, request.booking_id) : null;
    return <li className={`online-dopocena-item is-${request.status}`} key={request.request_id}>
      <div className="online-dopocena-customer">
        <strong>{request.name}</strong>
        <span>{displayDate(request.booking_date)} · {request.booking_time} · {request.party_size} {request.party_size === 1 ? 'persona' : 'persone'}</span>
        <a href={`tel:${request.phone}`}>{request.phone}</a>
        {request.email && <a href={`mailto:${request.email}`}>{request.email}</a>}
        {request.notes && <p>Note: {request.notes}</p>}
      </div>
      <div className="online-dopocena-status">
        <span>{request.status === 'pending' ? 'Ricevuta · in attesa dello staff' : request.status === 'accepted' ? `Richiesta accettata · tavolo da verificare in Agenda${request.booking_id ? ` · pren. #${request.booking_id}` : ''}` : 'Rifiutata'}</span>
        {request.rejection_reason && <p>Motivazione: {request.rejection_reason}</p>}
        {request.status !== 'pending' && <span>{dopocenaEmailLabel(request.email_status)}</span>}
        {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">Apri WhatsApp (email non disponibile)</a>}
        {request.status === 'pending' && <div className="online-dopocena-actions">
          <button type="button" className="admin-button" disabled={disabled || busyId !== null || rejectingId !== null} onClick={() => decide(request, 'accepted')}>
            {busyId === request.request_id ? 'Decisione e invio email…' : 'Accetta'}
          </button>
          <button type="button" className="admin-button admin-button-secondary" disabled={disabled || busyId !== null || rejectingId !== null} onClick={() => { setRejectingId(request.request_id); setRejectionReason(''); setError(''); }}>
            Rifiuta
          </button>
        </div>}
      </div>
      {request.status === 'pending' && rejectingId === request.request_id && <form className="online-dopocena-rejection" aria-label={`Rifiuta la richiesta di ${request.name}`} onSubmit={event => { event.preventDefault(); return decide(request, 'rejected', rejectionReason); }}>
        <label htmlFor={`rejection-reason-${request.request_id}`}>Motivazione del rifiuto</label>
        <p id={`rejection-help-${request.request_id}`}>Questo testo sarà inviato al cliente nell’email di rifiuto. Se l’email non è disponibile, resta nel messaggio WhatsApp alternativo.</p>
        <textarea id={`rejection-reason-${request.request_id}`} aria-describedby={`rejection-help-${request.request_id}`} value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} required maxLength={500} rows={4} autoFocus disabled={disabled || busyId !== null} />
        <span>{rejectionReason.length}/500 caratteri</span>
        <div className="online-dopocena-actions">
          <button className="admin-button" type="submit" disabled={disabled || busyId !== null || !rejectionReason.trim()}>{busyId === request.request_id ? 'Rifiuto e invio email…' : 'Conferma rifiuto e invia email'}</button>
          <button className="admin-button admin-button-secondary" type="button" disabled={busyId !== null} onClick={() => { setRejectingId(null); setRejectionReason(''); }}>Annulla</button>
        </div>
      </form>}
    </li>;
  }
  return <section className="online-dopocena-requests" aria-labelledby="online-dopocena-title">
    <div className="online-dopocena-heading">
      <div>
        <h2 id="online-dopocena-title">Richieste DOPOCENA</h2>
        <p>In attesa dello staff: {pendingRequests.length}. La richiesta ricevuta non conferma la prenotazione. Accettarla registra una prenotazione senza tavolo assegnato. Le decisioni concluse restano in archivio.</p>
      </div>
      <button className="admin-button admin-button-secondary" type="button" disabled={busyId !== null} onClick={() => setRevision(value => value + 1)}>
        Ricarica richieste
      </button>
    </div>
    {loading && <p role="status">Caricamento richieste…</p>}
    {error && <p role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {whatsAppOffer && <p><a className="admin-button" href={whatsAppOffer.url} target="_blank" rel="noopener noreferrer">{whatsAppOffer.label}</a></p>}
    {whatsAppError && <p role="alert">{whatsAppError}</p>}
    {!loading && !error && requests.length === 0 && <p role="status">Nessuna richiesta DOPOCENA in questa coda.</p>}
    {pendingRequests.length > 0 && <section aria-labelledby="dopocena-pending-title">
      <h3 id="dopocena-pending-title">Da gestire ({pendingRequests.length})</h3>
      <ul className="online-dopocena-list">{pendingRequests.map(renderRequest)}</ul>
    </section>}
    {archivedRequests.length > 0 && <details className="online-dopocena-archive">
      <summary>Archiviate ({archivedRequests.length})</summary>
      <ul className="online-dopocena-list">{archivedRequests.map(renderRequest)}</ul>
    </details>}
  </section>;
}
