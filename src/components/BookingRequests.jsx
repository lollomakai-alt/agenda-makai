import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { sendCancellationEmail } from '../utils/bookingCancellation';
import BookingCancellationFeedback from './BookingCancellationFeedback';
import {
  bookingRequestEmailLabel,
  bookingUpdateEmailLabel,
  createBookingRequest,
  loadBookingRequests,
  loadBookingRequestAlternatives,
  rejectBookingRequest,
  reviewBookingRequest,
  sendBookingUpdateEmail,
  REQUEST_TYPES,
} from '../utils/bookingRequests';

const requestDateFormat = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Europe/Rome',
});
const receivedDateFormat = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome',
});

function requestedDateLabel(value) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? requestDateFormat.format(date) : String(value);
}

function whenLabel(booking) {
  if (!booking) return 'Prenotazione non disponibile';
  const date = booking.booking_date ? requestedDateLabel(booking.booking_date) : '';
  const time = String(booking.booking_time || '').slice(0, 5);
  return [date, time].filter(Boolean).join(' · ');
}

function requestDescription(request) {
  if (request.request_type === 'cancellazione') return 'Chiede di cancellare la prenotazione.';
  if (request.request_type === 'note') return 'Chiede di aggiornare le note della prenotazione.';
  if (request.request_type === 'data') return `Chiede di spostare al ${requestedDateLabel(request.requested_value)}.`;
  if (request.request_type === 'ora') return `Chiede di cambiare l’orario: ${String(request.requested_value ?? '')}.`;
  if (request.request_type === 'persone') return `Chiede ${request.requested_value} persone.`;
  const type = REQUEST_TYPES[request.request_type] || 'una modifica';
  return `Chiede ${type.toLowerCase()}: ${String(request.requested_value ?? '')}.`;
}

