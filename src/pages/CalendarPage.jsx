import MobileSection from "../components/MobileSection";
import BookingRequests from "../components/BookingRequests";
import { bookingStatus } from "../utils/bookingStatus";
import { useAppointments } from "../hooks/useAppointments";
import { calendarCells, dayLabel, isMonth, monthLabel, shiftMonth, todayInRome } from "../utils/calendar";

const weekdays = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

export default function CalendarPage() {
  const today = todayInRome();
  const requested = new URLSearchParams(window.location.search).get("month");
  const month = isMonth(requested) ? requested : today.slice(0, 7);
  const { appointments, loading, error: failure, refresh } = useAppointments('all');
  const error = failure?.message || '';
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const days = loading || error ? null : appointments.reduce((result, booking) => {
    if (bookingStatus(booking.status) === 'confirmed' && booking.booking_date.startsWith(month)) {
      const day = result[booking.booking_date] ||= { covers: 0 };
      day.covers += booking.party_size;
    }
    return result;
  }, {});
  const total = days && Object.values(days).reduce((sum, day) => sum + day.covers, 0);

  return <main className="booking-admin calendar-page">
    <div className="agenda-heading">
      <div><p className="agenda-eyebrow">Agenda prenotazioni</p><h1>Calendario</h1></div>
    </div>
      <MobileSection title="Richieste clienti">
    <BookingRequests appointments={appointments} disabled={loading || Boolean(error)} onChanged={refresh} />
      </MobileSection>
    <section className="calendar-panel" aria-label="Calendario mensile">
      <div className="calendar-toolbar">
        <div className="calendar-month-nav">
          {previous && <a className="admin-button calendar-arrow" href={`?month=${previous}`} aria-label="Mese precedente">←</a>}
          <h2>{monthLabel(month)}</h2>
          {next && <a className="admin-button calendar-arrow" href={`?month=${next}`} aria-label="Mese successivo">→</a>}
        </div>
        <div className="calendar-actions">
          <a className="admin-button" href="/prenotazioni">Oggi</a>
          <button className="admin-button" type="button" disabled={loading} onClick={refresh}>Aggiorna</button>
        </div>
      </div>
      <div className="calendar-summary" aria-live="polite">
        <span>{loading ? "Caricamento coperti…" : error ? "Coperti non disponibili" : <><strong>{total}</strong> coperti nel mese</>}</span>
        <span>Solo prenotazioni confermate</span>
      </div>
      {error && <div className="calendar-error" role="alert">{error}</div>}
      <div className="calendar-weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid" aria-busy={loading}>
        {calendarCells(month).map((date, index) => {
          if (!date) return <div key={`blank-${index}`} className="calendar-blank" aria-hidden="true" />;
          const covers = days ? days[date]?.covers ?? 0 : null;
          const current = date === today;
          return <a key={date} href={`/prenotazioni/giorno?date=${date}`}
            className={`calendar-day${current ? " is-today" : ""}${covers > 0 ? " has-bookings" : ""}`}
            aria-current={current ? "date" : undefined}
            aria-label={`${dayLabel(date)}${current ? ", oggi" : ""}: ${covers === null ? "coperti non disponibili" : `${covers} coperti`}`}>
            <span className="calendar-day-number">{Number(date.slice(-2))}{current && <small>Oggi</small>}</span>
            <span className="calendar-covers"><strong>{covers === null ? "—" : covers}</strong><span>coperti</span></span>
          </a>;
        })}
      </div>
      <p className="calendar-hint">Seleziona un giorno per aprire le prenotazioni.</p>
    </section>
  </main>;
}
