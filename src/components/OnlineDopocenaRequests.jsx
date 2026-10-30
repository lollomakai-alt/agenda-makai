import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { dopocenaEmailLabel, dopocenaWhatsAppFallbackAllowed, loadOnlineDopocenaRequests, onlineDopocenaWhatsAppUrl, reviewOnlineDopocenaRequest } from '../utils/onlineDopocenaRequests';

const dateFormat = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Europe/Rome',
});

function displayDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
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
        ? `Richiesta accettata. Prenotazione #${result.booking_id} registrata senza tavolo. ${dopocenaEmailLabel(result.email_status)}.`
        : `Richiesta rifiutata. ${dopocenaEmailLabel(result.email_status)}.`);
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
  return <section className="online-dopocena-requests makai-collection" aria-labelledby="online-dopocena-title">
    <header className="makai-page-header">
      <div>
        <p className="agenda-eyebrow">Richieste DOPOCENA</p>
        <h1 id="online-dopocena-title">In attesa</h1>
      </div>
      <button className="admin-button admin-button-secondary" type="button" disabled={busyId !== null || loading}
        onClick={() => setRevision(value => value + 1)}>Aggiorna</button>
    </header>

    <p className="makai-page-note" role={pendingRequests.length ? 'status' : undefined}>
      {loading ? 'Caricamento richieste…' : pendingRequests.length
        ? `${pendingRequests.length} ${pendingRequests.length === 1 ? 'richiesta da gestire' : 'richieste da gestire'}`
        : 'Nessuna richiesta in attesa.'}
    </p>
    <p className="makai-page-note">Accetta registra la prenotazione senza tavolo. Rifiuta richiede una motivazione.</p>

    {error && <p role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {whatsAppOffer && <p><a className="admin-button" href={whatsAppOffer.url} target="_blank" rel="noopener noreferrer">{whatsAppOffer.label}</a></p>}
    {whatsAppError && <p role="alert">{whatsAppError}</p>}

    {pendingRequests.length === 0 ? (!loading && !error && <p className="makai-empty">Le nuove richieste compariranno qui.</p>) : <ul className="makai-list">
      {pendingRequests.map(request => <li key={request.request_id} className="makai-list-item online-dopocena-item">
        <article className="makai-record">
          <div className="makai-record-card">
            <div className="makai-record-heading">
              <h2 className="makai-record-name">{request.name}</h2>
              <span className="makai-badge is-wait">In attesa</span>
            </div>
            <p className="makai-record-meta">
              {displayDate(request.booking_date)} · {String(request.booking_time || '').slice(0, 5)} · {request.party_size} {request.party_size === 1 ? 'persona' : 'persone'} · Tavolo da assegnare
            </p>

            <details className="makai-record-details">
              <summary>Dettagli</summary>
              <div className="makai-record-details-body">
                <div className="makai-contact-row">
                  {request.phone ? <a href={`tel:${request.phone}`}>{request.phone}</a> : <span>Telefono non disponibile</span>}
                  {request.email ? <a href={`mailto:${request.email}`}>{request.email}</a> : <span>Email non disponibile</span>}
                </div>
                {request.notes && <p><strong>Note:</strong> {request.notes}</p>}
              </div>
            </details>

            <div className="makai-record-actions is-two">
              <button type="button" className="admin-button is-accept" disabled={disabled || busyId !== null || rejectingId !== null}
                onClick={() => decide(request, 'accepted')}>
                {busyId === request.request_id ? 'Invio…' : 'Accetta'}
              </button>
              <button type="button" className="admin-button admin-button-secondary is-danger" disabled={disabled || busyId !== null || rejectingId !== null}
                onClick={() => { setRejectingId(request.request_id); setRejectionReason(''); setError(''); }}>
                Rifiuta
              </button>
            </div>
          </div>

          {rejectingId === request.request_id && <form className="online-dopocena-rejection" aria-label={`Rifiuta la richiesta di ${request.name}`} onSubmit={event => { event.preventDefault(); return decide(request, 'rejected', rejectionReason); }}>
            <label htmlFor={`rejection-reason-${request.request_id}`}>Motivazione del rifiuto</label>
            <p id={`rejection-help-${request.request_id}`}>Questo testo sarà inviato al cliente nell’email di rifiuto. Se l’email non è disponibile, resta nel messaggio WhatsApp alternativo.</p>
            <textarea id={`rejection-reason-${request.request_id}`} aria-describedby={`rejection-help-${request.request_id}`} value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} required maxLength={500} rows={4} autoFocus disabled={disabled || busyId !== null} />
            <span>{rejectionReason.length}/500 caratteri</span>
            <div className="online-dopocena-actions">
              <button className="admin-button" type="submit" disabled={disabled || busyId !== null || !rejectionReason.trim()}>{busyId === request.request_id ? 'Rifiuto e invio email…' : 'Conferma rifiuto e invia email'}</button>
              <button className="admin-button admin-button-secondary" type="button" disabled={busyId !== null} onClick={() => { setRejectingId(null); setRejectionReason(''); }}>Annulla</button>
            </div>
          </form>}
        </article>
      </li>)}
    </ul>}

    <p className="makai-page-note makai-archive-link">
      <a href="/archivio?tipo=dopocena">Le decisioni concluse sono nell’Archivio.</a>
    </p>
  </section>;
}