export default function BookingRequests({ appointments = [], disabled, onChanged }) {
  const [requests, setRequests] = useState([]);
  const [cancellation, setCancellation] = useState(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState('');
  const [type, setType] = useState('data');
  const [value, setValue] = useState('');
  const [revision, setRevision] = useState(0);
  const [alternatives, setAlternatives] = useState({});
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [proposingId, setProposingId] = useState(null);
  const [proposalText, setProposalText] = useState('');
  const focusedRequest = useRef('');

  useEffect(() => {
    let active = true;
    let generation = 0;
    async function load() {
      const current = ++generation;
      try {
        const rows = await loadBookingRequests(supabase);
        if (active && current === generation) { setRequests(rows); setError(''); }
      } catch (failure) { if (active && current === generation) setError(failure.message); }
      finally { if (active && current === generation) setLoading(false); }
    }
    load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [revision]);

  useEffect(() => {
    if (!requests.length || typeof document === 'undefined') return;
    const requestId = /^#request-(\d+)$/.exec(window.location.hash)?.[1];
    if (!requestId || focusedRequest.current === requestId) return;
    const node = document.getElementById(`request-${requestId}`);
    if (!node) return;
    focusedRequest.current = requestId;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.add('is-highlighted');
    const timer = window.setTimeout(() => node.classList.remove('is-highlighted'), 4000);
    return () => window.clearTimeout(timer);
  }, [requests]);

  async function submit(event) {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      await createBookingRequest(supabase, bookingId, type, value);
      setValue(''); setRevision(x => x + 1); onChanged?.(); window.dispatchEvent(new Event('booking-requests-changed')); window.dispatchEvent(new Event('admin-notifications-changed'));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function approve(request) {
    if (busy || disabled) return;
    if (request.request_type === 'cancellazione'
      && !window.confirm('Confermi la cancellazione della prenotazione? Verrà inviata automaticamente l’email di cancellazione, se disponibile.')) return;
    setBusy(true); setBusyId(request.id); setError(''); setFeedback(''); setCancellation(null);
    try {
      await reviewBookingRequest(supabase, request, 'approved');
      if (request.request_type === 'cancellazione') {
        const booking = request.booking || appointments.find(b => String(b.id) === String(request.booking_id)) || { id: request.booking_id };
        setCancellation({ booking, status: 'pending' });
        onChanged?.();
        const email = await sendCancellationEmail(supabase, request.booking_id);
        setCancellation({ booking, status: email.status });
        setFeedback('Cancellazione confermata.');
      } else {
        const email = await sendBookingUpdateEmail(supabase, request.booking_id);
        setFeedback(`Modifica confermata. ${bookingUpdateEmailLabel(email.status)}`);
      }
      setRevision(x => x + 1); onChanged?.(); window.dispatchEvent(new Event('booking-requests-changed')); window.dispatchEvent(new Event('admin-notifications-changed'));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setBusyId(null); }
  }

  async function reject(request) {
    if (busy || disabled) return;
    setBusy(true); setBusyId(request.id); setError(''); setFeedback('');
    try {
      const result = await rejectBookingRequest(supabase, request, rejectionReason);
      setFeedback(`Richiesta rifiutata. ${bookingRequestEmailLabel(result.email_status)}.`);
      setRejectingId(null); setRejectionReason('');
      setRevision(x => x + 1); onChanged?.(); window.dispatchEvent(new Event('booking-requests-changed')); window.dispatchEvent(new Event('admin-notifications-changed'));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setBusyId(null); }
  }

  function startProposal(request, suggestion = '') {
    if (busy || disabled) return;
    setProposingId(request.id); setProposalText(suggestion || request.alternative_note || '');
    setRejectingId(null); setRejectionReason(''); setError(''); setFeedback('');
  }

  async function submitProposal(event, request) {
    event.preventDefault();
    const proposal = proposalText.trim();
    if (!proposal || busy || disabled) return;
    setBusy(true); setBusyId(request.id); setError(''); setFeedback('');
    try {
      const { error: rpcError } = await supabase.rpc('admin_propose_booking_alternative', { request_id: request.id, proposal });
      if (rpcError) throw rpcError;
      setFeedback('Alternativa proposta al cliente.');
      setProposingId(null); setProposalText('');
      setRevision(x => x + 1); onChanged?.(); window.dispatchEvent(new Event('booking-requests-changed'));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setBusyId(null); }
  }

  async function showAlternatives(request) {
    if (busy || disabled) return;
    setBusy(true); setError('');
    try {
      const rows = await loadBookingRequestAlternatives(supabase, request.id);
      setAlternatives(previous => ({ ...previous, [request.id]: rows }));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  const pending = requests.filter(request => request.status === 'pending');
  return <section className="booking-requests makai-collection" aria-label="Richieste clienti">
    <header className="makai-page-header">
      <div>
        <p className="agenda-eyebrow">Richieste clienti</p>
        <h1>In attesa</h1>
      </div>
      <button className="admin-button admin-button-secondary" type="button" disabled={busy || loading}
        onClick={() => setRevision(x => x + 1)}>Aggiorna</button>
    </header>

    {loading ? <p role="status">Caricamento richieste…</p>
      : <p className="makai-page-note" role={pending.length ? 'status' : undefined}>
        {pending.length ? `${pending.length} ${pending.length === 1 ? 'richiesta da gestire' : 'richieste da gestire'}` : 'Nessuna richiesta in attesa.'}
      </p>}
    <p className="makai-page-note">Accetta applica la modifica e invia l’email. Rifiuta richiede una motivazione.</p>
    {error && <p role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {cancellation && <BookingCancellationFeedback key={cancellation.booking.id} {...cancellation} />}

    {!!pending.length && <ul className="makai-list">
      {pending.map(request => {
        const original = request.booking || appointments.find(b => String(b.id) === String(request.booking_id));
        const detailsId = `request-details-${request.id}`;
        return <li key={request.id} id={`request-${request.id}`} className="makai-list-item booking-request-item">
          <article className="makai-record">
            <div className="makai-record-card">
              <div className="makai-record-heading">
                <h2 className="makai-record-name">{original?.name || 'Cliente'}</h2>
                <span className="makai-badge is-wait">In attesa</span>
              </div>
              <p className="makai-record-meta">
                {whenLabel(original)} · {original?.party_size ?? '—'} persone
                {original?.tables ? ` · Tavolo ${original.tables}` : ' · Tavolo da assegnare'}
              </p>
              <p className="makai-record-request">{requestDescription(request)}</p>

              <details className="makai-record-details">
                <summary aria-controls={detailsId}>Dettagli</summary>
                <div className="makai-record-details-body" id={detailsId}>
                  <p className="makai-detail-muted">
                    {request.origin === 'customer' ? 'Inviata dal cliente' : 'Registrata dallo staff'}
                    {' · '}ricevuta il {receivedDateFormat.format(new Date(request.created_at))}
                  </p>
                  {request.request_type === 'note' && request.requested_value && <p>
                    <strong>Note richieste:</strong> {String(request.requested_value)}
                  </p>}
                  <div className="makai-contact-row">
                    {original?.phone
                      ? <a href={`tel:${original.phone}`}>{original.phone}</a>
                      : <span>Telefono non disponibile</span>}
                    {original?.email
                      ? <a href={`mailto:${original.email}`}>{original.email}</a>
                      : <span>Email non disponibile</span>}
                  </div>
                  {request.alternative_note && <p><strong>Alternativa già proposta:</strong> {request.alternative_note}</p>}
                  <a className="makai-detail-link" href={`/prenotazioni/giorno?date=${original?.booking_date || ''}#booking-${request.booking_id}`}>
                    Apri la prenotazione nella giornata
                  </a>
                  {request.origin === 'customer' && request.request_type !== 'cancellazione' && request.request_type !== 'note' && <div className="makai-alternatives">
                    <button type="button" className="admin-button admin-button-secondary" disabled={busy || disabled}
                      onClick={() => showAlternatives(request)}>Cerca disponibilità</button>
                    {alternatives[request.id]?.length === 0 && <p className="makai-detail-muted">Nessuna alternativa trovata.</p>}
                    {alternatives[request.id]?.map(option => <button type="button" className="admin-button admin-button-secondary"
                      key={`${option.booking_date}-${option.booking_time}`} disabled={busy || disabled}
                      onClick={() => startProposal(request, `${option.booking_date} alle ${option.booking_time} per ${option.party_size} persone`)}>
                      {option.booking_date} · {option.booking_time} · {option.party_size} persone
                    </button>)}
                  </div>}
                </div>
              </details>

              <div className="makai-record-actions">
                <button className="admin-button is-accept" disabled={busy || disabled || rejectingId !== null || proposingId !== null}
                  onClick={() => approve(request)}>
                  {busyId === request.id ? 'Invio…' : 'Accetta'}
                </button>
                <button className="admin-button admin-button-secondary" disabled={busy || disabled || rejectingId !== null || proposingId !== null}
                  onClick={() => startProposal(request)}>Proponi alternativa</button>
                <button className="admin-button admin-button-secondary is-danger" disabled={busy || disabled || rejectingId !== null || proposingId !== null}
                  onClick={() => { setRejectingId(request.id); setRejectionReason(''); setProposingId(null); setError(''); setFeedback(''); }}>Rifiuta</button>
              </div>
            </div>

            {proposingId === request.id && <form className="booking-request-proposal" aria-label={`Proponi un’alternativa a ${original?.name || 'cliente'}`}
              onSubmit={event => submitProposal(event, request)}>
              <label htmlFor={`request-proposal-${request.id}`}>Alternativa da concordare</label>
              <p id={`request-proposal-help-${request.id}`}>La proposta non viene inviata automaticamente: resta da concordare con il cliente.</p>
              <textarea id={`request-proposal-${request.id}`} aria-describedby={`request-proposal-help-${request.id}`}
                value={proposalText} onChange={event => setProposalText(event.target.value)}
                required maxLength={500} rows={3} autoFocus disabled={disabled || busy} />
              <div className="online-dopocena-actions">
                <button className="admin-button" type="submit" disabled={disabled || busy || !proposalText.trim()}>
                  {busyId === request.id ? 'Salvataggio…' : 'Conferma proposta'}
                </button>
                <button className="admin-button admin-button-secondary" type="button" disabled={busy}
                  onClick={() => { setProposingId(null); setProposalText(''); }}>Annulla</button>
              </div>
            </form>}

            {rejectingId === request.id && <form className="booking-request-rejection" aria-label={`Rifiuta la richiesta di ${original?.name || 'cliente'}`}
              onSubmit={event => { event.preventDefault(); return reject(request); }}>
              <label htmlFor={`request-rejection-${request.id}`}>Motivazione del rifiuto</label>
              <p id={`request-rejection-help-${request.id}`}>Questo testo sarà scritto nell’email di rifiuto. Il cliente riceverà anche il link al calendario del sito per cambiare giorno o orario. La prenotazione attuale resta invariata.</p>
              <textarea id={`request-rejection-${request.id}`} aria-describedby={`request-rejection-help-${request.id}`}
                value={rejectionReason} onChange={event => setRejectionReason(event.target.value)}
                required maxLength={500} rows={4} autoFocus disabled={disabled || busy} />
              <span>{rejectionReason.length}/500 caratteri</span>
              <div className="online-dopocena-actions">
                <button className="admin-button" type="submit" disabled={disabled || busy || !rejectionReason.trim()}>
                  {busyId === request.id ? 'Rifiuto e invio email…' : 'Conferma rifiuto e invia email'}
                </button>
                <button className="admin-button admin-button-secondary" type="button" disabled={busy}
                  onClick={() => { setRejectingId(null); setRejectionReason(''); }}>Annulla</button>
              </div>
            </form>}
          </article>
        </li>;
      })}
    </ul>}

    <details className="makai-secondary-panel">
      <summary>Registra richiesta ricevuta</summary>
      <form className="booking-admin-form" onSubmit={submit}>
        <fieldset disabled={busy || disabled}>
          <label>Prenotazione<select required value={bookingId} onChange={event => setBookingId(event.target.value)}>
            <option value="">Seleziona prenotazione</option>
            {appointments.filter(b => !b.status || b.status === 'confirmed').map(b => <option key={b.id} value={b.id}>
              {b.name} · {b.booking_date} {b.booking_time?.slice(0, 5)}
            </option>)}
          </select></label>
          <label>Tipo<select value={type} onChange={event => { setType(event.target.value); setValue(''); }}>
            {Object.entries(REQUEST_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          {type !== 'cancellazione' && <label>Valore richiesto
            {type === 'note' ? <textarea value={value} maxLength={300} onChange={event => setValue(event.target.value)} />
              : <input required type={type === 'data' ? 'date' : type === 'ora' ? 'time' : 'number'}
                min={type === 'persone' ? 1 : undefined} max={type === 'persone' ? 6 : undefined}
                value={value} onChange={event => setValue(event.target.value)} />}
          </label>}
          <button className="admin-button" type="submit">Registra richiesta</button>
        </fieldset>
      </form>
    </details>
  </section>;
}
