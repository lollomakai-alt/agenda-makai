import useMobileLayout from "../hooks/useMobileLayout";
import MobileSection from "../components/MobileSection";
import { adminFetch } from "../lib/adminFetch";
import { useAppointments } from "../hooks/useAppointments";
import { validateBooking } from "../utils/bookingValidation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { dayLabel, isDay, todayInRome } from "../utils/calendar";
import {
  confirmationMessage,
} from "../utils/bookingConfirmation";

import { BOOKING_STATUSES, bookingStatus, bookingStatusLabel, saveBookingStatus } from "../utils/bookingStatus";
import BookingRequests from "../components/BookingRequests";
import BookingCommunications from "../components/BookingCommunications";
import BookingHistory from "../components/BookingHistory";
import BookingEditor from "../components/BookingEditor";
import { bookingDelayNotification } from "../utils/bookingDelay";
import { noShowEligibility } from "../utils/bookingNoShow";
import { bookingCallUrl } from "../utils/bookingCall";
import CustomerCard from "../components/CustomerCard";
import { previousCustomerNoShowCount } from "../utils/customerBookings";
import TableMap from "../components/TableMap";
import { BOOKING_TYPES, bookingType, bookingTypeLabel } from "../utils/bookingType";
import { createAfterDinnerBooking, validateAfterDinnerBooking } from "../utils/afterDinnerBooking";
import { canAcceptBooking, DAILY_COVER_LIMIT } from "../utils/bookingCapacity";
import tables from "../config/tables.json" with { type: "json" };

function consentDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value));
}

