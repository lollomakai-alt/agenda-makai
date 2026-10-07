import BookingNoShowAction from './BookingNoShowAction';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { availableMapAssignments, rankedMapAssignments, assignMapTable, tableGroupsForPhysicalTable, tableMapForDate, unverifiedTableBookings } from '../utils/tableMap';
import { floorPlanRooms, FLOOR_PLAN_STATUSES } from '../utils/tableFloorPlan';
import { bookingType, bookingTypeLabel } from '../utils/bookingType';
import { bookingStatus, bookingStatusLabel } from '../utils/bookingStatus';
import { tableCapacityWarning, physicalTableIds } from '../utils/tableConflicts';
import { notificationBookingUrl } from '../utils/adminNotifications';

export default function TableMap({ appointments, date, disabled = false, onSaved, assignmentBooking, onCancel, onSaving, onOpenAssignment, now = Date.now(), onNoShow }) {
  const [type, setType] = useState(assignmentBooking ? bookingType(assignmentBooking.booking_type) : 'all');
  const [selected, setSelected] = useState(null);
  const [bookingId, setBookingId] = useState(assignmentBooking ? String(assignmentBooking.id) : '');
  const [assignment, setAssignment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const pending = useRef(false);
  const detailRef = useRef(null);
  const headingRef = useRef(null);
  // The room state always includes the whole day and both booking types.
  // Existing assignment helpers alone decide which combinations can be saved.
  const rooms = floorPlanRooms(tableMapForDate(appointments, date));
  const units = rooms.flatMap(room => room.units);
  const unverified = unverifiedTableBookings(appointments, date);
  const counts = Object.fromEntries(Object.keys(FLOOR_PLAN_STATUSES).map(status => [status, units.filter(unit => unit.status === status).length]));
  const table = units.find(item => item.physicalIds.includes(selected));
  const candidates = appointments.filter(booking => booking.booking_date === date && ['confirmed','arrived'].includes(bookingStatus(booking.status)) && (type === 'all' || bookingType(booking.booking_type) === type));
  const booking = candidates.find(item => String(item.id) === bookingId);
  const available = availableMapAssignments(booking, appointments, selected, { manualTables: true });
  const suggestions = rankedMapAssignments(booking, appointments);
  const recommended = suggestions[0]?.[0];
  const recommendedTables = physicalTableIds(recommended || '');
  const availableTables = new Set(suggestions.flatMap(([group]) => physicalTableIds(group)));
  const awaitingAssignment = candidates.filter(candidate => !String(candidate.tables || '').trim())
    .sort((a, b) => String(a.booking_time || '').localeCompare(String(b.booking_time || '')));
  useEffect(() => {
    if (!assignmentBooking && selected !== null) {
      detailRef.current?.scrollIntoView({ block: 'nearest' });
      detailRef.current?.focus({ preventScroll: true });
    }
  }, [selected, assignmentBooking]);
  useEffect(() => {
    if (assignmentBooking) {
      headingRef.current?.scrollIntoView({ block: 'start' });
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [assignmentBooking?.id]);
  function chooseGroup(group) { if (pending.current || saving || disabled || (assignmentBooking && !suggestions.some(([valid]) => valid === group))) return; setSelected(physicalTableIds(group)[0]); setAssignment(group); setError(''); setFeedback(''); }
  function reset() { if (!assignmentBooking) setBookingId(''); setAssignment(''); setError(''); setFeedback(''); }
  async function save(event) {
    event.preventDefault();
    if (pending.current || saving || disabled) return;
    if (assignmentBooking && !rankedMapAssignments(booking, appointments).some(([group]) => group === assignment)) {
      setError('Assegnazione non disponibile: seleziona una combinazione valida.');
      return;
    }
    pending.current = true;
    setSaving(true); onSaving?.(true); setError(''); setFeedback('');
    try {
      const result = await assignMapTable(supabase, booking, assignment, appointments, selected);
      onSaved?.(result);
      setFeedback(`Assegnazione salvata per la prenotazione #${result.booking.id}.`);
      setAssignment('');
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setSaving(false); onSaving?.(false); }
  }
  return <section className={`table-map table-floor-plan${assignmentBooking ? " table-map-assignment" : ""}`} aria-labelledby="table-map-title">
    <div className="table-map-heading">
      <div><h2 id="table-map-title" ref={headingRef} tabIndex={-1}>{assignmentBooking ? "Assegna tavolo" : "Mappa tavoli"}</h2></div>
      <p className="table-map-counts" aria-live="polite"><strong>{counts.free}</strong> unità {counts.free === 1 ? 'libera' : 'libere'} · <strong>{counts.reserved}</strong> in arrivo · <strong>{counts.occupied}</strong> {counts.occupied === 1 ? 'occupata' : 'occupate'}</p>
    </div>
    {assignmentBooking && <p className="assignment-selected-booking"><strong>{assignmentBooking.name}</strong> · {assignmentBooking.booking_time?.slice(0,5)} · {assignmentBooking.party_size} persone · {bookingTypeLabel(assignmentBooking.booking_type)} · {assignmentBooking.booking_date}
      {assignmentBooking.tables?.trim() && <span> · Tavolo attuale: {assignmentBooking.tables}</span>}</p>}
    {assignmentBooking && <button type="button" className="admin-button admin-button-secondary" disabled={saving} onClick={() => { if (!pending.current) onCancel?.(); }}>Annulla</button>}
    {!assignmentBooking && <label className="table-map-filter">Prenotazioni<select value={type} disabled={saving || disabled} onChange={event => { setType(event.target.value); reset(); }}>
      <option value="all">Tutti</option><option value="normale">Normale</option><option value="dopocena">Dopocena</option>
    </select></label>}
    <ul className="floor-plan-legend" aria-label="Stati della sala">{Object.entries(FLOOR_PLAN_STATUSES).map(([status, label]) =>
      <li key={status} className={`is-${status}`}><span aria-hidden="true" />{label}</li>)}</ul>
    {!assignmentBooking && awaitingAssignment.length > 0 && <section className="floor-plan-pending" aria-label="Prenotazioni da assegnare">
      <h3>Da assegnare <span>{awaitingAssignment.length}</span></h3>
      <ul>{awaitingAssignment.map(candidate => <li key={candidate.id}>
        {onOpenAssignment ? <button type="button" className="floor-plan-booking" disabled={saving || disabled}
          aria-label={`Assegna tavolo a ${candidate.name}`} onClick={() => { if (!pending.current && !disabled) onOpenAssignment(candidate); }}>
          <span><strong>{candidate.booking_time?.slice(0,5)} · {candidate.name}</strong><small>{candidate.party_size} persone · {bookingTypeLabel(candidate.booking_type)}</small></span>
          <span className="floor-plan-booking-action">Assegna →</span>
        </button> : <a className="floor-plan-booking" href={notificationBookingUrl({ booking_id: candidate.id, booking_date: candidate.booking_date }) || '#'}>{candidate.booking_time?.slice(0,5)} · {candidate.name} · {candidate.party_size} persone</a>}
      </li>)}</ul>
    </section>}
    {unverified.length > 0 && <p role="alert">{unverified.length} prenotazioni hanno assegnazioni mancanti o da verificare. I tavoli liberi non garantiscono disponibilità finché queste voci non sono corrette.</p>}
    <div className="table-map-rooms">
      {rooms.map(room => <section key={room.name} className="table-map-room" aria-label={room.name}>
        <h3>{room.name}</h3><ul className={`floor-plan-canvas${room.name === 'Sala Nami' ? ' floor-plan-nami' : ''}`} aria-label={`Piantina ${room.name}`}>{room.units.map(item => {
          const canChoose = item.physicalIds.some(id => availableTables.has(id));
          const isRecommended = item.physicalIds.some(id => recommendedTables.includes(id));
          return <li key={item.group} style={{ '--unit-x': `${item.x}%`, '--unit-y': `${item.y}%`, '--unit-width': `${item.width}%`, '--unit-height': `${item.height}%` }}>
          <button type="button" data-unit={item.group} className={`table-map-item is-${item.status}${canChoose ? ' is-available' : ''}${isRecommended ? ' is-recommended' : ''}${assignmentBooking && !canChoose ? ' is-unavailable' : ''}`} aria-pressed={assignmentBooking ? item.physicalIds.some(id => physicalTableIds(assignment).includes(id)) : item.physicalIds.includes(selected)} aria-controls="table-map-detail" disabled={saving || disabled || Boolean(assignmentBooking && !canChoose)}
            aria-label={`Tavolo ${item.group}: ${FLOOR_PLAN_STATUSES[item.status]}${isRecommended ? ', combinazione consigliata' : canChoose ? ', combinazione disponibile' : ''}${item.bookings.length ? `, ${item.bookings.map(linked => `${linked.booking_time?.slice(0,5) || ''} ${linked.name}`).join('; ')}` : ''}`}
            onClick={() => {
              if (pending.current || saving || disabled) return;
              if (assignmentBooking) {
                const option = suggestions.find(([group]) => item.physicalIds.some(id => physicalTableIds(group).includes(id)));
                if (option) chooseGroup(option[0]);
              } else {
                setSelected(item.physicalIds[0]); setAssignment(''); setError(''); setFeedback('');
                const linkedCandidates = candidates.filter(candidate => item.bookings.some(linked => String(linked.id) === String(candidate.id)));
                setBookingId(linkedCandidates.length === 1 ? String(linkedCandidates[0].id) : '');
              }
            }}>
            <span className="table-map-number"><strong>{item.group}</strong></span><span className="table-map-state">{FLOOR_PLAN_STATUSES[item.status]}</span>
            {isRecommended ? <small className="table-map-recommended-label">Consigliato</small> : null}
            {item.bookings.length > 0 && <small className="floor-plan-arrivals">{[...new Set(item.bookings.map(linked => linked.booking_time?.slice(0,5)).filter(Boolean))].join(' · ')}</small>}
          </button>
        </li>;})}</ul>
      </section>)}
    </div>
    {booking && <div className="table-map-suggestions" aria-label="Combinazioni disponibili">
      <p>{recommended ? <>Combinazione consigliata: <strong>{recommended}</strong> · {suggestions[0][1]} posti.</> : 'Nessuna combinazione disponibile per questa prenotazione.'}</p>
      {recommended && <button type="button" className="table-map-group is-recommended table-map-recommendation"
        disabled={saving || disabled} aria-pressed={assignment === recommended} onClick={() => chooseGroup(recommended)}>
        <strong>{recommended}</strong> · {suggestions[0][1]} posti<span>Seleziona consigliata</span>
      </button>}
      <details className="table-map-alternatives"><summary>Vedi tutte le combinazioni</summary>
      <div className="table-map-group-buttons">{suggestions.map(([group,capacity]) => <button type="button" key={group}
        disabled={saving || disabled} className={`table-map-group${group === recommended ? ' is-recommended' : ''}`}
        aria-pressed={assignment === group} onClick={() => chooseGroup(group)}>
        <strong>{group}</strong> · {capacity} posti{group === recommended && <span>★ Consigliata</span>}
      </button>)}</div>
      </details>
      <small>Seleziona una combinazione e conferma con Salva assegnazione.</small>
    </div>}
    {assignmentBooking && assignment && <form id="table-map-detail" className="table-assignment-confirmation" onSubmit={save}>
      <p><strong>{assignmentBooking.name}</strong> · Tavolo <strong>{assignment}</strong></p>
      <p>{assignmentBooking.tables?.trim() ? `Sostituisce il tavolo ${assignmentBooking.tables}.` : 'Confermi questa assegnazione?'}</p>
      <button type="submit" className="admin-button" disabled={saving || disabled || !suggestions.some(([group]) => group === assignment)}>
        {saving ? 'Salvataggio…' : 'Conferma assegnazione'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>}
    {assignmentBooking && !assignment && error && <p role="alert">{error}</p>}
    {!assignmentBooking && table && <div id="table-map-detail" className="table-map-detail" ref={detailRef} tabIndex={-1}>
      <h3>Tavolo {table.group} · {FLOOR_PLAN_STATUSES[table.status]}</h3>
      <p>Combinazioni configurate: {tableGroupsForPhysicalTable(selected).map(([group, capacity]) => `${group} (${capacity} posti)`).join(' · ')}.</p>
      {table.bookings.length ? <ul>{table.bookings.map((linked, index) => <li key={`${linked.id}-${index}`}>
        <a href={notificationBookingUrl({ booking_id: linked.id, booking_date: linked.booking_date }) || '#'}>
          Prenotazione #{linked.id} · {linked.name} · {linked.booking_time?.slice(0,5)} · {linked.party_size} persone
        </a>{' · '}{bookingStatusLabel(linked.status)} · {bookingTypeLabel(linked.booking_type)} · Tavoli {linked.tables}
        {onOpenAssignment && ['confirmed', 'arrived'].includes(bookingStatus(linked.status)) && <button type="button" className="admin-button admin-button-secondary floor-plan-change"
          disabled={saving || disabled} onClick={() => { if (!pending.current && !disabled) onOpenAssignment(linked); }}>Cambia tavolo<span className="admin-sr-only"> di {linked.name}</span></button>}
        <BookingNoShowAction booking={linked} now={now} disabled={saving || disabled} onNoShow={onNoShow} />
      </li>)}</ul> : <p>Nessuna prenotazione collegata per questa giornata.</p>}
      <form onSubmit={save} className="booking-admin-form">
        <fieldset disabled={saving || disabled}>
          {!assignmentBooking && <label>Prenotazione da assegnare<select value={bookingId} onChange={event => { setBookingId(event.target.value); setAssignment(''); setError(''); setFeedback(''); }}>
            <option value="">Seleziona prenotazione</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>#{candidate.id} · {candidate.name} · {candidate.party_size} persone · {bookingTypeLabel(candidate.booking_type)}</option>)}
          </select></label>}
          <label>Nuova assegnazione<select value={assignment} onChange={event => setAssignment(event.target.value)}>
            <option value="">Seleziona combinazione</option>{available.map(([group,capacity]) => <option key={group} value={group}>{group} · {capacity} posti{group === recommended ? ' · Consigliata' : ''}</option>)}
          </select></label>
          {booking && tableCapacityWarning(assignment, booking.party_size) && <p role="status">{tableCapacityWarning(assignment, booking.party_size)}</p>}
          {booking && <p>Assegnazione attuale: {booking.tables || 'Da assegnare'}. La combinazione scelta sostituisce l’intera assegnazione tavoli.</p>}
          {booking && !available.length && <p>Nessuna nuova assegnazione valida per questo tavolo. Controlla data, configurazione e conflitti.</p>}
          <button className="admin-button" type="submit" disabled={!available.some(([group]) => group === assignment)}>Salva assegnazione</button>
        </fieldset>
        {error && <p role="alert">{error}</p>}{feedback && <p role="status">{feedback}</p>}
      </form>
    </div>}
    <p className="table-map-note">Stato della sala per tutta la giornata. Confermata: in arrivo. Arrivato/completata: occupato. Cancellata e no-show: liberi. Il passare del tempo non libera i tavoli.</p>
  </section>;
}
