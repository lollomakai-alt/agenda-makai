import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { availableMapAssignments, rankedMapAssignments, assignMapTable, tableGroupsForPhysicalTable, tableMapForDate, tableRooms, TABLE_MAP_STATUSES, unverifiedTableBookings } from '../utils/tableMap';
import { bookingType, bookingTypeLabel } from '../utils/bookingType';
import { bookingStatus, bookingStatusLabel } from '../utils/bookingStatus';
import { tableCapacityWarning, physicalTableIds } from '../utils/tableConflicts';
import { notificationBookingUrl } from '../utils/adminNotifications';

export default function TableMap({ appointments, date, disabled = false, onSaved, assignmentBooking, onCancel }) {
  const [type, setType] = useState(assignmentBooking ? bookingType(assignmentBooking.booking_type) : 'all');
  const [selected, setSelected] = useState(null);
  const [bookingId, setBookingId] = useState(assignmentBooking ? String(assignmentBooking.id) : '');
  const [assignment, setAssignment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const pending = useRef(false);
  const map = tableMapForDate(appointments, date, type, assignmentBooking);
  const unverified = unverifiedTableBookings(appointments, date, type);
  const counts = Object.fromEntries(Object.keys(TABLE_MAP_STATUSES).map(status => [status, map.filter(table => table.status === status).length]));
  const table = map.find(item => item.id === selected);
  const candidates = appointments.filter(booking => booking.booking_date === date && ['confirmed','arrived'].includes(bookingStatus(booking.status)) && (type === 'all' || bookingType(booking.booking_type) === type));
  const booking = candidates.find(item => String(item.id) === bookingId);
  const available = availableMapAssignments(booking, appointments, selected, { manualTables: !assignmentBooking });
  const suggestions = rankedMapAssignments(booking, appointments);
  const recommended = suggestions[0]?.[0];
  const recommendedTables = physicalTableIds(recommended || '');
  const availableTables = new Set(suggestions.flatMap(([group]) => physicalTableIds(group)));
  function chooseGroup(group) { if (saving || disabled || (assignmentBooking && !suggestions.some(([valid]) => valid === group))) return; setSelected(physicalTableIds(group)[0]); setAssignment(group); setError(''); setFeedback(''); }
  function reset() { if (!assignmentBooking) setBookingId(''); setAssignment(''); setError(''); setFeedback(''); }
  async function save(event) {
    event.preventDefault();
    if (pending.current || saving || disabled) return;
    if (assignmentBooking && !rankedMapAssignments(booking, appointments).some(([group]) => group === assignment)) {
      setError('Assegnazione non disponibile: seleziona una combinazione valida.');
      return;
    }
    pending.current = true;
    setSaving(true); setError(''); setFeedback('');
    try {
      const result = await assignMapTable(supabase, booking, assignment, appointments, selected);
      onSaved?.(result);
      setFeedback(`Assegnazione salvata per la prenotazione #${result.booking.id}.`);
      setAssignment('');
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setSaving(false); }
  }
  return <section className={`table-map${assignmentBooking ? " table-map-assignment" : ""}`} aria-labelledby="table-map-title">
    <div className="table-map-heading">
      <div><h2 id="table-map-title">{assignmentBooking ? "Assegna tavolo" : "Mappa tavoli"}</h2></div>
      <p className="table-map-counts" aria-live="polite"><strong>{counts.free}</strong> liberi · <strong>{counts.reserved}</strong> prenotati · <strong>{counts.occupied}</strong> occupati</p>
    </div>
    {assignmentBooking && <p className="assignment-selected-booking"><strong>{assignmentBooking.name}</strong> · {assignmentBooking.booking_time?.slice(0,5)} · {assignmentBooking.party_size} persone · {bookingTypeLabel(assignmentBooking.booking_type)} · {assignmentBooking.booking_date}
      {assignmentBooking.tables?.trim() && <span> · Tavolo attuale: {assignmentBooking.tables}</span>}</p>}
    {assignmentBooking && <button type="button" className="admin-button admin-button-secondary" disabled={saving} onClick={() => { if (!pending.current) onCancel?.(); }}>Annulla</button>}
    {!assignmentBooking && <label className="table-map-filter">Tipo prenotazione<select value={type} disabled={saving} onChange={event => { setType(event.target.value); reset(); }}>
      <option value="all">Tutti</option><option value="normale">Normale</option><option value="dopocena">Dopocena</option>
    </select></label>}
    {unverified.length > 0 && <p role="alert">{unverified.length} prenotazioni hanno assegnazioni mancanti o da verificare. I tavoli liberi non garantiscono disponibilità finché queste voci non sono corrette.</p>}
    <div className="table-map-rooms">
      {tableRooms(map).map(room => <section key={room.name} className="table-map-room" aria-label={room.name}>
        <h3>{room.name}</h3><ul>{room.tables.map(item => <li key={item.id}>
          <button type="button" className={`table-map-item is-${item.status}${availableTables.has(item.id) ? ' is-available' : ''}${recommendedTables.includes(item.id) ? ' is-recommended' : ''}${assignmentBooking && !availableTables.has(item.id) ? ' is-unavailable' : ''}`} aria-pressed={assignmentBooking ? physicalTableIds(assignment).includes(item.id) : selected === item.id} aria-controls="table-map-detail" disabled={saving || disabled || Boolean(assignmentBooking && !availableTables.has(item.id))}
            aria-label={`Tavolo ${item.id}: ${TABLE_MAP_STATUSES[item.status]}${recommendedTables.includes(item.id) ? ', combinazione consigliata' : availableTables.has(item.id) ? ', combinazione disponibile' : ''}`}
            onClick={() => {
              if (saving || disabled) return;
              if (assignmentBooking) {
                const option = suggestions.find(([group]) => physicalTableIds(group).includes(item.id));
                if (option) chooseGroup(option[0]);
              } else { setSelected(item.id); setAssignment(''); setError(''); setFeedback(''); }
            }}>
            <span className="table-map-number"><span>Tavolo</span><strong>{item.id}</strong></span><span className="table-map-state">{TABLE_MAP_STATUSES[item.status]}</span>
            {recommendedTables.includes(item.id) ? <small className="table-map-recommended-label">Consigliato</small> : availableTables.has(item.id) ? <small className="table-map-available-label">Disponibile</small> : null}
            {item.bookingTypes.length > 0 && <small>{item.bookingTypes.map(bookingTypeLabel).join(' + ')}</small>}
          </button>
        </li>)}</ul>
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
    {!assignmentBooking && table && <div id="table-map-detail" className="table-map-detail">
      <h3>Tavolo {table.id} · {TABLE_MAP_STATUSES[table.status]}</h3>
      <p>Combinazioni configurate: {tableGroupsForPhysicalTable(table.id).map(([group, capacity]) => `${group} (${capacity} posti)`).join(' · ')}.</p>
      {table.bookings.length ? <ul>{table.bookings.map((linked, index) => <li key={`${linked.id}-${index}`}>
        <a href={notificationBookingUrl({ booking_id: linked.id, booking_date: linked.booking_date }) || '#'}>
          Prenotazione #{linked.id} · {linked.name} · {linked.booking_time?.slice(0,5)} · {linked.party_size} persone
        </a>{' · '}{bookingStatusLabel(linked.status)} · {bookingTypeLabel(linked.booking_type)} · Tavoli {linked.tables}
      </li>)}</ul> : <p>Nessuna prenotazione collegata nel tipo selezionato.</p>}
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
    {!assignmentBooking && <p className="table-map-note">Confermata: prenotato. Arrivato/completata: occupato. Cancellata e no-show: liberi. Normale e dopocena hanno assegnazioni separate.</p>}
  </section>;
}
