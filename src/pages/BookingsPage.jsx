import { adminFetch } from "../lib/adminFetch";
import { useAppointments } from "../hooks/useAppointments";
import { validateBooking } from "../utils/bookingValidation";
import { useEffect, useState } from "react";
import { dayLabel, isDay, todayInRome } from "../utils/calendar";
import {
  confirmationEmailUrl,
  confirmationMessage,
  confirmationWhatsAppUrl,
} from "../utils/bookingConfirmation";

function consentDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value));
}

export default function BookingsPage() {
  const requested = new URLSearchParams(window.location.search).get("date");
  const date = isDay(requested) ? requested : todayInRome();
  const { appointments: realtimeRows } = useAppointments('all');
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const [consentEditorId, setConsentEditorId] = useState(null);
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [arrivalSavingId, setArrivalSavingId] = useState(null);
  const [arrivalError, setArrivalError] = useState(null);

  async function createBooking(event) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const validation = validateBooking({ ...Object.fromEntries(fields), date });
    setFieldErrors(validation.errors);
    setCreateError("");
    setCreateSuccess("");
    if (Object.keys(validation.errors).length) {
      form.elements.namedItem(Object.keys(validation.errors)[0])?.focus();
      return;
    }
    setSaving(true);
    setCreateError("");
    setCreateSuccess("");
    try {
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
      form.reset();
      setCreateSuccess("Prenotazione aggiunta. Puoi preparare la conferma dall’agenda via WhatsApp o, se non disponibile, via email.");
      setRefresh((value) => value + 1);
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
      setRefresh((value) => value + 1);
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
      setRefresh((value) => value + 1);
    } catch (failure) {
      setConsentError(failure.message || "Connessione non disponibile.");
    } finally {
      setConsentSaving(false);
    }
  }

  async function markArrived(booking) {
    const note = booking.marketing_consent_active
      ? "La visita sarà aggiunta al contatore del cliente."
      : "L’arrivo sarà registrato, ma la visita non sarà conteggiata senza un consenso marketing attivo.";
    if (!window.confirm(`Confermi che il cliente è arrivato?\n\n${note}`)) return;
    setArrivalSavingId(booking.id);
    setArrivalError(null);
    try {
      const response = await adminFetch(`/api/admin/bookings/${booking.id}/arrived`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Admin-Request": "1" },
      });
      if (response.status === 401) { window.location.replace("/"); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Arrivo non salvato.");
      setRefresh((value) => value + 1);
    } catch (failure) {
      setArrivalError({ bookingId: booking.id, message: failure.message || "Connessione non disponibile." });
    } finally {
      setArrivalSavingId(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setBookings(null);
    setError("");
    async function load() {
      try {
        const response = await adminFetch(`/api/admin/bookings?date=${date}`, {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        if (response.status === 401) { window.location.replace("/"); return; }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.detail || data.error || `Il backend ha risposto con errore HTTP ${response.status}.`);
        }
        if (!Array.isArray(data.bookings)) throw new Error("Il backend ha risposto, ma il formato delle prenotazioni non è valido.");
        if (!controller.signal.aborted) setBookings(data.bookings);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message || "Connessione non disponibile.");
      }
    }
    load();
    return () => controller.abort();
  }, [date, refresh, realtimeRows]);
  const covers = bookings?.filter((booking) => booking.status === "confirmed")
    .reduce((sum, booking) => sum + booking.party_size, 0);

  const timeGroups = Object.entries((bookings || []).reduce((groups, booking) => {
    const time = booking.booking_time.slice(0, 5);
    (groups[time] ||= []).push(booking);
    return groups;
  }, {})).sort(([first], [second]) => first.localeCompare(second));

  return (
    <main className="booking-admin">
      <a href={`/prenotazioni?month=${date.slice(0, 7)}`}>← Torna al mese</a>
      <div className="agenda-heading">
        <div><p className="agenda-eyebrow">Agenda del giorno</p><h1>{dayLabel(date)}</h1></div>
        <button className="admin-button" type="button" aria-expanded={showCreate}
          aria-controls="manual-booking-form" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? "Chiudi" : "+ Nuova prenotazione"}
        </button>
      </div>
      {showCreate && <form id="manual-booking-form" className="booking-admin-form manual-booking-form" noValidate onSubmit={createBooking}>
        <div className="manual-booking-heading">
          <h2>Inserisci prenotazione telefonica</h2>
          <p>La conferma partirà da WhatsApp; se il numero non è disponibile useremo l’email.</p>
        </div>
        <label>Nome e cognome<input name="name" aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "error-name" : undefined} required minLength="2" maxLength="60" autoComplete="name" />{fieldErrors.name && <small className="field-error" id="error-name">{fieldErrors.name}</small>}</label>
        <label>Telefono<input name="phone" aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? "error-phone" : undefined} required minLength="8" maxLength="30" inputMode="tel" autoComplete="tel" placeholder="+39…" />{fieldErrors.phone && <small className="field-error" id="error-phone">{fieldErrors.phone}</small>}</label>
        <label>Email facoltativa<input name="email" aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "error-email" : undefined} type="email" maxLength="120" autoComplete="email" />{fieldErrors.email && <small className="field-error" id="error-email">{fieldErrors.email}</small>}</label>
        <label>Ora<input name="time" aria-invalid={Boolean(fieldErrors.time)} aria-describedby={fieldErrors.time ? "error-time" : undefined} type="time" required min="18:00" max="23:00" step="1800" />{fieldErrors.time && <small className="field-error" id="error-time">{fieldErrors.time}</small>}</label>
        <label>Persone<input name="party_size" aria-invalid={Boolean(fieldErrors.party_size)} aria-describedby={fieldErrors.party_size ? "error-party_size" : undefined} type="number" required min="1" max="6" inputMode="numeric" />{fieldErrors.party_size && <small className="field-error" id="error-party_size">{fieldErrors.party_size}</small>}</label>
        <label className="manual-booking-notes">Note facoltative<textarea name="notes" aria-invalid={Boolean(fieldErrors.notes)} aria-describedby={fieldErrors.notes ? "error-notes" : undefined} maxLength="300" rows="3" placeholder="Es. compleanno, seggiolone, richieste…" />{fieldErrors.notes && <small className="field-error" id="error-notes">{fieldErrors.notes}</small>}</label>
        <button className="admin-button" type="submit" disabled={saving}>{saving ? "Salvataggio…" : "Aggiungi all’agenda"}</button>
        {fieldErrors.date && <p className="manual-booking-feedback is-error" role="alert">{fieldErrors.date}</p>}
        {createError && <p className="manual-booking-feedback is-error" role="alert">{createError}</p>}
        {createSuccess && <p className="manual-booking-feedback is-success" role="status">{createSuccess}</p>}
      </form>}
      <div className="day-summary" aria-live="polite">
        <span>{bookings ? <><strong>{covers}</strong> coperti confermati</> : error ? "Coperti non disponibili" : "Caricamento…"}</span>
        <button className="admin-button" type="button" disabled={!bookings && !error} onClick={() => setRefresh((value) => value + 1)}>Aggiorna</button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div aria-live="polite">
        {bookings?.length === 0 && <p>Nessuna prenotazione per questa data.</p>}
        {bookings && bookings.length > 0 && <p>{bookings.length} prenotazioni trovate.</p>}
      </div>
      <div className="booking-time-groups">
        {timeGroups.map(([time, group]) => (
          <section key={time} className="booking-time-group" aria-labelledby={`time-${time}`}>
            <h2 id={`time-${time}`} className="booking-time-heading">
              <span aria-hidden="true">🕒</span> <time>{time}</time>
            </h2>
            <div className="booking-time-list">
              {group.map((booking) => {
                const whatsappUrl = confirmationWhatsAppUrl(booking);
                const emailUrl = whatsappUrl ? null : confirmationEmailUrl(booking);
                const confirmationUrl = whatsappUrl || emailUrl;
                const confirmationChannel = whatsappUrl ? "whatsapp" : "email";
                const confirmed = booking.status === "confirmed";
                return (
                  <article key={booking.id} className={`booking-row${confirmed ? "" : " is-cancelled"}`}>
                    <div className="booking-row-main">
                      <span className="booking-row-covers"><span aria-hidden="true">👥</span><span className="admin-sr-only">Coperti: </span><strong>{booking.party_size}</strong></span>
                      <h3 className="booking-row-name"><span aria-hidden="true">👤</span><span className="admin-sr-only">Nome: </span>{booking.name}</h3>
                      <span className="booking-row-phone"><span aria-hidden="true">📞</span><span className="admin-sr-only">Telefono: </span>{booking.phone || "Non presente"}</span>
                      <span className={`booking-status${confirmed ? "" : " is-cancelled"}`}>{booking.arrived_at ? "Arrivato" : confirmed ? "Confermata" : "Annullata"}</span>
                    </div>
                    {confirmed && <div className="booking-confirmation-action">
                      {!booking.arrived_at && <button className="admin-button booking-arrived" type="button"
                        disabled={arrivalSavingId === booking.id} onClick={() => markArrived(booking)}>
                        {arrivalSavingId === booking.id ? "Salvataggio…" : "Segna arrivato"}
                      </button>}
                      {confirmationUrl ? <a className="booking-confirmation" href={confirmationUrl}
                        target={whatsappUrl ? "_blank" : undefined} rel={whatsappUrl ? "noopener noreferrer" : undefined}
                        aria-label={`Prepara conferma ${emailUrl ? "email" : "WhatsApp"} per ${booking.name}`}
                        title="Prepara la conferma: l’invio resta manuale">
                        {whatsappUrl ? "WhatsApp ↗" : "Email ↗"}
                      </a> : <>
                        <button className="booking-confirmation" type="button" disabled aria-describedby={`confirmation-help-${booking.id}`}>Conferma ↗</button>
                        <small id={`confirmation-help-${booking.id}`}>Email e telefono mancanti o non validi</small>
                      </>}
                    </div>}
                    <details className="booking-row-details">
                      <summary>Dettagli{booking.notes ? " · note" : ""}{confirmed ? " e messaggio" : ""}{booking.marketing_consent_active ? " · marketing attivo" : ""}</summary>
                      <p>Tavoli: {booking.tables || "Non assegnati"}</p>
                      {booking.notes && <p>Note: {booking.notes}</p>}
                      {booking.arrived_at && <p>Arrivo registrato: {consentDate(booking.arrived_at)}.
                        {booking.marketing_consent_active
                          ? ` Visite registrate con consenso: ${booking.marketing_visit_count}.`
                          : " Nessun conteggio personale attivo senza consenso marketing."}</p>}
                      {arrivalError?.bookingId === booking.id && <p className="manual-booking-feedback is-error" role="alert">{arrivalError.message}</p>}
                      {confirmed && <>
                        <p className="booking-confirmation-preview">{confirmationMessage(booking, confirmationChannel)}</p>
                        <small>{whatsappUrl
                          ? "Il messaggio si apre pronto da inviare su WhatsApp."
                          : emailUrl
                            ? "WhatsApp non è disponibile: l’email si apre pronta da inviare."
                            : "Serve un numero di telefono oppure un indirizzo email valido per preparare la conferma."}</small>
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
