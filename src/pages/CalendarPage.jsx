import { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../lib/adminFetch";
import {
  calendarCells,
  dayLabel,
  monthLabel,
  operationalDayInRome,
  shiftMonth,
  todayInRome,
} from "../utils/calendar";
import "../styles/admin-calendar.css";

const WEEKDAYS = ["LUN", "MAR", "MER", "GIO", "VEN", "SAB", "DOM"];

function isPastDate(date) {
  return date < todayInRome();
}

function isMonday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 1;
}

function isClosed(date, dayStats) {
  if (dayStats && typeof dayStats.closed === "boolean") return dayStats.closed;
  return isPastDate(date) || isMonday(date);
}

function getSearchParams() {
  return new URLSearchParams(window.location.search);
}

function updateUrl(params) {
  const url = new URL(window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  });
  window.history.replaceState({}, "", url.toString());
}

export default function CalendarPage() {
  const today = useMemo(() => todayInRome(), []);
  const operationDay = useMemo(() => operationalDayInRome(), []);

  const requested = getSearchParams().get("month");
  const [currentMonth, setCurrentMonth] = useState(
    requested && /^\d{4}-\d{2}$/.test(requested) ? requested : today.slice(0, 7)
  );

  const cells = useMemo(() => calendarCells(currentMonth), [currentMonth]);
  const [daysByDate, setDaysByDate] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDaysByDate({});
    setLoading(true);
    setError('');

    async function loadAvailability() {
      try {
        const response = await adminFetch(
          `/api/admin/bookings/month?month=${encodeURIComponent(currentMonth)}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          throw new Error("Disponibilità CENA non disponibile.");
        }

        const payload = await response.json();
        if (!Array.isArray(payload.days)) throw new Error('Riepilogo del mese non valido.');
        const days = payload.days;
        const nextDaysByDate = Object.fromEntries(
          days.map((day) => [day.date, day]),
        );

        if (!cancelled) setDaysByDate(nextDaysByDate);
      } catch {
        if (!cancelled) {
          setDaysByDate({});
          setError('Riepilogo del mese non disponibile. Ricarica la pagina per riprovare.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [currentMonth]);

  const [selectedDay, setSelectedDay] = useState(() => {
    const urlDay = getSearchParams().get("day");
    if (urlDay && cells.includes(urlDay)) return urlDay;
    if (cells.includes(operationDay)) return operationDay;
    return cells.find(Boolean) || today;
  });

  useEffect(() => {
    const urlDay = getSearchParams().get("day");
    if (urlDay && cells.includes(urlDay) && urlDay !== selectedDay) {
      setSelectedDay(urlDay);
    }
  }, [cells, selectedDay]);

  useEffect(() => {
    if (!cells.includes(selectedDay)) {
      const fallback = cells.includes(operationDay) ? operationDay : cells.find(Boolean) || today;
      setSelectedDay(fallback);
    }
  }, [cells, selectedDay, operationDay, today]);

  const selectedStats = daysByDate[selectedDay];
  const selectedClosed = isClosed(selectedDay, selectedStats);
  const selectedCovers = selectedStats && !loading && !error ? Number(selectedStats.covers) || 0 : '—';
  const selectedAvailable = !loading && !error && selectedStats?.availability === 'available';
  const selectedUnavailable = selectedClosed || ['full', 'closed', 'past'].includes(selectedStats?.availability);
  const selectedAvailabilityLabel = selectedUnavailable ? 'CENA non disponibile'
    : selectedAvailable ? 'Posti CENA disponibili' : 'Disponibilità CENA da verificare';

  const handlePrevMonth = () => {
    const prev = shiftMonth(currentMonth, -1);
    if (prev) {
      setCurrentMonth(prev);
      updateUrl({ month: prev });
    }
  };

  const handleNextMonth = () => {
    const next = shiftMonth(currentMonth, 1);
    if (next) {
      setCurrentMonth(next);
      updateUrl({ month: next });
    }
  };

  const handleToday = () => {
    const m = today.slice(0, 7);
    setCurrentMonth(m);
    setSelectedDay(operationDay);
    updateUrl({ month: m, day: operationDay });
  };

  const handleSelectDay = (date) => {
    setSelectedDay(date);
    updateUrl({ day: date });
  };

  const openBookings = () => {
    window.location.href = `/prenotazioni/giorno?date=${selectedDay}`;
  };

    return (
    <main className="booking-admin admin-calendar-page" aria-busy={loading}>
      {error && <p role="alert">{error}</p>}
      <div className="admin-calendar">
          <header className="calendar-header">
            <div className="calendar-nav">
              <button
                type="button"
                className="calendar-nav-btn"
                onClick={handlePrevMonth}
                aria-label="Mese precedente"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>

              <h1 className="calendar-month">{monthLabel(currentMonth)}</h1>

              <button
                type="button"
                className="calendar-nav-btn"
                onClick={handleNextMonth}
                aria-label="Mese successivo"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>

            <p className="calendar-caption">Coperti per giorno</p>
          </header>

        <div className="calendar-grid">
          {WEEKDAYS.map((name) => (
            <div key={name} className="calendar-weekday">{name}</div>
          ))}
          {cells.map((date, index) => {
            if (!date) return <div key={`empty-${index}`} className="calendar-cell empty" />;

            const dayStats = daysByDate[date];
            const closed = isClosed(date, dayStats);
            const covers = dayStats && !loading && !error ? Number(dayStats.covers) || 0 : '—';
            const current = date === today;
            const past = isPastDate(date);
            const mondayClosed = new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
            const dinnerAvailability = dayStats?.availability;
            let barStatus = "unverified";
            let availabilityLabel = "disponibilità CENA non verificata";

            if (past) {
              barStatus = "past";
              availabilityLabel = "giorno passato";
            } else if (mondayClosed) {
              barStatus = "past";
              availabilityLabel = "chiuso il lunedì";
            } else if (dinnerAvailability === "available") {
              barStatus = "open";
              availabilityLabel = "posti CENA disponibili";
            } else if (["full", "closed", "past"].includes(dinnerAvailability)) {
              barStatus = "closed";
              availabilityLabel = "CENA non disponibile";
            }

            const classes = [
              "calendar-cell",
              selectedDay === date && "selected",
              current && "today",
              closed && "closed",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={date}
                type="button"
                className={classes}
                onClick={() => handleSelectDay(date)}
                aria-label={`${dayLabel(date)}${current ? ", oggi" : ""}: ${covers === '—' ? 'coperti da verificare' : `${covers} coperti`}, ${availabilityLabel}`}
              >
                <span className="cell-day-number">{Number(date.slice(8))}</span>
                <span className={`cell-covers ${closed ? "closed" : "open"}`}>{covers}</span>
                <span className={`cell-bar ${barStatus}`} />
              </button>
            );
          })}
        </div>

        <div className="calendar-legend">
          <div className="legend-item">
            <span className="legend-bar open" />
            <span>Posti CENA disponibili</span>
          </div>
          <div className="legend-item">
            <span className="legend-bar closed" />
            <span>CENA non disponibile</span>
          </div>
          <div className="legend-item">
            <span className="legend-bar past" />
            <span>Passato / stato non verificato</span>
          </div>
        </div>

        <div className="calendar-day-summary">
          <div className="day-summary-info">
            <h3 className="day-summary-date">{dayLabel(selectedDay)}</h3>
            <div className={`day-summary-state ${selectedUnavailable ? "closed" : selectedAvailable ? "open" : "unverified"}`}>
              <span className="state-bar" />
              <span>{selectedAvailabilityLabel}</span>
            </div>
            <div className="day-summary-covers">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <strong>{selectedCovers}</strong>
              <span>coperti prenotati</span>
            </div>
          </div>
          <div className="day-summary-action">
            <button className="day-summary-btn" onClick={openBookings}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              <span>Vedi prenotazioni</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
