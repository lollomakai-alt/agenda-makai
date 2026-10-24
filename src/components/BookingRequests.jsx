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
      setFeedback(`Richiesta rifiutata. ${bookingRequestEmailLabel(result.email_status)}. La motivazione è stata inviata al cliente con il calendario per scegliere un altro giorno o orario.`);
      setRejectingId(null); setRejectionReason('');
      setRevision(x => x + 1); onChanged?.(); window.dispatchEvent(new Event('booking-requests-changed')); window.dispatchEvent(new Event('admin-notifications-changed'));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setBusyId(null); }
  }

  async function propose(request, suggestion = '') {
    const proposal = window.prompt('Proposta da concordare con il cliente (data, ora o persone):', suggestion || request.alternative_note || '');
    if (!proposal?.trim() || busy || disabled) return;
    setBusy(true); setError('');
    try { const {error} = await supabase.rpc('admin_propose_booking_alternative', {request_id:request.id,proposal:proposal.trim()}); if(error) throw error; setRevision(x=>x+1); onChanged?.(); }
    catch(failure) { setError(failure.message); } finally {setBusy(false);}
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
  const decided = requests.filter(request => request.status !== 'pending').slice(0, 6);
  return <section className="booking-requests" aria-label="Richieste clienti">
    <h2>Richieste clienti</h2>
    {loading ? <p role="status">Caricamento richieste…</p> : <p role={pending.length ? 'alert' : 'status'}>
      {pending.length ? `${pending.length} richieste ricevute, in attesa della decisione dello staff, anche per altre date.` : 'Nessuna richiesta in attesa dello staff.'}</p>}
    <p>Accettare applica la modifica e invia al cliente l’email con i nuovi dettagli. Rifiutare richiede una motivazione: sarà scritta nell’email insieme al calendario del sito per scegliere un altro giorno o orario.</p>
    <button className="admin-button admin-button-secondary" disabled={busy} onClick={() => setRevision(x => x + 1)}>Aggiorna richieste</button>
    {error && <p role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {cancellation && <BookingCancellationFeedback key={cancellation.booking.id} {...cancellation} />}
    <details><summary>Registra richiesta ricevuta dal cliente</summary>
      <form className="booking-admin-form" onSubmit={submit}>
        <fieldset disabled={busy || disabled}>
          <label>Prenotazione<select required value={bookingId} onChange={event => setBookingId(event.target.value)}>
            <option value="">Seleziona prenotazione</option>
            {appointments.filter(b => !b.status || b.status === 'confirmed').map(b => <option key={b.id} value={b.id}>
              #{b.id} · {b.booking_date} {b.booking_time?.slice(0, 5)} · {b.name}
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
          <p>La richiesta resta in attesa dello staff: registrarla non modifica e non cancella la prenotazione. Nessun messaggio al cliente viene inviato da questo modulo.</p>
          <button className="admin-button" type="submit">Registra richiesta</button>
        </fieldset>
      </form>
    </details>
    <ul>{pending.map(request => {
      const original = request.booking || appointments.find(b => String(b.id) === String(request.booking_id));
      return <li key={request.id} id={`request-${request.id}`} className="booking-request-item">
      <p><a href={`/prenotazioni/giorno?date=${original?.booking_date || ''}#booking-${request.booking_id}`}>Prenotazione #{request.booking_id}</a>
        {' · '}{request.origin === 'customer' ? 'Cliente' : 'Staff'}
        {' · '}{new Date(request.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</p>
      {original && <p>Attuale: {original.name} · {original.booking_date} alle {original.booking_time?.slice(0, 5)} · {original.party_size} persone · {original.booking_type === 'dopocena' ? 'DOPOCENA' : 'CENA'}{original.tables ? ` · Tavolo ${original.tables}` : ''}</p>}
      <p>In attesa dello staff: {REQUEST_TYPES[request.request_type]}{request.requested_value !== null ? ` · ${String(request.requested_value)}` : ''}</p>
      {request.alternative_note && <p>Alternativa proposta, da concordare: {request.alternative_note}</p>}
      {request.origin === 'customer' && request.request_type !== 'cancellazione' && request.request_type !== 'note' && <details>
        <summary>Alternative compatibili</summary>
        <button type="button" className="admin-button admin-button-secondary" disabled={busy || disabled} onClick={() => showAlternatives(request)}>Cerca disponibilità</button>
        {alternatives[request.id]?.length === 0 && <p>Nessuna alternativa trovata. Verifica con il cliente senza promettere disponibilità.</p>}
        {alternatives[request.id]?.map(option => <button type="button" className="admin-button admin-button-secondary"
          key={`${option.booking_date}-${option.booking_time}`} disabled={busy || disabled}
          onClick={() => propose(request, `${option.booking_date} alle ${option.booking_time} per ${option.party_size} persone`)}>
          {option.booking_date} · {option.booking_time} · {option.party_size} persone
        </button>)}
      </details>}
      <button className="admin-button admin-button-secondary" disabled={busy || disabled} onClick={() => propose(request)}>Proponi alternativa</button>
      <button className="admin-button" disabled={busy || disabled || rejectingId !== null} onClick={() => approve(request)}>
        {busyId === request.id ? 'Decisione e invio email…' : 'Accetta'}
      </button>{' '}
      <button className="admin-button admin-button-secondary" disabled={busy || disabled || rejectingId !== null}
        onClick={() => { setRejectingId(request.id); setRejectionReason(''); setError(''); setFeedback(''); }}>Rifiuta</button>
      {rejectingId === request.id && <form className="booking-request-rejection" aria-label={`Rifiuta la richiesta di ${original?.name || `prenotazione #${request.booking_id}`}`}
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
    </li>;})}</ul>
    {!!decided.length && <details className="booking-requests-decided"><summary>Decisioni recenti</summary>
      <ul>{decided.map(request => <li key={request.id}>
        <p>Prenotazione #{request.booking_id} · {REQUEST_TYPES[request.request_type]}{request.requested_value !== null ? ` · ${String(request.requested_value)}` : ''} · {request.status === 'approved' ? 'Accettata' : 'Rifiutata'}</p>
        {request.rejection_reason && <p>Motivazione inviata: {request.rejection_reason}</p>}
        {request.status === 'rejected' && request.decision_email_status && <p>{bookingRequestEmailLabel(request.decision_email_status)}</p>}
      </li>)}</ul>
    </details>}
  </section>;
}
