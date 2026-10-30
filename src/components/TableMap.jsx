import BookingNoShowAction from './BookingNoShowAction';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { rankedMapAssignments, assignMapTable, tableMapForDate, tableBookingService } from '../utils/tableMap';
import { floorPlanRooms, FLOOR_PLAN_STATUSES } from '../utils/tableFloorPlan';
import { orderedMapChoices, landscapeTablePosition, portraitTablePosition, mobileTableRooms } from '../utils/tableMapPresentation';
import { bookingTypeLabel } from '../utils/bookingType';
import { bookingStatus, bookingStatusLabel } from '../utils/bookingStatus';
import { physicalTableIds, tableConfigurationError } from '../utils/tableConflicts';
import { notificationBookingUrl } from '../utils/adminNotifications';

export default function TableMap({ appointments, date, disabled = false, onSaved, assignmentBooking, onCancel, onSaving, onOpenAssignment, onCreateBooking, renderBookingDetail, now = Date.now(), onNoShow }) {
  const [selected, setSelected] = useState(null);
  const [phoneLayout, setPhoneLayout] = useState(typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(max-width: 700px)').matches));
  const [activeRoom, setActiveRoom] = useState('Sala Principale');
  const [activeMode, setActiveMode] = useState('cena');
  const [selectedPhysicalIds, setSelectedPhysicalIds] = useState([]);
  const [assignment, setAssignment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const pending = useRef(false);
  const detailRef = useRef(null);
  const headingRef = useRef(null);
  // The room state always includes the whole day and both booking types.
  // Existing assignment helpers alone decide which combinations can be saved.
  const dayTableMap = tableMapForDate(appointments, date);
  const assignmentMap = assignmentBooking ? dayTableMap.map(table => ({ ...table, bookings: table.bookings.filter(linked => String(linked.id) !== String(assignmentBooking.id)) })) : dayTableMap;
  const rooms = floorPlanRooms(assignmentMap);
  const modeBookings = dayTableMap.map(table => {
    const bookings = activeMode === 'live' ? table.bookings
      : table.bookings.filter(linked => linked.booking_type === (activeMode === 'cena' ? 'normale' : 'dopocena'));
    const status = bookings.some(linked => bookingStatus(linked.status) !== 'confirmed') ? 'occupied' : bookings.length ? 'reserved' : 'free';
    return { ...table, bookings, status };
  });
  const displayRooms = floorPlanRooms(modeBookings);
  const mapRooms = assignmentBooking ? rooms : displayRooms;
  const booking = assignmentBooking;
  const suggestions = rankedMapAssignments(booking, appointments).filter(([group]) =>
    !tableConfigurationError({ ...booking, tables: group }, appointments));
  const orderedChoices = orderedMapChoices(suggestions, booking?.party_size, booking?.tables?.trim());
  const recommendedGroup = orderedChoices[0]?.[0] || '';
  const presentedRooms = mapRooms;
  const visibleUnits = assignmentBooking ? presentedRooms.flatMap(room => room.units)
    : presentedRooms.find(room => room.name === activeRoom)?.units || [];
  const phoneRooms = phoneLayout && !assignmentBooking ? mobileTableRooms(displayRooms, modeBookings) : [];
  const phoneUnits = phoneRooms.flatMap(room => room.units);
  const countUnits = phoneLayout && !assignmentBooking ? phoneUnits : visibleUnits;
  const counts = Object.fromEntries(Object.keys(FLOOR_PLAN_STATUSES).map(status => [status, countUnits.filter(unit => unit.status === status).length]));
  const table = assignmentBooking ? visibleUnits.find(item => item.physicalIds.includes(selected))
    : phoneLayout ? phoneUnits.find(item => item.physicalIds.includes(selected))
      : visibleUnits.find(item => item.physicalIds.includes(selected));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(max-width: 700px)');
    const update = () => setPhoneLayout(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
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
  function toggleAssignmentUnit(physicalIds) {
    if (pending.current || saving || disabled || !assignmentBooking || !booking) return;
    const tapped = [...physicalIds].sort((left, right) => Number(left) - Number(right));
    const isPossible = ids => suggestions.some(([group]) => {
      const groupIds = physicalTableIds(group);
      return ids.every(id => groupIds.includes(id));
    });
    if (!isPossible(tapped)) {
      setError('Questi tavoli non formano una combinazione disponibile.');
      return;
    }
    const same = tapped.length === selectedPhysicalIds.length
      && tapped.every(id => selectedPhysicalIds.includes(id));
    const overlaps = tapped.some(id => selectedPhysicalIds.includes(id));
    const combined = [...new Set([...selectedPhysicalIds, ...tapped])]
      .sort((left, right) => Number(left) - Number(right));
    // A new valid alternative replaces the previous choice. Adjacent touches
    // may still compose an available physical group such as 22+23.
    const next = same ? [] : overlaps && tapped.length === 1
      ? selectedPhysicalIds.filter(id => id !== tapped[0])
      : !overlaps && selectedPhysicalIds.length && isPossible(combined)
        ? combined : tapped;
    const exactGroup = suggestions.find(([group]) => {
      const groupIds = physicalTableIds(group).sort((left, right) => Number(left) - Number(right));
      return groupIds.length === next.length && groupIds.every((id, index) => id === next[index]);
    })?.[0] || '';
    setSelectedPhysicalIds(next);
    setSelected(next[0] || null);
    setAssignment(exactGroup);
    setError('');
    setFeedback('');
  }
  function selectAssignmentGroup(group) {
    if (pending.current || saving || disabled || !suggestions.some(([choice]) => choice === group)) return;
    const physicalIds = physicalTableIds(group).sort((left, right) => Number(left) - Number(right));
    setSelectedPhysicalIds(physicalIds);
    setSelected(physicalIds[0]);
    setAssignment(group);
    setError('');
    setFeedback('');
  }
  async function save(event) {
    event.preventDefault();
    if (pending.current || saving || disabled) return;
    const assignedPhysicalIds = physicalTableIds(assignment);
    const selectedMatchesAssignment = assignment && assignedPhysicalIds.length === selectedPhysicalIds.length
      && assignedPhysicalIds.every(id => selectedPhysicalIds.includes(id));
    if (assignmentBooking && (!booking || !selectedMatchesAssignment
      || !rankedMapAssignments(booking, appointments).some(([group]) => group === assignment)
      || tableConfigurationError({ ...booking, tables: assignment }, appointments))) {
      setError('Assegnazione non disponibile: seleziona una combinazione valida.');
      return;
    }
    pending.current = true;
    setSaving(true); onSaving?.(true); setError(''); setFeedback('');
    try {
      const result = await assignMapTable(supabase, booking, assignment, appointments, selected);
      onSaved?.(result);
      setFeedback(assignmentBooking ? `Assegnazione salvata per ${result.booking.name}.` : `Assegnazione salvata per la prenotazione #${result.booking.id}.`);
      setAssignment('');
      setSelectedPhysicalIds([]);
    } catch (failure) { setError(failure.message || 'Errore durante il salvataggio dell’assegnazione.'); }
    finally { pending.current = false; setSaving(false); onSaving?.(false); }
  }
  function bookingPanel(item) {
    return <div id="table-map-detail" className="table-map-detail floor-plan-selected-detail" ref={detailRef} tabIndex={-1}>
      <header className="floor-plan-detail-header">
        <h3>Tavolo {item.group} · {FLOOR_PLAN_STATUSES[item.status]}</h3>
        <button type="button" className="admin-button admin-button-secondary floor-plan-detail-close" disabled={saving || disabled}
          onClick={() => setSelected(null)} aria-label={`Chiudi dettaglio tavolo ${item.group}`}>Chiudi</button>
      </header>
      {item.bookings.length ? <div className="floor-plan-detail-bookings">{item.bookings.map(linked =>
        <article key={linked.id} className={`floor-plan-linked-booking service-${linked.booking_type || 'unknown'}`}>
          <h4>{linked.name} · {linked.booking_time?.slice(0, 5)} · {linked.party_size} persone</h4>
          {renderBookingDetail ? renderBookingDetail(linked) : <div className="floor-plan-detail-fallback">
            <a href={notificationBookingUrl({ booking_id: linked.id, booking_date: linked.booking_date }) || '#'}>
              Prenotazione #{linked.id} · {linked.name} · {linked.booking_time?.slice(0, 5)} · {linked.party_size} persone
            </a>{' · '}{bookingStatusLabel(linked.status)} · {bookingTypeLabel(linked.booking_type)} · Tavoli {linked.tables}
            {onOpenAssignment && ['confirmed', 'arrived'].includes(bookingStatus(linked.status)) && <button type="button" className="admin-button admin-button-secondary floor-plan-change"
              disabled={saving || disabled} onClick={() => { if (!pending.current && !disabled) onOpenAssignment(linked); }}>Cambia tavolo<span className="admin-sr-only"> di {linked.name}</span></button>}
            <BookingNoShowAction booking={linked} now={now} disabled={saving || disabled} onNoShow={onNoShow} />
          </div>}
        </article>)}</div> : <><p>Nessuna prenotazione collegata per questa giornata.</p>
          {onCreateBooking && <button type="button" className="admin-button admin-button-secondary" disabled={saving || disabled}
            onClick={onCreateBooking}>Nuova prenotazione</button>}</>}
    </div>;
  }
  return <section className={`table-map table-floor-plan${assignmentBooking ? ' table-map-assignment' : ''} is-wide-map`} aria-labelledby="table-map-title">
    <div className="floor-plan-panel-head">
      <div className="table-map-heading">
        <div><h2 className={assignmentBooking ? 'admin-sr-only' : ''} id="table-map-title" ref={headingRef} tabIndex={-1}>{assignmentBooking ? "Assegna tavolo" : "Mappa tavoli"}</h2></div>
        {!assignmentBooking && <p className="table-map-counts" aria-live="polite"><strong>{counts.free}</strong> {counts.free === 1 ? 'tavolo libero' : 'tavoli liberi'} · <strong>{counts.reserved}</strong> in arrivo · <strong>{counts.occupied}</strong> occupati</p>}
      </div>
      {!assignmentBooking && <ul className="floor-plan-legend" aria-label="Stati della sala">{Object.entries(FLOOR_PLAN_STATUSES).map(([status, label]) =>
        <li key={status} className={`is-${status}`}><span aria-hidden="true" />{label}</li>)}</ul>}
    </div>
    {assignmentBooking && <p className="assignment-selected-booking"><strong>{assignmentBooking.name}</strong> · {assignmentBooking.booking_time?.slice(0,5)} · {assignmentBooking.party_size} persone · {bookingTypeLabel(assignmentBooking.booking_type)} · {assignmentBooking.booking_date}
      {assignmentBooking.tables?.trim() && <span> · Tavolo attuale: {assignmentBooking.tables}</span>}</p>}
    {assignmentBooking && <button type="button" className="admin-button admin-button-secondary" disabled={saving} onClick={() => { if (!pending.current) onCancel?.(); }}>ANNULLA</button>}
    {!assignmentBooking && <div className="floor-plan-controls">
      {!phoneLayout && <div className="floor-plan-control-group">
        <span className="floor-plan-control-label">Sala:</span>
        <div className="floor-plan-room-tabs" role="tablist" aria-label="Sale">
          {['Sala Principale', 'Sala Nami'].map(room => <button key={room} id={`room-tab-${room === 'Sala Nami' ? 'nami' : 'principale'}`} type="button" role="tab" aria-controls={`room-panel-${room === 'Sala Nami' ? 'nami' : 'principale'}`} aria-selected={activeRoom === room} onClick={() => { setSelected(null); setActiveRoom(room); }}>{room.replace('Sala ', '')}</button>)}
        </div>
      </div>}
      <div className="floor-plan-control-group">
        <span className="floor-plan-control-label">Servizio:</span>
        <div className="floor-plan-shifts" role="group" aria-label="Servizio">
          {[['cena', 'CENA'], ['dopocena', 'DOPOCENA'], ['live', 'LIVE']].map(([mode, label]) => <button key={mode} type="button" aria-pressed={activeMode === mode} onClick={() => { setSelected(null); setActiveMode(mode); }}>{label}</button>)}
        </div>
      </div>
    </div>}
    {assignmentBooking && <div className="table-map-choices" aria-label="Soluzioni disponibili">
      <p>{recommendedGroup ? <>Soluzione consigliata: <strong>Tavolo {recommendedGroup}</strong>. Puoi scegliere qualsiasi alternativa disponibile.</>
        : 'Nessuna soluzione disponibile.'}</p>
      {orderedChoices.length > 0 && <div className="table-map-choice-list">{orderedChoices.map(([group, capacity], index) =>
        <button key={group} type="button" data-choice={group} className={`table-map-choice${index === 0 ? ' is-recommended' : ''}`}
          aria-pressed={assignment === group} disabled={saving || disabled} onClick={() => selectAssignmentGroup(group)}>
          {index === 0 && <strong>Consigliato · </strong>}Tavolo {group} · {capacity} posti{group === booking?.tables?.trim() ? ' · attuale' : ''}
        </button>)}</div>}
    </div>}
    {phoneLayout ? <div className="table-map-phone">
      {(assignmentBooking ? presentedRooms : phoneRooms).map(room => <section key={room.name}
        id={`room-panel-${room.name === 'Sala Nami' ? 'nami' : 'principale'}`}
        className="table-map-phone-room" aria-label={room.name}>
        <h3>{room.name}</h3>
        <ul className="table-map-phone-list">
          {room.units.map(item => {
            const physicalCount = item.physicalIds.length;
            if (assignmentBooking) {
              const matchingSuggestions = suggestions.filter(([group]) =>
                item.physicalIds.every(id => physicalTableIds(group).includes(id))
              );
              const canChoose = matchingSuggestions.length > 0;
              const selectedCount = item.physicalIds.filter(id => selectedPhysicalIds.includes(id)).length;
              const isSelected = selectedCount === item.physicalIds.length;
              const isPartiallySelected = selectedCount > 0 && !isSelected;
              const isRecommended = item.group === recommendedGroup;
              return <li key={item.group}>
                <button type="button" data-phone-unit={item.group}
                  className={`table-map-phone-card is-${item.status}${canChoose ? ' is-available' : ''}${isRecommended ? ' is-recommended' : ''}${isSelected ? ' is-selected' : ''}${isPartiallySelected ? ' is-partially-selected' : ''}${!canChoose && !selectedCount ? ' is-unavailable' : ''}`}
                  aria-pressed={isSelected}
                  aria-label={`Tavolo ${item.group}: ${FLOOR_PLAN_STATUSES[item.status]}${isSelected ? ', selezionato' : isPartiallySelected ? ', parzialmente selezionato' : canChoose ? ', disponibile' : ', non disponibile'}${item.bookings.length ? `, ${item.bookings.map(linked => `${linked.booking_time?.slice(0, 5) || ''} ${linked.name}, ${linked.party_size} persone`).join('; ')}` : ''}`}
                  disabled={saving || disabled || (!canChoose && !selectedCount)}
                  onClick={() => toggleAssignmentUnit(item.physicalIds)}>
                  <span className="table-map-phone-head"><strong>Tavolo {item.group}</strong>
                    <span className={`makai-badge is-${item.status === 'free' ? 'ok' : item.status === 'reserved' ? 'wait' : 'no'}`}>{FLOOR_PLAN_STATUSES[item.status]}</span></span>
                  <span className="table-map-phone-meta">{item.capacity} posti{item.bookings.length ? ` · ${item.bookings.map(linked => `${linked.booking_time?.slice(0, 5) || ''} ${linked.name}`).join(' · ')}` : ''}</span>
                  {isRecommended && <span className="table-map-phone-hint">Consigliato</span>}
                </button>
              </li>;
            }
            const expanded = item.physicalIds.includes(selected);
            return <li key={item.group}>
              <button type="button" data-phone-unit={item.group} aria-expanded={expanded} aria-controls="table-map-detail"
                className={`table-map-phone-card is-${item.status}${expanded ? ' is-expanded' : ''}`}
                onClick={() => {
                  if (pending.current || saving || disabled) return;
                  setSelected(previous => previous === item.physicalIds[0] ? null : item.physicalIds[0]);
                  setAssignment(''); setError(''); setFeedback('');
                }}>
                <span className="table-map-phone-head"><strong>Tavolo {item.group}</strong>
                  <span className={`makai-badge is-${item.status === 'free' ? 'ok' : item.status === 'reserved' ? 'wait' : 'no'}`}>{FLOOR_PLAN_STATUSES[item.status]}</span></span>
                <span className="table-map-phone-meta">{item.capacity} posti{physicalCount > 1 ? ` · ${physicalCount} tavoli uniti` : ''}</span>
                {item.bookings.length > 0 && <span className="table-map-phone-guests">
                  {item.bookings.map(linked => `${linked.booking_time?.slice(0, 5) || ''} ${linked.name} · ${linked.party_size} pers.`).join(' · ')}
                </span>}
                <span className="table-map-phone-hint">{item.bookings.length ? 'Tocca per le azioni' : 'Tocca per aprire il tavolo'}</span>
              </button>
            </li>;
          })}
        </ul>
      </section>)}
      {!assignmentBooking && table && bookingPanel(table)}
    </div> : <div className="table-map-rooms">
      {presentedRooms.filter(room => assignmentBooking || room.name === activeRoom).map(room => <section key={room.name} id={`room-panel-${room.name === 'Sala Nami' ? 'nami' : 'principale'}`} aria-labelledby={!assignmentBooking ? `room-tab-${room.name === 'Sala Nami' ? 'nami' : 'principale'}` : undefined} className={`table-map-room${table ? ' has-detail' : ''}`} aria-label={room.name} role={!assignmentBooking ? 'tabpanel' : 'region'} tabIndex={0}>
        <h3>{room.name}</h3><ul className={`floor-plan-canvas${room.name === 'Sala Nami' ? ' floor-plan-nami' : ''}`} aria-label={`Piantina ${room.name}`}>{room.units.flatMap(item => {
          const physicalCount = item.physicalIds.length;
          const matchingSuggestions = suggestions.filter(([group]) =>
            item.physicalIds.every(id => physicalTableIds(group).includes(id))
          );
          const serviceBookings = assignmentBooking
            ? dayTableMap.filter(table => item.physicalIds.includes(table.id)).flatMap(table => table.bookings)
            : item.bookings;
          const canChoose = matchingSuggestions.length > 0;
          const selectedCount = item.physicalIds.filter(id => selectedPhysicalIds.includes(id)).length;
          const isSelected = selectedCount === item.physicalIds.length;
          const isPartiallySelected = selectedCount > 0 && !isSelected;
          const isRecommended = assignmentBooking && item.group === recommendedGroup;
          const expanded = !assignmentBooking && item.physicalIds.includes(selected);
          const landscape = landscapeTablePosition(item, room.name);
          const portrait = portraitTablePosition(item, room.name);
          const style = { '--unit-x': `${item.x}%`, '--unit-y': `${item.y}%`, '--unit-width': `${item.width}%`, '--unit-height': `${item.height}%`, '--landscape-x': `${landscape.x}%`, '--landscape-y': `${landscape.y}%`, '--portrait-x': `${portrait.x}%`, '--portrait-y': `${portrait.y}%` };
          return [
          <li key={item.group} data-group={item.group} className={`floor-plan-unit${expanded ? ' is-expanded' : ''}${item.bookings.length && physicalCount > 1 ? ' is-assigned-group' : ''}`} style={style}>
          <button type="button" data-unit={item.group} className={`table-map-item service-${tableBookingService(serviceBookings)} is-${item.status}${canChoose ? ' is-available' : ''}${isRecommended ? ' is-recommended' : ''}${isSelected ? ' is-selected' : ''}${isPartiallySelected ? ' is-partially-selected' : ''}${assignmentBooking && !canChoose && !selectedCount ? ' is-unavailable' : ''}`} aria-pressed={isSelected} aria-expanded={!assignmentBooking ? expanded : undefined} aria-controls={!assignmentBooking ? 'table-map-detail' : undefined} disabled={saving || disabled || Boolean(assignmentBooking && !canChoose && !selectedCount)}
            data-physical-count={physicalCount}
            aria-label={`Tavolo ${item.group}: ${FLOOR_PLAN_STATUSES[item.status]}${isSelected ? ', selezionato' : isPartiallySelected ? ', parzialmente selezionato' : canChoose ? ', disponibile' : ', non disponibile'}${item.bookings.length ? `, ${item.bookings.map(linked => `${linked.booking_time?.slice(0,5) || ''} ${linked.name}, ${linked.party_size} persone`).join('; ')}` : ''}`}
            onClick={() => {
              if (pending.current || saving || disabled) return;
              if (assignmentBooking) {
                toggleAssignmentUnit(item.physicalIds);
              } else {
                setSelected(previous => previous === item.physicalIds[0] ? null : item.physicalIds[0]); setAssignment(''); setError(''); setFeedback('');
              }
            }}>
            <span className="floor-plan-unit-head"><span className="table-map-number"><strong>{item.group}</strong></span><strong className="floor-plan-list-group">Tavolo {item.group}</strong>{item.bookings.length > 0 && <small className="floor-plan-status-label">{item.status === 'reserved' ? (physicalCount === 1 ? 'ARR.' : 'IN ARRIVO') : (physicalCount === 1 ? 'OCC.' : 'OCCUPATO')}</small>}</span>
            <span className="floor-plan-list-capacity">{item.capacity} posti</span>
            <span className="floor-plan-list-status">{FLOOR_PLAN_STATUSES[item.status]}</span>
            {isRecommended && <span className="table-map-recommended-label">Consigliato</span>}
            {item.bookings.length > 0 && <span className="floor-plan-list-guests">{item.bookings.map(linked => `${linked.booking_time?.slice(0, 5) || ''} ${linked.name}`).join(' · ')}</span>}
            {item.bookings.length > 0 ? <><small className="floor-plan-booking-name">{item.bookings[0].name}</small><small className="floor-plan-party-size">{item.bookings[0].party_size} pers.</small></>
              : <span className="table-map-state">LIBERO</span>}
          </button>
        </li>];})}
        </ul>
        {!assignmentBooking && table && bookingPanel(table)}
      </section>)}
    </div>}
    {assignmentBooking && <form onSubmit={save} className="table-map-assignment-bar" aria-label="Conferma assegnazione tavoli">
      <span className="table-map-assignment-selection" aria-live="polite">
        {assignment || (selectedPhysicalIds.length ? selectedPhysicalIds.join(' + ') : 'Seleziona i tavoli')}
      </span>
      <span className="table-map-assignment-party">{booking?.party_size} pers.</span>
      <button type="submit" className="admin-button" disabled={saving || disabled || !assignment || !suggestions.some(([group]) => group === assignment)}>
        {saving ? 'SALVO…' : 'CONFERMA'}
      </button>
    </form>}
    {assignmentBooking && saving && <p role="status" aria-live="polite">Salvataggio assegnazione…</p>}
    {assignmentBooking && !saving && !error && !suggestions.length && <p className="table-map-assignment-feedback" role="status">Nessuna unità libera.</p>}
    {assignmentBooking && error && <p className="table-map-assignment-feedback" role="alert">{error}</p>}
  </section>;
}
