import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { createBookingRequest, loadBookingRequests, loadBookingRequestAlternatives, reviewBookingRequest, REQUEST_TYPES } from '../utils/bookingRequests';

export default function BookingRequests({ appointments, disabled, onChanged }) {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState('');
  const [type, setType] = useState('data');
  const [value, setValue] = useState('');
  const [revision, setRevision] = useState(0);
  const [alternatives, setAlternatives] = useState({});
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
  async function submit(event) {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true); setError('');
    try {
      await createBookingRequest(supabase, bookingId, type, value);
      setValue(''); setRevision(x => x + 1); onChanged(); window.dispatchEvent(new Event('admin-notifications-changed'));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function review(request, decision) {
    if (busy || disabled) return;
    setBusy(true); setError('');
    try {
      await reviewBookingRequest(supabase, request, decision);
      setRevision(x => x + 1); onChanged(); window.dispatchEvent(new Event('admin-notifications-changed'));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function propose(request, suggestion = '') {
    const proposal = window.prompt('Proposta da concordare con il cliente (data, ora o persone):', suggestion || request.alternative_note || '');
    if (!proposal?.trim() || busy || disabled) return;
    setBusy(true); setError('');
    try { const {error} = await supabase.rpc('admin_propose_booking_alternative', {request_id:request.id,proposal:proposal.trim()}); if(error) throw error; setRevision(x=>x+1); onChanged(); }
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
  return <section className="booking-requests" aria-label="Richieste clienti">
    <h2>Richieste clienti</h2>
    {loading ? <p role="status">Caricamento richieste…</p> : <p role={pending.length ? 'alert' : 'status'}>
      {pending.length ? `${pending.length} richieste ricevute, in attesa della decisione dello staff, anche per altre date.` : 'Nessuna richiesta in attesa dello staff.'}</p>}
    <button className="admin-button admin-button-secondary" disabled={busy} onClick={() => setRevision(x => x + 1)}>Aggiorna richieste</button>
    {error && <p role="alert">{error}</p>}
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
      return <li key={request.id}>
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
      <button className="admin-button" disabled={busy || disabled} onClick={() => review(request, 'approved')}>Approva</button>{' '}
      <button className="admin-button admin-button-secondary" disabled={busy || disabled} onClick={() => review(request, 'rejected')}>Rifiuta</button>
    </li>;})}</ul>
  </section>;
}