export default function BookingsPage() {
  const mobile = useMobileLayout();
  const requested = new URLSearchParams(window.location.search).get("date");
  const date = isDay(requested) ? requested : todayInRome();
  const { appointments, loading, error: appointmentsError, refresh: refreshAppointments, applyUpdate } = useAppointments('all');
  const error = appointmentsError?.message || "";
  const bookings = loading || appointmentsError
    ? null
    : appointments.filter((booking) => booking.booking_date === date);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const [createType, setCreateType] = useState('normale');
  const [consentEditorId, setConsentEditorId] = useState(null);
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [statusSavingId, setStatusSavingId] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editFeedback, setEditFeedback] = useState(null);
  const [requestRevision, setRequestRevision] = useState(0);
  const [assignmentBookingId, setAssignmentBookingId] = useState(() => {
    const id = new URLSearchParams(window.location.search).get('assign');
    return /^[1-9]\d*$/.test(id || '') ? id : null;
  });
  const [showAssigned, setShowAssigned] = useState(() => /^#booking-[1-9]\d*$/.test(window.location.hash));
  const [now, setNow] = useState(Date.now);
  const focusedBooking = useRef(null);

  useEffect(() => {
    let timer;
    const timeout = window.setTimeout(() => {
      setNow(Date.now());
      timer = window.setInterval(() => setNow(Date.now()), 60000);
    }, 60000 - (Date.now() % 60000));
    return () => {
      window.clearTimeout(timeout);
      if (timer) window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (editingId !== null && !appointments.some(booking => booking.id === editingId)) setEditingId(null);
  }, [appointments, editingId]);

  useEffect(() => {
    if (loading) return;
    function focusBooking() {
      if (!/^#booking-[1-9]\d*$/.test(window.location.hash)) return;
      const row = document.getElementById(window.location.hash.slice(1));
      if (!row) { setShowAssigned(true); return; }
      if (focusedBooking.current === row) return;
      focusedBooking.current = row;
      const details = row.querySelector('.booking-card-disclosure');
      if (details) details.open = true;
      row.scrollIntoView({ block: 'center' });
      row.focus({ preventScroll: true });
    }
    focusBooking();
    window.addEventListener('hashchange', focusBooking);
    return () => window.removeEventListener('hashchange', focusBooking);
  }, [loading, date, showAssigned, assignmentBookingId, appointments]);

  const [onlineClosed, setOnlineClosed] = useState(null);
  const [closureSaving, setClosureSaving] = useState(false);
  const [closureError, setClosureError] = useState("");

  useEffect(() => {
    let active = true;
    setOnlineClosed(null);
    setClosureError("");
    supabase.from("online_booking_closures").select("booking_date").eq("booking_date", date)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setClosureError("Non riesco a verificare la chiusura online. Ricarica la pagina.");
        else setOnlineClosed(data.length > 0);
      });
    return () => { active = false; };
  }, [date]);

  async function toggleOnlineBookings() {
    if (closureSaving || onlineClosed === null) return;
    setClosureSaving(true);
    setClosureError("");
    try {
      const { error } = onlineClosed
        ? await supabase.from("online_booking_closures").delete().eq("booking_date", date)
        : await supabase.from("online_booking_closures").insert({ booking_date: date });
      if (error && error.code !== "23505") throw error;
      const { data, error: readError } = await supabase.from("online_booking_closures")
        .select("booking_date").eq("booking_date", date);
      if (readError) throw readError;
      setOnlineClosed(data.length > 0);
    } catch {
      setClosureError("Modifica non confermata. Ricarica la pagina per verificare lo stato e riprova.");
      setOnlineClosed(null);
    } finally {
      setClosureSaving(false);
    }
  }

  async function createBooking(event) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const rawValues = Object.fromEntries(fields);
    const values = {
      name: rawValues.name, phone: rawValues.phone, email: rawValues.email,
      time: rawValues.time, party_size: rawValues.party_size,
      notes: rawValues.notes, table: rawValues.table, date,
    };
    const validation = createType === 'dopocena' ? validateAfterDinnerBooking(values) : validateBooking(values);
    setFieldErrors(validation.errors);
    setCreateError("");
    setCreateSuccess("");
    if (Object.keys(validation.errors).length) {
      form.elements.namedItem(Object.keys(validation.errors)[0])?.focus();
      return;
    }
    if (!bookings || !canAcceptBooking(appointments, date, validation.data.party_size)) {
      setCreateError(bookings
        ? `Limite giornaliero di ${DAILY_COVER_LIMIT} coperti raggiunto.`
        : "Non riesco a verificare i coperti della giornata. Aggiorna e riprova.");
      return;
    }
    setSaving(true);
    setCreateError("");
    setCreateSuccess("");
    try {
      if (createType === 'dopocena') {
        await createAfterDinnerBooking(supabase, values);
        form.reset();
        setCreateType('normale');
        setCreateSuccess("Prenotazione dopocena aggiunta all’agenda.");
        refreshAppointments();
        return;
      }
      const response = await adminFetch("/api/admin/bookings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Admin-Request": "1" },
        body: JSON.stringify(validation.data),
      });
      if (response.status === 401) { window.location.replace("/"); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof data.detail === "string" ? data.detail : "Controlla i campi della prenotazione e riprova.";
        throw new Error(detail);
      }
      const createdId = data.id ?? data.booking_id ?? data.booking?.id;
      let activityWarning = "";
      if (createdId) {
        const { error: activityError } = await supabase.rpc("admin_record_booking_creation", { p_booking_id: createdId });
        if (activityError) activityWarning = " La prenotazione è salvata, ma l’attività non è stata registrata: verifica il SQL dell’activity log.";
      } else {
        activityWarning = " La prenotazione è salvata, ma il backend non ha restituito l’ID per registrare l’attività.";
      }
      form.reset();
      setCreateSuccess(`Prenotazione aggiunta.${activityWarning}`);
      refreshAppointments();
    } catch (failure) {
      setCreateError(failure.message || "Connessione non disponibile.");
    } finally {
      setSaving(false);
    }
  }

  async function registerConsent(event, bookingId) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setConsentSaving(true);
    setConsentError("");
    try {
      const response = await adminFetch(`/api/admin/bookings/${bookingId}/marketing-consent`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Admin-Request": "1" },
        body: JSON.stringify({
          channel: fields.get("channel"),
          response_text: fields.get("response_text"),
        }),
      });
      if (response.status === 401) { window.location.replace("/"); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Consenso non salvato.");
      setConsentEditorId(null);
      refreshAppointments();
    } catch (failure) {
      setConsentError(failure.message || "Connessione non disponibile.");
    } finally {
      setConsentSaving(false);
    }
  }

  async function revokeConsent(bookingId) {
    if (!window.confirm("Confermi la revoca del consenso marketing?")) return;
    setConsentSaving(true);
    setConsentError("");
    try {
      const response = await adminFetch(`/api/admin/bookings/${bookingId}/marketing-consent/revoke`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Admin-Request": "1" },
      });
      if (response.status === 401) { window.location.replace("/"); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Revoca non salvata.");
      refreshAppointments();
    } catch (failure) {
      setConsentError(failure.message || "Connessione non disponibile.");
    } finally {
      setConsentSaving(false);
    }
  }

  async function changeStatus(booking, status) {
    if (statusSavingId !== null || editingId !== null || status === bookingStatus(booking.status)) return;
    if (status === 'no_show') {
      const eligibility = noShowEligibility(booking, now);
      if (!eligibility.allowed) {
        setStatusError({ bookingId: booking.id, message: eligibility.message });
        return;
      }
      if (!window.confirm(`Confermi che ${booking.name} non si è presentato alla prenotazione del ${booking.booking_date} alle ${booking.booking_time.slice(0, 5)}?\n\nLo stato diventerà “No-show”. La prenotazione resterà conservata nel database e nello storico.`)) return;
    }
    if (status === 'cancelled' && !window.confirm(
      `Confermi la cancellazione della prenotazione di ${booking.name} del ${booking.booking_date} alle ${booking.booking_time.slice(0, 5)}?\n\nLo stato diventerà “Cancellata”. La prenotazione resterà conservata nel database e nello storico.`
    )) return;
    setStatusSavingId(booking.id);
    setStatusError(null);
    try {
      await saveBookingStatus(supabase, booking.id, status);
      refreshAppointments();
    } catch (failure) {
      setStatusError({ bookingId: booking.id, message: failure.message || "Connessione non disponibile." });
    } finally {
      setStatusSavingId(null);
    }
  }

  const covers = bookings?.filter((booking) => bookingStatus(booking.status) === "confirmed")
    .reduce((sum, booking) => sum + booking.party_size, 0);

  const assignmentBooking = bookings?.find(booking => String(booking.id) === String(assignmentBookingId));
  const visibleBookings = (bookings || []).filter(booking => showAssigned || (!booking.tables?.trim() && ['confirmed', 'arrived'].includes(bookingStatus(booking.status))));
  const timeGroups = Object.entries(visibleBookings.reduce((groups, booking) => {
    const time = booking.booking_time.slice(0, 5);
    (groups[time] ||= []).push(booking);
    return groups;
  }, {})).sort(([first], [second]) => first.localeCompare(second));

  if (assignmentBooking) return <main className="booking-admin table-assignment-view">
    <button className="admin-button assignment-back" type="button" onClick={() => setAssignmentBookingId(null)}>← Torna all’elenco prenotazioni</button>
    <TableMap key={`${date}-${assignmentBooking.id}`} appointments={bookings} date={date} assignmentBooking={assignmentBooking}
      disabled={statusSavingId !== null || editingId !== null}
      onSaved={result => { applyUpdate(result.booking); setRequestRevision(value => value + 1); window.dispatchEvent(new Event('admin-notifications-changed')); }} />
  </main>;

  return (
    <main className="booking-admin bookings-day-page">
      <a href={`/prenotazioni?month=${date.slice(0, 7)}`}>← Torna al mese</a>
      <div className="agenda-heading">
        <div><p className="agenda-eyebrow">Agenda del giorno</p><h1>{dayLabel(date)}</h1></div>
        <button className="admin-button mobile-primary-action" type="button" aria-expanded={showCreate}
          aria-controls="manual-booking-form" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? "Chiudi" : "+ Nuova prenotazione"}
        </button>
      </div>
      <MobileSection title="Richieste clienti">
      <BookingRequests appointments={appointments} disabled={loading || Boolean(appointmentsError) || editingId !== null || statusSavingId !== null}
        onChanged={() => { refreshAppointments(); setRequestRevision(value => value + 1); }} />
      </MobileSection>
      <MobileSection title="Prenotazioni online">
      <div className="online-booking-control">
        <div aria-live="polite">
          <strong>{onlineClosed === null ? "Stato prenotazioni online da verificare" : onlineClosed ? "Prenotazioni online chiuse" : "Prenotazioni online aperte"}</strong>
          <p>Puoi sempre inserire prenotazioni manuali. Quelle già ricevute restano valide.</p>
        </div>
        <button className="admin-button admin-button-secondary" type="button"
          disabled={closureSaving || onlineClosed === null} onClick={toggleOnlineBookings}>
          {closureSaving ? "Salvataggio…" : onlineClosed ? "Riapri prenotazioni online" : "Chiudi prenotazioni online"}
        </button>
        {closureError && <p role="alert">{closureError}</p>}
      </div>
      </MobileSection>
      {showCreate && <form id="manual-booking-form" className="booking-admin-form manual-booking-form" noValidate onSubmit={createBooking}>
        <div className="manual-booking-heading">
          <h2>Inserisci prenotazione telefonica</h2>
          <p>La conferma email e la chat WhatsApp manuale sono disponibili in Comunicazioni e log.</p>
        </div>
        <label>Tipo prenotazione<select name="booking_type" value={createType}
          onChange={(event) => { setCreateType(event.target.value); setFieldErrors({}); }}>
          {Object.entries(BOOKING_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Nome e cognome<input name="name" aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "error-name" : undefined} required minLength="2" maxLength="60" autoComplete="name" />{fieldErrors.name && <small className="field-error" id="error-name">{fieldErrors.name}</small>}</label>
        <label>Telefono<input name="phone" aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? "error-phone" : undefined} required minLength="8" maxLength="30" inputMode="tel" autoComplete="tel" placeholder="+39…" />{fieldErrors.phone && <small className="field-error" id="error-phone">{fieldErrors.phone}</small>}</label>
        <label>Email facoltativa<input name="email" aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "error-email" : undefined} type="email" maxLength="120" autoComplete="email" />{fieldErrors.email && <small className="field-error" id="error-email">{fieldErrors.email}</small>}</label>
        <label>Ora<input name="time" aria-invalid={Boolean(fieldErrors.time)} aria-describedby={fieldErrors.time ? "error-time" : undefined} type="time" required min={createType === 'dopocena' ? "22:00" : "18:00"} max={createType === 'dopocena' ? "23:30" : "23:00"} step="1800" />{fieldErrors.time && <small className="field-error" id="error-time">{fieldErrors.time}</small>}</label>
        <label>Persone<input name="party_size" aria-invalid={Boolean(fieldErrors.party_size)} aria-describedby={fieldErrors.party_size ? "error-party_size" : undefined} type="number" required min="1" max="6" inputMode="numeric" />{fieldErrors.party_size && <small className="field-error" id="error-party_size">{fieldErrors.party_size}</small>}</label>
        {createType === 'dopocena' && <label>Tavolo<select name="table" required aria-invalid={Boolean(fieldErrors.table)}>
          <option value="">Scegli tavolo</option>
          {Object.entries(tables).map(([id, capacity]) => <option key={id} value={id}>Tavolo {id} · {capacity} posti</option>)}
        </select>{fieldErrors.table && <small className="field-error">{fieldErrors.table}</small>}</label>}
        <label className="manual-booking-notes">Note facoltative<textarea name="notes" aria-invalid={Boolean(fieldErrors.notes)} aria-describedby={fieldErrors.notes ? "error-notes" : undefined} maxLength="300" rows="3" placeholder="Es. compleanno, seggiolone, richieste…" />{fieldErrors.notes && <small className="field-error" id="error-notes">{fieldErrors.notes}</small>}</label>
        <button className="admin-button" type="submit" disabled={saving}>{saving ? "Salvataggio…" : "Aggiungi all’agenda"}</button>
        {fieldErrors.date && <p className="manual-booking-feedback is-error" role="alert">{fieldErrors.date}</p>}
        {createError && <p className="manual-booking-feedback is-error" role="alert">{createError}</p>}
        {createSuccess && <p className="manual-booking-feedback is-success" role="status">{createSuccess}</p>}
      </form>}
      <div className="day-summary" aria-live="polite">
        <span>{bookings ? <><strong>{covers}</strong> / {DAILY_COVER_LIMIT} coperti confermati</> : error ? "Coperti non disponibili" : "Caricamento…"}</span>
          <button className="admin-button" type="button" disabled={loading} onClick={refreshAppointments}>Aggiorna</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {editFeedback && <p className="manual-booking-feedback is-success" role="status">
        Modifiche salvate.
        {editFeedback.date !== date && <> <a href={`/prenotazioni/giorno?date=${editFeedback.date}`}>Apri la nuova data</a></>}
      </p>}
      <div aria-live="polite">
        {bookings?.length === 0 && <p>Nessuna prenotazione per questa data.</p>}
        {bookings && bookings.length > 0 && <p>{bookings.length} prenotazioni trovate.</p>}
      </div>
      <div className="assignment-list-controls">
        <h2>Prenotazioni da assegnare</h2>
        <label><input type="checkbox" checked={showAssigned} onChange={event => setShowAssigned(event.target.checked)} /> Mostra tutte le prenotazioni</label>
        {!loading && !error && !visibleBookings.length && <p>Nessuna prenotazione senza tavolo.</p>}
        <p>Apri una prenotazione per vedere i dettagli e assegnare i tavoli.</p>
      </div>
      <div className="booking-time-groups">
        {timeGroups.map(([time, group]) => (
          <section key={time} className="booking-time-group" aria-labelledby={`time-${time}`}>
            <h2 id={`time-${time}`} className="booking-time-heading">
              <span aria-hidden="true">🕒</span> <time>{time}</time>
            </h2>
            <div className="booking-time-list">
              {group.map((booking) => {
                const confirmed = bookingStatus(booking.status) === "confirmed";
                const delayNotification = bookingDelayNotification(booking, now);
                const noShow = noShowEligibility(booking, now);
                const callUrl = bookingCallUrl(booking.phone);
                const previousNoShows = previousCustomerNoShowCount(booking, appointments, now);
                return (
                  <article id={`booking-${booking.id}`} tabIndex={-1} key={booking.id} className={`booking-row${["cancelled", "no_show"].includes(bookingStatus(booking.status)) ? " is-cancelled" : ""}`}>
                    <details className="booking-card-disclosure" name={mobile ? "mobile-agenda-area" : undefined}>
                      <summary className="booking-card-summary" aria-label={`Dettagli prenotazione di ${booking.name}`}>
                        <time className="booking-card-time">{booking.booking_time?.slice(0,5)}</time>
                        <strong className="booking-card-name">{booking.name}</strong>
                        <span className="booking-card-covers">{booking.party_size} persone</span>
                        <span className={`booking-status status-${bookingStatus(booking.status).toLowerCase()}`}>{bookingStatusLabel(booking.status)}</span>
                        <span className="booking-card-tables">Tavolo: {booking.tables || 'Da assegnare'}</span>
                      </summary>
                      <div className="booking-card-content">
                        <dl className="booking-detail-meta">
                          <div><dt>Telefono</dt><dd>{booking.phone || 'Non presente'}</dd></div>
                          <div><dt>Tipo</dt><dd>{bookingTypeLabel(booking.booking_type)}</dd></div>
                        </dl>
                        <section className="booking-detail-management" aria-label="Gestione prenotazione">
                          <h3>Gestione prenotazione</h3>
                          <div className="booking-management-actions">
                        <button type="button" className="admin-button booking-detail-primary" disabled={statusSavingId !== null || editingId !== null}
                          onClick={() => setAssignmentBookingId(booking.id)} aria-label={`Apri mappa tavoli per ${booking.name}`}>Apri mappa tavoli</button>
                      <BookingEditor booking={booking} appointments={appointments} disabled={statusSavingId !== null || (editingId !== null && editingId !== booking.id)}
                        onEditing={open => setEditingId(open ? booking.id : null)}
                        onSaved={result => {
                          setEditingId(null);
                          applyUpdate(result.booking);
                          setEditFeedback({ date: result.booking.booking_date });
                        }} />
                          </div>
                    <div className="booking-status-editor">
                      <label htmlFor={`status-${booking.id}`}>Cambia stato</label>
                      <select id={`status-${booking.id}`} value={bookingStatus(booking.status)}
                        disabled={statusSavingId !== null || editingId !== null}
                        onChange={(event) => changeStatus(booking, event.target.value)}>
                        {!Object.hasOwn(BOOKING_STATUSES, bookingStatus(booking.status)) &&
                          <option value={bookingStatus(booking.status)}>{bookingStatusLabel(booking.status)}</option>}
                        {Object.entries(BOOKING_STATUSES).map(([value, label]) => <option key={value} value={value}
                          disabled={value === 'no_show' && !noShow.allowed}>{label}</option>)}
                      </select>
                      {statusSavingId === booking.id && <span role="status">Salvataggio…</span>}
                      {statusError?.bookingId === booking.id && <p className="manual-booking-feedback is-error" role="alert">{statusError.message}</p>}
                    </div>
                        </section>
                    {previousNoShows > 0 && <p className="booking-customer-warning" role="status">
                      Cliente con <strong>{previousNoShows}</strong> {previousNoShows === 1 ? 'precedente' : 'precedenti'} NO_SHOW
                    </p>}
                    {delayNotification && <p className="booking-delay-notification" role="status">{delayNotification.message}</p>}
                    <BookingCommunications booking={booking} />
                    <CustomerCard booking={booking} appointments={appointments} now={now} />
                    <details className="booking-row-details">
                      <summary>Dettagli{booking.notes ? " · note" : ""}{confirmed ? " e messaggio" : ""}{booking.marketing_consent_active ? " · marketing attivo" : ""}</summary>
                      {bookingStatus(booking.status) === "confirmed" && !booking.tables?.trim() ? (
                        <p role="status" className="booking-table-warning">TAVOLO DA ASSEGNARE</p>
                      ) : <p>Tavoli: {booking.tables || "Non assegnati"}</p>}
                      {booking.notes && <p>Note: {booking.notes}</p>}
                      {callUrl ? <a className="admin-button admin-button-secondary" href={callUrl}
                        aria-label={`Chiama cliente: ${booking.name}`}>Chiama cliente</a> :
                        <button className="admin-button admin-button-secondary" type="button" disabled
                          title="Numero di telefono mancante o non valido">Chiama cliente</button>}

                      <button className="admin-button admin-button-secondary booking-action-danger" type="button"
                        disabled={statusSavingId !== null || editingId !== null || bookingStatus(booking.status) === 'cancelled'}
                        onClick={() => changeStatus(booking, 'cancelled')}>
                        Cancella prenotazione
                      </button>
                      <button className="admin-button admin-button-secondary booking-action-caution" type="button"
                        disabled={statusSavingId !== null || editingId !== null || !noShow.allowed}
                        title={noShow.message}
                        onClick={() => changeStatus(booking, 'no_show')}>
                        Segna come No-show
                      </button>

                      {booking.arrived_at && <p>Arrivo registrato: {consentDate(booking.arrived_at)}.
                        {booking.marketing_consent_active
                          ? ` Visite registrate con consenso: ${booking.marketing_visit_count}.`
                          : " Nessun conteggio personale attivo senza consenso marketing."}</p>}
                      {confirmed && <>
                        <p className="booking-confirmation-preview">{confirmationMessage(booking, "whatsapp")}</p>
                        <small>Usa Comunicazioni e log per inviare l’email o aprire la chat WhatsApp.</small>
                      </>}
                      {booking.source === "agenda" && confirmed && <div className="marketing-consent-panel">
                        {booking.marketing_consent_active ? <p className="marketing-consent-status is-active">
                          Consenso marketing attivo fino al {consentDate(booking.marketing_expires_at)}.
                        </p> : <p className="marketing-consent-status">
                          {booking.marketing_revoked_at ? `Consenso revocato il ${consentDate(booking.marketing_revoked_at)}.` :
                            booking.marketing_expires_at ? `Consenso scaduto il ${consentDate(booking.marketing_expires_at)}.` : "Nessun consenso marketing registrato."}
                        </p>}
                        <div className="marketing-consent-actions">
                          <button className="admin-button" type="button" disabled={consentSaving}
                            onClick={() => { setConsentError(""); setConsentEditorId(booking.id); }}>
                            {booking.marketing_consent_active ? "Registra nuovo consenso" : "Registra risposta positiva"}
                          </button>
                          {booking.marketing_consent_active && <button className="admin-button admin-button-secondary" type="button"
                            disabled={consentSaving} onClick={() => revokeConsent(booking.id)}>Revoca</button>}
                        </div>
                        {consentEditorId === booking.id && <form className="marketing-consent-form" onSubmit={(event) => registerConsent(event, booking.id)}>
                          <p>Usa questo comando soltanto dopo una risposta positiva e inequivocabile del cliente. Una nuova registrazione fa ripartire i 24 mesi.</p>
                          <label>Canale<select name="channel" defaultValue="whatsapp">
                            <option value="whatsapp">WhatsApp</option>
                            <option value="telefono">Telefono</option>
                            <option value="email">Email</option>
                          </select></label>
                          <label>Risposta del cliente<input name="response_text" required maxLength="200" placeholder="Es. Sì oppure Confermo" /></label>
                          <div className="marketing-consent-actions">
                            <button className="admin-button" type="submit" disabled={consentSaving}>{consentSaving ? "Salvataggio…" : "Salva consenso"}</button>
                            <button className="admin-button admin-button-secondary" type="button" onClick={() => setConsentEditorId(null)}>Annulla</button>
                          </div>
                          {consentError && <p className="manual-booking-feedback is-error" role="alert">{consentError}</p>}
                        </form>}
                      </div>}
                    </details>
                    <BookingHistory bookingId={booking.id}
                      revision={JSON.stringify([requestRevision, booking.status, booking.booking_date, booking.booking_time, booking.party_size, booking.tables, booking.notes])} />
                      </div>
                    </details>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
