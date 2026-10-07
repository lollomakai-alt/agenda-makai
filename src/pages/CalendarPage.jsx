import { useEffect, useState } from "react";
import { bookingStatus } from "../utils/bookingStatus";
import { useAppointments } from "../hooks/useAppointments";
import {
  calendarCells,
  dayLabel,
  isMonth,
  monthLabel,
  shiftMonth,
  todayInRome,
} from "../utils/calendar";
import { supabase } from "../lib/supabase";

const weekdays = [
  "Lun",
  "Mar",
  "Mer",
  "Gio",
  "Ven",
  "Sab",
  "Dom",
];

const COUNTED_STATUSES = new Set([
  "confirmed",
  "arrived",
]);

export default function CalendarPage() {
  const today = todayInRome();

  const requested = new URLSearchParams(
    window.location.search
  ).get("month");

  const month = isMonth(requested)
    ? requested
    : today.slice(0, 7);

  const {
    appointments,
    loading,
    error: failure,
  } = useAppointments("all");

  const [closedDates, setClosedDates] = useState(
    new Set()
  );

  const [
    closuresLoading,
    setClosuresLoading,
  ] = useState(true);

  const [
    closuresError,
    setClosuresError,
  ] = useState("");

  const error = failure?.message || "";

  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  useEffect(() => {
    let active = true;

    async function loadClosures() {
      setClosuresLoading(true);
      setClosuresError("");

      if (!supabase) {
        if (active) {
          setClosedDates(new Set());
          setClosuresError(
            "Non riesco a verificare le chiusure online."
          );
          setClosuresLoading(false);
        }

        return;
      }

      const firstDay = `${month}-01`;

      const nextMonth =
        shiftMonth(month, 1);

      if (!nextMonth) {
        if (active) {
          setClosedDates(new Set());
          setClosuresError(
            "Non riesco a calcolare il mese successivo."
          );
          setClosuresLoading(false);
        }

        return;
      }

      const nextFirstDay =
        `${nextMonth}-01`;

      const {
        data,
        error: closureFailure,
      } = await supabase
        .from("online_booking_closures")
        .select("booking_date")
        .gte("booking_date", firstDay)
        .lt("booking_date", nextFirstDay);

      if (!active) return;

      if (closureFailure) {
        setClosedDates(new Set());

        setClosuresError(
          "Non riesco a verificare le chiusure online."
        );

        setClosuresLoading(false);

        return;
      }

      setClosedDates(
        new Set(
          (data || [])
            .map(row => row.booking_date)
            .filter(Boolean)
        )
      );

      setClosuresLoading(false);
    }

    loadClosures();

    return () => {
      active = false;
    };
  }, [month]);

  const days =
    loading || error
      ? null
      : appointments.reduce(
          (result, booking) => {
            const status =
              bookingStatus(
                booking.status
              );

            if (
              COUNTED_STATUSES.has(status)
              && booking.booking_date
                ?.startsWith(month)
            ) {
              const day =
                result[
                  booking.booking_date
                ] ||= {
                  covers: 0,
                };

              day.covers +=
                Number(
                  booking.party_size
                ) || 0;
            }

            return result;
          },
          {}
        );

  return (
    <main className="booking-admin calendar-page">
      <div className="agenda-heading">
        <div>
          <p className="agenda-eyebrow">
            Agenda prenotazioni
          </p>

          <h1>Calendario</h1>
        </div>
      </div>

      <section
        className="calendar-panel"
        aria-label="Calendario mensile"
      >
        <div className="calendar-toolbar">
          <div className="calendar-month-nav">
            {previous && (
              <a
                className="admin-button calendar-arrow"
                href={`?month=${previous}`}
                aria-label="Mese precedente"
              >
                ←
              </a>
            )}

            <h2>
              {monthLabel(month)}
            </h2>

            {next && (
              <a
                className="admin-button calendar-arrow"
                href={`?month=${next}`}
                aria-label="Mese successivo"
              >
                →
              </a>
            )}
          </div>
        </div>

        {error && (
          <div
            className="calendar-error"
            role="alert"
          >
            {error}
          </div>
        )}

        {closuresError && (
          <div
            className="calendar-error"
            role="alert"
          >
            {closuresError}
          </div>
        )}

        <div
          className="calendar-weekdays"
          aria-hidden="true"
        >
          {weekdays.map(day => (
            <span key={day}>
              {day}
            </span>
          ))}
        </div>

        <div
          className="calendar-grid"
          aria-busy={
            loading
            || closuresLoading
          }
        >
          {calendarCells(month).map(
            (date, index) => {
              if (!date) {
                return (
                  <div
                    key={`blank-${index}`}
                    className="calendar-blank"
                    aria-hidden="true"
                  />
                );
              }

              const covers =
                days
                  ? days[date]
                      ?.covers ?? 0
                  : null;

              const current =
                date === today;

              const closed =
                closedDates.has(date);

              const className = [
                "calendar-day",
                current
                  ? "is-today"
                  : "",
                covers > 0
                  ? "has-bookings"
                  : "",
                closed
                  ? "is-closed"
                  : "",
              ]
                .filter(Boolean)
                .join(" ");

              const coverLabel =
                covers === null
                  ? "coperti non disponibili"
                  : `${covers} coperti`;

              const onlineLabel =
                closuresLoading
                  ? "stato prenotazioni online da verificare"
                  : closed
                    ? "prenotazioni online chiuse"
                    : "prenotazioni online aperte";

              return (
                <a
                  key={date}
                  href={`/prenotazioni/giorno?date=${date}`}
                  className={
                    className
                  }
                  aria-current={
                    current
                      ? "date"
                      : undefined
                  }
                  aria-label={`${dayLabel(date)}${current ? ", oggi" : ""}: ${coverLabel}, ${onlineLabel}`}
                >
                  <span className="calendar-day-number">
                    {Number(
                      date.slice(-2)
                    )}

                    {current && (
                      <small>
                        Oggi
                      </small>
                    )}
                  </span>

                  <span className="calendar-covers">
                    <strong>
                      {covers === null
                        ? "—"
                        : covers}
                    </strong>

                    <span>
                      coperti
                    </span>
                  </span>

                  {closed && (
                    <span className="calendar-closed-label">
                      CHIUSO
                    </span>
                  )}
                </a>
              );
            }
          )}
        </div>

        <p className="calendar-hint">
          Seleziona un giorno per
          aprire le prenotazioni.
        </p>
      </section>
    </main>
  );
}