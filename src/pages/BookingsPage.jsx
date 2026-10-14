import BookingOperationalControls from '../components/BookingOperationalControls';
import { bookingScheduledAt } from '../utils/bookingTime';
import BookingNoShowAction from '../components/BookingNoShowAction';
import OnlineDopocenaRequests from '../components/OnlineDopocenaRequests';

import { adminFetch } from "../lib/adminFetch";

import { useAppointments } from "../hooks/useAppointments";

import { validateManualBooking } from "../utils/bookingValidation";

import { useEffect, useRef, useState } from "react";

import { supabase } from "../lib/supabase";

import { dayLabel, isDay, shiftDay, todayInRome } from "../utils/calendar";

import { bookingCallUrl } from "../utils/bookingCall";

import {
  confirmationMessage,
} from "../utils/bookingConfirmation";

import {
  bookingStatusAction,
  bookingStatus,
  bookingStatusLabel,
} from "../utils/bookingStatus";

import { createBookingStatusUndo } from "../utils/bookingStatusUndo";

import BookingCommunications from "../components/BookingCommunications";

import BookingHistory from "../components/BookingHistory";

import BookingEditor from "../components/BookingEditor";

import { bookingDelayNotification } from "../utils/bookingDelay";

import { noShowEligibility } from "../utils/bookingNoShow";

import CustomerCard from "../components/CustomerCard";

import {
  customerAutocompleteSuggestions,
  previousCustomerNoShowCount,
} from "../utils/customerBookings";

import BookingTableControls from "../components/BookingTableControls";

import TableMap from "../components/TableMap";

import {
  BOOKING_TYPES,
  bookingTypeLabel,
} from "../utils/bookingType";

import {
  createAfterDinnerBooking,
  validateAfterDinnerBooking,
} from "../utils/afterDinnerBooking";

import { DAILY_COVER_LIMIT } from "../utils/bookingCapacity";

import tables from "../config/tables.json" with { type: "json" };
import { bookingsToCsv, formatBookingServiceDate, prepareBookingExport, BOOKING_EXPORT_COLUMNS } from "../utils/bookingExport";


function consentDate(value) {
  if (!value) return "";

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
  }).format(new Date(value));
}


function compactDayLabel(value) {
  return new Intl.DateTimeFormat(
    "it-IT",
    {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/Rome",
    }
  )
    .format(
      new Date(
        `${value}T12:00:00Z`
      )
    )
    .replace(/\./g, "");
}


export default function BookingsPage() {
  // Conservato per il successivo menu secondario;
  // non montare log/storico nel servizio.
  const showSecondaryDetails = false;

  const requested = new URLSearchParams(
    window.location.search
  ).get("date");

  const today = todayInRome();

  const date = isDay(requested)
    ? requested
    : today;


  const previousDate =
    shiftDay(date, -1);

  const nextDate =
    shiftDay(date, 1);

  const {
    appointments,
    loading,
    error: appointmentsError,
    refresh: refreshAppointments,
    applyUpdate,
  } = useAppointments('all');

  const error = appointmentsError?.message || "";

  const bookings =
    loading || appointmentsError
      ? null
      : appointments.filter(
          booking => booking.booking_date === date
        );

  const operationalBookings =
    bookings?.filter(
      booking => bookingStatus(booking.status) !== 'cancelled'
    );

  const [showCreate, setShowCreate] = useState(false);

  const [customerSearch, setCustomerSearch] = useState("");

  const [saving, setSaving] = useState(false);

  const [fieldErrors, setFieldErrors] = useState({});

  const [createError, setCreateError] = useState("");

  const [createSuccess, setCreateSuccess] = useState("");

  const [createType, setCreateType] = useState('normale');

  const [consentEditorId, setConsentEditorId] =
    useState(null);

  const [consentSaving, setConsentSaving] =
    useState(false);

  const [consentError, setConsentError] =
    useState("");

  const [statusSavingId, setStatusSavingId] =
    useState(null);

  const [statusError, setStatusError] =
    useState(null);

  const statusChangePending = useRef(false);

  const statusUndoSession = useRef(null);

  if (!statusUndoSession.current) {
    statusUndoSession.current =
      createBookingStatusUndo();
  }

  const [statusFeedback, setStatusFeedback] =
    useState(null);

  const [undoError, setUndoError] =
    useState("");

  const [editingId, setEditingId] =
    useState(null);

  const [editingDirty, setEditingDirty] =
    useState(false);

  const [editFeedback, setEditFeedback] =
    useState(null);

  const [requestRevision, setRequestRevision] =
    useState(0);

  const [
    assignmentBookingId,
    setAssignmentBookingId,
  ] = useState(() => {
    const id = new URLSearchParams(
      window.location.search
    ).get('assign');

    return /^[1-9]\d*$/.test(id || '')
      ? id
      : null;
  });

  const [viewMode, setViewMode] =
    useState(() => {
      const params = new URLSearchParams(
        window.location.search
      );

      return (
        params.get('view') === 'map'
        || /^[1-9]\d*$/.test(
          params.get('assign') || ''
        )
      )
        ? 'map'
        : 'list';
    });

  const [
    detailBookingId,
    setDetailBookingId,
  ] = useState(null);

  const [mapSaving, setMapSaving] =
    useState(false);

  const [now, setNow] =
    useState(Date.now);

  const focusedBooking = useRef(null);


  useEffect(() => {
    let timer;

    const timeout = window.setTimeout(() => {
      setNow(Date.now());

      timer = window.setInterval(
        () => setNow(Date.now()),
        60000
      );
    }, 60000 - (Date.now() % 60000));

    return () => {
      window.clearTimeout(timeout);

      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, []);


  useEffect(() => {
    if (
      editingId !== null
      && !appointments.some(
        booking => booking.id === editingId
      )
    ) {
      setEditingId(null);
    }
  }, [appointments, editingId]);


  useEffect(() => {
    if (
      detailBookingId === null
      || !operationalBookings
    ) {
      return;
    }

    if (
      !operationalBookings.some(
        booking =>
          String(booking.id)
          === String(detailBookingId)
      )
    ) {
      setDetailBookingId(null);
    }
  }, [operationalBookings, detailBookingId]);


  useEffect(() => {
    if (detailBookingId === null) {
      return;
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        setDetailBookingId(null);
      }
    }

    document.addEventListener(
      'keydown',
      onKey
    );

    return () =>
      document.removeEventListener(
        'keydown',
        onKey
      );
  }, [detailBookingId]);


  useEffect(() => {
    if (loading) return;

    function focusBooking() {
      if (
        !/^#booking-[1-9]\d*$/.test(
          window.location.hash
        )
      ) {
        return;
      }

      if (viewMode !== 'list') {
        return;
      }

      const row = document.getElementById(
        window.location.hash.slice(1)
      );

      if (!row) {
        return;
      }

      if (focusedBooking.current === row) {
        return;
      }

      focusedBooking.current = row;

      row.scrollIntoView({
        block: 'center',
      });

      row.focus({
        preventScroll: true,
      });
    }

    focusBooking();

    window.addEventListener(
      'hashchange',
      focusBooking
    );

    return () =>
      window.removeEventListener(
        'hashchange',
        focusBooking
      );
  }, [
    loading,
    date,
    assignmentBookingId,
    appointments,
    viewMode,
  ]);


  const [onlineClosed, setOnlineClosed] =
    useState(null);

  const [
    closureSaving,
    setClosureSaving,
  ] = useState(false);

  const [closureError, setClosureError] =
    useState("");


  useEffect(() => {
    let active = true;

    setOnlineClosed(null);

    setClosureError("");

    supabase
      .from("online_booking_closures")
      .select("booking_date")
      .eq("booking_date", date)
      .then(({ data, error }) => {
        if (!active) return;

        if (error) {
          setClosureError(
            "Non riesco a verificare la chiusura online. Ricarica la pagina."
          );
        } else {
          setOnlineClosed(data.length > 0);
        }
      });

    return () => {
      active = false;
    };
  }, [date]);


  async function toggleOnlineBookings() {
    if (
      closureSaving
      || onlineClosed === null
    ) {
      return;
    }

    setClosureSaving(true);

    setClosureError("");

    try {
      const { error } = onlineClosed
        ? await supabase
            .from(
              "online_booking_closures"
            )
            .delete()
            .eq("booking_date", date)
        : await supabase
            .from(
              "online_booking_closures"
            )
            .insert({
              booking_date: date,
            });

      if (
        error
        && error.code !== "23505"
      ) {
        throw error;
      }

      const {
        data,
        error: readError,
      } = await supabase
        .from(
          "online_booking_closures"
        )
        .select("booking_date")
        .eq("booking_date", date);

      if (readError) {
        throw readError;
      }

      setOnlineClosed(
        data.length > 0
      );
    } catch {
      setClosureError(
        "Modifica non confermata. Ricarica la pagina per verificare lo stato e riprova."
      );

      setOnlineClosed(null);
    } finally {
      setClosureSaving(false);
    }
  }


  async function createBooking(event) {
    event.preventDefault();

    if (saving) return;

    const form =
      event.currentTarget;

    const fields =
      new FormData(form);

    const rawValues =
      Object.fromEntries(fields);

    const values = {
      name: rawValues.name,
      phone: rawValues.phone,
      email: rawValues.email,
      time: rawValues.time,
      party_size:
        rawValues.party_size,
      notes: rawValues.notes,
      table: rawValues.table,
      date,
    };

    const validation =
      createType === 'dopocena'
        ? validateAfterDinnerBooking(
            values
          )
        : validateManualBooking(values, { requirePhone: false });

    setFieldErrors(
      validation.errors
    );

    setCreateError("");

    setCreateSuccess("");

    if (
      Object.keys(
        validation.errors
      ).length
    ) {
      form.elements
        .namedItem(
          Object.keys(
            validation.errors
          )[0]
        )
        ?.focus();

      return;
    }

    setSaving(true);

    setCreateError("");

    setCreateSuccess("");

    try {
      if (
        createType === 'dopocena'
      ) {
        await createAfterDinnerBooking(
          supabase,
          values
        );

        form.reset();

        setCustomerSearch("");

        setCreateType(
          'normale'
        );

        setCreateSuccess(
          "Prenotazione dopocena aggiunta all’agenda."
        );

        refreshAppointments();

        return;
      }

      const response =
        await adminFetch(
          "/api/admin/bookings",
          {
            method: "POST",
            credentials:
              "same-origin",
            headers: {
              "Content-Type":
                "application/json",
              "X-Admin-Request":
                "1",
            },
            body: JSON.stringify(
              validation.data
            ),
          }
        );

      if (
        response.status === 401
      ) {
        window.location.replace(
          "/"
        );

        return;
      }

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        const detail =
          typeof data.detail
            === "string"
            ? data.detail
            : "Controlla i campi della prenotazione e riprova.";

        throw new Error(
          detail
        );
      }

      const createdId =
        data.id
        ?? data.booking_id
        ?? data.booking?.id;

      let activityWarning = "";

      if (createdId) {
        const {
          error:
            activityError,
        } =
          await supabase.rpc(
            "admin_record_booking_creation",
            {
              p_booking_id:
                createdId,
            }
          );

        if (activityError) {
          activityWarning =
            " La prenotazione è salvata, ma l’attività non è stata registrata: verifica il SQL dell’activity log.";
        }
      } else {
        activityWarning =
          " La prenotazione è salvata, ma il backend non ha restituito l’ID per registrare l’attività.";
      }

      form.reset();

      setCustomerSearch("");

      setCreateSuccess(
        `Prenotazione aggiunta.${activityWarning}`
      );

      refreshAppointments();
    } catch (failure) {
      setCreateError(
        failure.message
        || "Connessione non disponibile."
      );
    } finally {
      setSaving(false);
    }
  }


  async function registerConsent(
    event,
    bookingId
  ) {
    event.preventDefault();

    const fields =
      new FormData(
        event.currentTarget
      );

    setConsentSaving(true);

    setConsentError("");

    try {
      const response =
        await adminFetch(
          `/api/admin/bookings/${bookingId}/marketing-consent`,
          {
            method: "POST",
            credentials:
              "same-origin",
            headers: {
              "Content-Type":
                "application/json",
              "X-Admin-Request":
                "1",
            },
            body: JSON.stringify({
              channel:
                fields.get(
                  "channel"
                ),
              response_text:
                fields.get(
                  "response_text"
                ),
            }),
          }
        );

      if (
        response.status === 401
      ) {
        window.location.replace(
          "/"
        );

        return;
      }

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.detail
          || "Consenso non salvato."
        );
      }

      setConsentEditorId(null);

      refreshAppointments();
    } catch (failure) {
      setConsentError(
        failure.message
        || "Connessione non disponibile."
      );
    } finally {
      setConsentSaving(false);
    }
  }


  async function revokeConsent(
    bookingId
  ) {
    if (
      !window.confirm(
        "Confermi la revoca del consenso marketing?"
      )
    ) {
      return;
    }

    setConsentSaving(true);

    setConsentError("");

    try {
      const response =
        await adminFetch(
          `/api/admin/bookings/${bookingId}/marketing-consent/revoke`,
          {
            method: "POST",
            credentials:
              "same-origin",
            headers: {
              "X-Admin-Request":
                "1",
            },
          }
        );

      if (
        response.status === 401
      ) {
        window.location.replace(
          "/"
        );

        return;
      }

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.detail
          || "Revoca non salvata."
        );
      }

      refreshAppointments();
    } catch (failure) {
      setConsentError(
        failure.message
        || "Connessione non disponibile."
      );
    } finally {
      setConsentSaving(false);
    }
  }


  async function changeStatus(
    booking,
    status
  ) {
    if (
      statusChangePending.current
      || statusSavingId !== null
      || editingId !== null
      || mapSaving
      || status ===
        bookingStatus(
          booking.status
        )
    ) {
      return;
    }

    if (status === 'no_show') {
      const eligibility =
        noShowEligibility(
          booking,
          now
        );

      if (
        !eligibility.allowed
      ) {
        setStatusError({
          bookingId:
            booking.id,
          message:
            eligibility.message,
        });

        return;
      }

      if (
        !window.confirm(
          `Confermi che ${booking.name} non si è presentato alla prenotazione del ${booking.booking_date} alle ${booking.booking_time.slice(0, 5)}?\n\nLo stato diventerà “No-show”. La prenotazione resterà conservata nel database e nello storico.`
        )
      ) {
        return;
      }
    }

    if (
      status === 'cancelled'
      && !window.confirm(
        `Confermi la cancellazione della prenotazione di ${booking.name} del ${booking.booking_date} alle ${booking.booking_time.slice(0, 5)}?\n\nLo stato diventerà “Cancellata”. La prenotazione resterà conservata nel database e nello storico.`
      )
    ) {
      return;
    }

    statusChangePending.current =
      true;

    setStatusSavingId(
      booking.id
    );

    setStatusError(null);

    try {
      const result =
        await statusUndoSession
          .current
          .change(
            supabase,
            booking,
            status
          );

      if (!result) return;

      applyUpdate({
        id: booking.id,
        status: result.status,
        ...(result.tables !== undefined ? { tables: result.tables } : {}),
      });

      setStatusFeedback(
        statusUndoSession
          .current
          .getLast()
      );

      setUndoError("");

      refreshAppointments();
    } catch (failure) {
      setStatusError({
        bookingId: booking.id,
        message:
          failure.message
          || "Connessione non disponibile.",
      });
    } finally {
      statusChangePending.current =
        false;

      setStatusSavingId(null);
    }
  }


  async function undoStatus() {
    if (
      !statusFeedback
      || statusSavingId !== null
      || editingId !== null
      || loading
      || appointmentsError
    ) {
      return;
    }

    setStatusSavingId(
      statusFeedback.bookingId
    );

    setUndoError("");

    try {
      const booking =
        appointments.find(
          item =>
            String(item.id)
            === String(
              statusFeedback.bookingId
            )
        );

      const result =
        await statusUndoSession
          .current
          .undo(
            supabase,
            booking
          );

      if (result) {
        applyUpdate({
          id:
            result.booking_id,
          status:
            result.status,
        });
      }

      setStatusFeedback(
        statusUndoSession
          .current
          .getLast()
      );
    } catch (failure) {
      setStatusFeedback(
        statusUndoSession
          .current
          .getLast()
      );

      setUndoError(
        failure.message
        || "Ripristino non confermato. Aggiorna e riprova."
      );
    } finally {
      refreshAppointments();

      setStatusSavingId(null);
    }
  }


  const covers =
    bookings
      ?.filter(
        booking =>
          bookingStatus(
            booking.status
          ) === "confirmed"
      )
      .reduce(
        (
          sum,
          booking
        ) =>
          sum
          + booking.party_size,
        0
      );


  const assignmentBooking =
    operationalBookings?.find(
      booking =>
        String(booking.id)
        === String(
          assignmentBookingId
        )
    );


  const detailBooking =
    operationalBookings?.find(
      booking =>
        String(booking.id)
        === String(
          detailBookingId
        )
    );


  const visibleBookings = operationalBookings || [];
  const exportRows = prepareBookingExport(appointments, date);
  const exportReady = !loading && !appointmentsError && bookings !== null;
  const exportDateLabel = formatBookingServiceDate(date);

  function printBookings() {
    if (!exportReady) return;
    window.print();
  }

  function downloadBookingsCsv() {
    if (!exportReady) return;
    const file = new Blob([bookingsToCsv(exportRows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `prenotazioni-${date}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const unassignedCount = visibleBookings.filter(
    booking => !String(booking.tables || '').trim()
      && ['confirmed', 'arrived'].includes(bookingStatus(booking.status))
  ).length;


  const timeGroups =
    Object.entries(
      visibleBookings.reduce(
        (
          groups,
          booking
        ) => {
          const time =
            booking.booking_time.slice(
              0,
              5
            );

          (
            groups[time] ||= []
          ).push(booking);

          return groups;
        },
        {}
      )
    ).sort(
      ([first], [second]) =>
        (first === "00:00" ? "24:00" : first).localeCompare(second === "00:00" ? "24:00" : second)
    );


  function returnToBooking(
    booking
  ) {
    setAssignmentBookingId(null);

    setViewMode('list');

    const params =
      new URLSearchParams(
        window.location.search
      );

    params.delete('assign');

    params.delete('view');

    const query =
      params.toString();

    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}#booking-${booking.id}`
    );
  }


  const viewBusy =
    statusSavingId !== null
    || editingId !== null
    || mapSaving;

  const dayNavigationBusy =
    viewBusy
    || saving
    || consentSaving
    || closureSaving
    || Boolean(assignmentBooking);


  function dayHref(target) {
    const params = new URLSearchParams({
      date: target,
    });

    if (viewMode === 'map') {
      params.set('view', 'map');
    }

    return `/prenotazioni/giorno?${params.toString()}`;
  }


  function guardDayNavigation(event) {
    if (dayNavigationBusy) {
      event.preventDefault();
    }
  }


  function selectView(mode) {
    if (
      viewBusy
      || assignmentBooking
    ) {
      return;
    }

    setViewMode(mode);

    const params =
      new URLSearchParams(
        window.location.search
      );

    if (mode === 'map') {
      params.set(
        'view',
        'map'
      );
    } else {
      params.delete('view');
    }

    const query =
      params.toString();

    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    );
  }


  function openAssignmentMap(
    booking
  ) {
    setDetailBookingId(null);

    setAssignmentBookingId(
      booking.id
    );

    setViewMode('map');
  }


  function openBookingDetail(
    booking
  ) {
    if (
      viewBusy
      || assignmentBooking
    ) {
      return;
    }

    setDetailBookingId(
      booking.id
    );
  }


  function closeBookingDetail() {
    if (editingDirty && !window.confirm('Chiudere e scartare le modifiche non salvate?')) return;
    setEditingDirty(false);
    setEditingId(null);
    setDetailBookingId(null);
  }


  function bookingDetailContent(
    booking
  ) {
    const statusAction =
      bookingStatusAction(
        booking.status
      );

    const editing =
      editingId === booking.id;

    const confirmed =
      bookingStatus(
        booking.status
      ) === "confirmed";

    const delayNotification =
      bookingDelayNotification(
        booking,
        now
      );

    const previousNoShows =
      previousCustomerNoShowCount(
        booking,
        appointments,
        now
      );

    return (
      <div className={`booking-card-content booking-detail-content${editing ? ' is-editing' : ' is-viewing'}`}>
        {!editing && <section
          className="booking-detail-overview"
          aria-label="Riepilogo prenotazione"
        >
          <div className="booking-detail-overview-main">
            <strong className="booking-detail-time">
              {booking.booking_time.slice(
                0,
                5
              )}
            </strong>

            <span>
              {booking.party_size}{' '}
              {booking.party_size === 1
                ? 'persona'
                : 'persone'}
            </span>

            <span
              className={
                `booking-status status-${bookingStatus(
                  booking.status
                )}`
              }
            >
              {bookingStatusLabel(
                booking.status
              )}
            </span>
          </div>

          <div className="booking-detail-overview-secondary">
            <span>
              {dayLabel(
                booking.booking_date
              )}
            </span>

            <span aria-hidden="true">
              ·
            </span>

            <span className="booking-detail-table-label">
              {String(
                booking.tables || ''
              ).trim()
                ? `Tavolo ${booking.tables}`
                : 'Senza tavolo'}
            </span>
          </div>
        </section>}

        {!editing && <BookingOperationalControls booking={booking} disabled={statusSavingId !== null || editingId !== null} onChanged={item => {applyUpdate(item);refreshAppointments();}} />}
        <div
          className="booking-primary-actions"
          aria-label="Azioni rapide prenotazione"
        >
          {!editing && statusAction && (
            <div className="booking-primary-action-slot is-status">
              <button
                type="button"
                className="admin-button booking-detail-primary booking-icon-action booking-status-icon"
                disabled={statusSavingId !== null || editingId !== null || (statusAction.status === 'arrived' && booking.booking_type === 'dopocena' && bookingScheduledAt(booking) > now)}
                aria-label={statusAction.label}
                title={statusAction.label}
                onClick={() => changeStatus(booking, statusAction.status)}
              >
                <span className="booking-action-icon" aria-hidden="true">✓</span>
                <span>{statusAction.label}</span>
              </button>
            </div>
          )}

          {!editing && <div className="booking-primary-action-slot is-table">
            <BookingTableControls
              booking={booking}
              appointments={appointments}
              compact
              showLabel
              disabled={statusSavingId !== null || editingId !== null}
              onOpenMap={() => openAssignmentMap(booking)}
              onSaving={saving => setEditingId(saving ? booking.id : null)}
              onSaved={result => {
                applyUpdate(result.booking);
                setRequestRevision(value => value + 1);
                window.dispatchEvent(new Event('admin-notifications-changed'));
              }}
            />
          </div>}

          {!editing && bookingCallUrl(booking.phone) && <div className="booking-primary-action-slot is-contacts">
            <BookingCommunications booking={booking} compact />
          </div>}

          <div className="booking-primary-action-slot is-edit" key="booking-editor-slot">
            <BookingEditor
              booking={booking}
              appointments={appointments}
              hideTableField
              disabled={statusSavingId !== null || (editingId !== null && editingId !== booking.id)}
              onEditing={open => {
                setEditingDirty(false);
                setEditingId(open ? booking.id : null);
              }}
              onDirtyChange={setEditingDirty}
              onSaved={result => {
                setEditingDirty(false);
                setEditingId(null);
                applyUpdate(result.booking);
                setEditFeedback({ date: result.booking.booking_date });
              }}
            />
          </div>

          {!editing && statusSavingId
            === booking.id && (
            <span
              className="booking-action-saving"
              role="status"
            >
              Salvataggio…
            </span>
          )}
        </div>

        {!editing && booking.notes && (
          <p className="booking-detail-notes">
            <strong>Note</strong>
            <span>{booking.notes}</span>
          </p>
        )}

        {!editing && <div
          className="booking-secondary-actions"
          aria-label="Azioni secondarie prenotazione"
        >
          <BookingNoShowAction
            booking={booking}
            now={now}
            disabled={
              statusSavingId !== null
              || editingId !== null
              || mapSaving
            }
            onNoShow={item => changeStatus(item, 'no_show')}
          />

          {bookingStatus(booking.status) !== 'cancelled' && (
          <button
            className="admin-button admin-button-secondary booking-action-danger"
            type="button"
            disabled={
              statusSavingId !== null
              || editingId !== null
            }
            onClick={() =>
              changeStatus(
                booking,
                'cancelled'
              )
            }
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6" /></svg>
            Cancella prenotazione
          </button>
          )}
        </div>}

        {!editing && statusError
          ?.bookingId
          === booking.id && (
          <p
            className="manual-booking-feedback is-error"
            role="alert"
          >
            {statusError.message}
          </p>
        )}

        {!editing && previousNoShows > 0 && (
          <p
            className="booking-customer-warning"
            role="status"
          >
            Cliente con{' '}
            <strong>
              {previousNoShows}
            </strong>{' '}
            {previousNoShows === 1
              ? 'precedente'
              : 'precedenti'}{' '}
            NO_SHOW
          </p>
        )}

        {!editing && delayNotification && (
          <p
            className="booking-delay-notification"
            role="status"
          >
            {
              delayNotification.message
            }
          </p>
        )}

        {showSecondaryDetails && (
          <>
            <CustomerCard
              booking={booking}
              appointments={
                appointments
              }
              now={now}
            />

            {booking.arrived_at && (
              <p>
                Arrivo registrato:{' '}
                {consentDate(
                  booking.arrived_at
                )}.
                {booking
                  .marketing_consent_active
                  ? ` Visite registrate con consenso: ${booking.marketing_visit_count}.`
                  : " Nessun conteggio personale attivo senza consenso marketing."}
              </p>
            )}

            {confirmed && (
              <>
                <p className="booking-confirmation-preview">
                  {confirmationMessage(
                    booking,
                    "whatsapp"
                  )}
                </p>

                <small>
                  Usa Comunicazioni
                  e log per inviare
                  l’email o aprire
                  la chat WhatsApp.
                </small>
              </>
            )}

            {booking.source
              === "agenda"
              && confirmed && (
              <div className="marketing-consent-panel">
                {booking
                  .marketing_consent_active
                  ? (
                    <p className="marketing-consent-status is-active">
                      Consenso marketing
                      attivo fino al{' '}
                      {consentDate(
                        booking
                          .marketing_expires_at
                      )}.
                    </p>
                  )
                  : (
                    <p className="marketing-consent-status">
                      {booking
                        .marketing_revoked_at
                        ? `Consenso revocato il ${consentDate(booking.marketing_revoked_at)}.`
                        : booking
                          .marketing_expires_at
                          ? `Consenso scaduto il ${consentDate(booking.marketing_expires_at)}.`
                          : "Nessun consenso marketing registrato."}
                    </p>
                  )}

                <div className="marketing-consent-actions">
                  <button
                    className="admin-button"
                    type="button"
                    disabled={
                      consentSaving
                    }
                    onClick={() => {
                      setConsentError(
                        ""
                      );

                      setConsentEditorId(
                        booking.id
                      );
                    }}
                  >
                    {booking
                      .marketing_consent_active
                      ? "Registra nuovo consenso"
                      : "Registra risposta positiva"}
                  </button>

                  {booking
                    .marketing_consent_active
                    && (
                    <button
                      className="admin-button admin-button-secondary"
                      type="button"
                      disabled={
                        consentSaving
                      }
                      onClick={() =>
                        revokeConsent(
                          booking.id
                        )
                      }
                    >
                      Revoca
                    </button>
                  )}
                </div>

                {consentEditorId
                  === booking.id && (
                  <form
                    className="marketing-consent-form"
                    onSubmit={
                      event =>
                        registerConsent(
                          event,
                          booking.id
                        )
                    }
                  >
                    <p>
                      Usa questo comando
                      soltanto dopo una
                      risposta positiva
                      e inequivocabile
                      del cliente. Una
                      nuova registrazione
                      fa ripartire i
                      24 mesi.
                    </p>

                    <label>
                      Canale
                      <select
                        name="channel"
                        defaultValue="whatsapp"
                      >
                        <option value="whatsapp">
                          WhatsApp
                        </option>

                        <option value="telefono">
                          Telefono
                        </option>

                        <option value="email">
                          Email
                        </option>
                      </select>
                    </label>

                    <label>
                      Risposta del cliente
                      <input
                        name="response_text"
                        required
                        maxLength="200"
                        placeholder="Es. Sì oppure Confermo"
                      />
                    </label>

                    <div className="marketing-consent-actions">
                      <button
                        className="admin-button"
                        type="submit"
                        disabled={
                          consentSaving
                        }
                      >
                        {consentSaving
                          ? "Salvataggio…"
                          : "Salva consenso"}
                      </button>

                      <button
                        className="admin-button admin-button-secondary"
                        type="button"
                        onClick={() =>
                          setConsentEditorId(
                            null
                          )
                        }
                      >
                        Annulla
                      </button>
                    </div>

                    {consentError && (
                      <p
                        className="manual-booking-feedback is-error"
                        role="alert"
                      >
                        {
                          consentError
                        }
                      </p>
                    )}
                  </form>
                )}
              </div>
            )}

            <BookingHistory
              bookingId={
                booking.id
              }
              revision={
                JSON.stringify([
                  requestRevision,
                  booking.status,
                  booking.booking_date,
                  booking.booking_time,
                  booking.party_size,
                  booking.tables,
                  booking.notes,
                ])
              }
            />
          </>
        )}
      </div>
    );
  }


  const customerSuggestions =
    customerAutocompleteSuggestions(
      customerSearch,
      appointments
    );


  function selectExistingCustomer(
    event,
    customer
  ) {
    const form =
      event.currentTarget.form;

    if (!form) return;

    const nameInput =
      form.elements.namedItem(
        "name"
      );

    const phoneInput =
      form.elements.namedItem(
        "phone"
      );

    const emailInput =
      form.elements.namedItem(
        "email"
      );

    if (nameInput) {
      nameInput.value =
        customer.name;
    }

    if (phoneInput) {
      phoneInput.value =
        customer.phone;
    }

    if (emailInput) {
      emailInput.value =
        customer.email || "";
    }

    setCustomerSearch("");

    setFieldErrors({});
  }


  return (
    <main
      className={
        `booking-admin bookings-day-page${
          assignmentBooking
            ? " table-assignment-view"
            : ""
        }`
      }
    >
      <section
        className="agenda-heading agenda-sticky-header"
        aria-label="Controlli giornata"
      >
        <div className="agenda-sticky-primary">
          <nav
            className="agenda-day-navigation"
            aria-label="Cambio giorno"
          >
            <a
              className={`agenda-day-nav${dayNavigationBusy ? ' is-disabled' : ''}`}
              href={dayHref(previousDate)}
              aria-label={`Giorno precedente: ${dayLabel(previousDate)}`}
              aria-disabled={dayNavigationBusy}
              tabIndex={dayNavigationBusy ? -1 : undefined}
              onClick={guardDayNavigation}
            >
              ‹
            </a>

            <a
              className="agenda-sticky-date"
              href={`/prenotazioni?month=${date.slice(0, 7)}`}
              aria-label={`Apri il calendario di ${dayLabel(date)}`}
              aria-current={date === today ? 'date' : undefined}
              title={dayLabel(date)}
            >
              <span className="admin-sr-only">
                <time dateTime={date}>
                  {dayLabel(date)}
                </time>
              </span>

              <span
                className="agenda-sticky-date-compact"
                aria-hidden="true"
              >
                {compactDayLabel(date)}
              </span>

              {date === today && (
                <span className="agenda-today">
                  Oggi
                </span>
              )}
            </a>

            {date !== today && (
              <a
                className={`agenda-today-nav${dayNavigationBusy ? ' is-disabled' : ''}`}
                href={dayHref(today)}
                aria-label={`Torna a oggi: ${dayLabel(today)}`}
                aria-disabled={dayNavigationBusy}
                tabIndex={dayNavigationBusy ? -1 : undefined}
                onClick={guardDayNavigation}
              >
                Oggi
              </a>
            )}

            <a
              className={`agenda-day-nav${dayNavigationBusy ? ' is-disabled' : ''}`}
              href={dayHref(nextDate)}
              aria-label={`Giorno successivo: ${dayLabel(nextDate)}`}
              aria-disabled={dayNavigationBusy}
              tabIndex={dayNavigationBusy ? -1 : undefined}
              onClick={guardDayNavigation}
            >
              ›
            </a>

          </nav>

          <div
            className="agenda-sticky-summary"
            aria-live="polite"
            aria-label="Riepilogo giornata"
          >
            <div className="agenda-day-summary">
              {bookings
                ? (
                  <>
                    <strong>
                      {covers}
                    </strong>{' '}
                    coperti
                    <span aria-hidden="true">
                      {' · '}
                    </span>
                    <strong>
                      {bookings.length}
                    </strong>{' '}
                    <span className="agenda-bookings-label">
                      pren.
                    </span>
                  </>
                )
                : error
                  ? "Dati non disponibili"
                  : "Caricamento…"}
            </div>
          </div>

          <div className="agenda-online-control">
            <button
              className={
                `agenda-online-toggle${
                  onlineClosed === null
                    ? ' is-unknown'
                    : onlineClosed
                      ? ' is-closed'
                      : ' is-open'
                }`
              }
              type="button"
              aria-pressed={
                onlineClosed === null
                  ? undefined
                  : !onlineClosed
              }
              aria-describedby="online-booking-help"
              aria-busy={closureSaving}
              aria-label={
                `Prenotazioni online per ${dayLabel(date)}: ${
                  onlineClosed === null
                    ? 'stato da verificare'
                    : onlineClosed
                      ? 'chiuse. Riapri prenotazioni online'
                      : 'aperte. Chiudi prenotazioni online'
                }`
              }
              disabled={
                closureSaving
                || onlineClosed === null
              }
              onClick={toggleOnlineBookings}
            >
              <span
                className="agenda-online-dot"
                aria-hidden="true"
              />

              <span aria-live="polite">
                {closureSaving
                  ? 'Salvataggio…'
                  : onlineClosed === null
                    ? 'Da verificare'
                    : onlineClosed
                      ? 'Online chiuse'
                      : 'Online aperte'}
              </span>
            </button>

            <span
              id="online-booking-help"
              className="admin-sr-only"
            >
              Solo per la data
              selezionata. Le
              prenotazioni manuali
              restano disponibili
              e quelle già ricevute
              restano valide.
            </span>
          </div>
        </div>

        <div className="agenda-sticky-secondary">
          <div
            className="agenda-view-switch"
            role="group"
            aria-label="Visualizzazione giornata"
          >
            <button
              type="button"
              aria-pressed={
                viewMode === 'list'
              }
              aria-controls="agenda-list"
              disabled={
                viewBusy
                || Boolean(
                  assignmentBooking
                )
              }
              onClick={() =>
                selectView('list')
              }
            >
              ELENCO
            </button>

            <button
              type="button"
              aria-pressed={
                viewMode === 'map'
              }
              aria-controls="agenda-map"
              disabled={
                viewBusy
                || Boolean(
                  assignmentBooking
                )
              }
              onClick={() =>
                selectView('map')
              }
            >
              MAPPA
            </button>
          </div>

          <button
            className="admin-button mobile-primary-action agenda-create-compact"
            type="button"
            aria-expanded={showCreate}
            aria-controls="manual-booking-form"
            aria-label={
              showCreate
                ? "Chiudi nuova prenotazione"
                : "Nuova prenotazione"
            }
            disabled={
              viewBusy
              || Boolean(
                assignmentBooking
              )
            }
            onClick={() => {
              setShowCreate(
                value => !value
              );

              setCustomerSearch("");
            }}
          >
            <span aria-hidden="true">
              {showCreate ? "×" : "+"}
            </span>

              <span className="agenda-create-text">
              {showCreate
                ? "Chiudi"
                : "Nuova prenotazione"}
            </span>
          </button>
        </div>
      </section>

      {!assignmentBooking && <OnlineDopocenaRequests
        disabled={viewBusy || loading || Boolean(appointmentsError)}
        onChanged={refreshAppointments}
      />}

      {closureError && (
        <p
          className="agenda-closure-error"
          role="alert"
        >
          {closureError}
        </p>
      )}

      {showCreate
        && !assignmentBooking && (
        <form
          id="manual-booking-form"
          className="booking-admin-form manual-booking-form"
          noValidate
          onSubmit={createBooking}
        >
          <div className="manual-booking-heading">
            <h2>
              Inserisci prenotazione telefonica
            </h2>

            <p>
              La conferma email
              e la chat WhatsApp
              manuale sono
              disponibili in
              Comunicazioni e log.
            </p>
          </div>

          <label>
            Tipo prenotazione

            <select
              name="booking_type"
              value={createType}
              onChange={
                event => {
                  setCreateType(
                    event.target.value
                  );

                  setFieldErrors(
                    {}
                  );
                }
              }
            >
              {Object.entries(
                BOOKING_TYPES
              ).map(
                ([
                  value,
                  label,
                ]) => (
                  <option
                    key={value}
                    value={value}
                  >
                    {label}
                  </option>
                )
              )}
            </select>
          </label>

          <div className="manual-booking-customer-field">
            <label>
              Nome e cognome

              <input
                name="name"
                aria-invalid={
                  Boolean(
                    fieldErrors.name
                  )
                }
                aria-describedby={
                  fieldErrors.name
                    ? "error-name"
                    : customerSuggestions.length
                      ? "customer-autocomplete-help"
                      : undefined
                }
                aria-autocomplete="list"
                aria-controls="customer-autocomplete-list"
                required
                minLength="2"
                maxLength="60"
                autoComplete="off"
                onChange={
                  event => {
                    setCustomerSearch(
                      event.target.value
                    );
                  }
                }
              />

              {fieldErrors.name && (
                <small
                  className="field-error"
                  id="error-name"
                >
                  {fieldErrors.name}
                </small>
              )}
            </label>

            {customerSuggestions
              .length > 0 && (
              <div
                className="customer-autocomplete"
                id="customer-autocomplete-list"
                role="listbox"
                aria-label="Clienti già presenti"
              >
                <small
                  id="customer-autocomplete-help"
                  className="customer-autocomplete-label"
                >
                  Cliente già presente?
                </small>

                {customerSuggestions.map(
                  customer => (
                    <button
                      key={
                        `${customer.userId || customer.phone}-${customer.id}`
                      }
                      className="customer-autocomplete-option"
                      type="button"
                      role="option"
                      onClick={
                        event =>
                          selectExistingCustomer(
                            event,
                            customer
                          )
                      }
                    >
                      <strong>
                        {customer.name}
                      </strong>

                      <span>
                        {customer.phone}
                        {customer.email
                          ? ` · ${customer.email}`
                          : ""}
                      </span>
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          <label>
            Telefono

            <input
              name="phone"
              aria-invalid={
                Boolean(
                  fieldErrors.phone
                )
              }
              aria-describedby={
                fieldErrors.phone
                  ? "error-phone"
                  : undefined
              }
              minLength="8"
              maxLength="30"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+39…"
            />

            {fieldErrors.phone && (
              <small
                className="field-error"
                id="error-phone"
              >
                {fieldErrors.phone}
              </small>
            )}
          </label>

          <label>
            Email facoltativa

            <input
              name="email"
              aria-invalid={
                Boolean(
                  fieldErrors.email
                )
              }
              aria-describedby={
                fieldErrors.email
                  ? "error-email"
                  : undefined
              }
              type="email"
              maxLength="120"
              autoComplete="email"
            />

            {fieldErrors.email && (
              <small
                className="field-error"
                id="error-email"
              >
                {fieldErrors.email}
              </small>
            )}
          </label>

          <label>
            Ora

            <input name="time" type="time" required step="60" aria-invalid={Boolean(fieldErrors.time)} />

            {fieldErrors.time && (
              <small
                className="field-error"
                id="error-time"
              >
                {fieldErrors.time}
              </small>
            )}
          </label>

          <label>
            Persone

            <input
              name="party_size"
              aria-invalid={
                Boolean(
                  fieldErrors.party_size
                )
              }
              aria-describedby={
                fieldErrors.party_size
                  ? "error-party_size"
                  : undefined
              }
              type="number"
              required
              min="1"
              inputMode="numeric"
            />

            {fieldErrors.party_size && (
              <small
                className="field-error"
                id="error-party_size"
              >
                {
                  fieldErrors.party_size
                }
              </small>
            )}
          </label>

          <label className="manual-booking-notes">
            Note facoltative

            <textarea
              name="notes"
              aria-invalid={
                Boolean(
                  fieldErrors.notes
                )
              }
              aria-describedby={
                fieldErrors.notes
                  ? "error-notes"
                  : undefined
              }
              maxLength="300"
              rows="3"
              placeholder="Es. compleanno, seggiolone, richieste…"
            />

            {fieldErrors.notes && (
              <small
                className="field-error"
                id="error-notes"
              >
                {fieldErrors.notes}
              </small>
            )}
          </label>

          <button
            className="admin-button"
            type="submit"
            disabled={saving}
          >
            {saving
              ? "Salvataggio…"
              : "Aggiungi all’agenda"}
          </button>

          {fieldErrors.date && (
            <p
              className="manual-booking-feedback is-error"
              role="alert"
            >
              {fieldErrors.date}
            </p>
          )}

          {createError && (
            <p
              className="manual-booking-feedback is-error"
              role="alert"
            >
              {createError}
            </p>
          )}

          {createSuccess && (
            <p
              className="manual-booking-feedback is-success"
              role="status"
            >
              {createSuccess}
            </p>
          )}
        </form>
      )}

      {error && (
        <p role="alert">
          {error}
        </p>
      )}

      {statusFeedback && (
        <div
          className="booking-status-feedback"
          role="status"
        >
          <span>
            {
              statusFeedback.name
            }:{' '}
            {statusFeedback.status
              === 'arrived'
              ? 'arrivo registrato.'
              : 'tavolo liberato.'}
          </span>

          <button
            type="button"
            className="admin-button admin-button-secondary"
            disabled={
              statusSavingId !== null
              || editingId !== null
              || loading
              || Boolean(
                appointmentsError
              )
            }
            onClick={undoStatus}
          >
            ANNULLA
          </button>
        </div>
      )}

      {undoError && (
        <p
          className="manual-booking-feedback is-error"
          role="alert"
        >
          {undoError}
        </p>
      )}

      {editFeedback && (
        <p
          className="manual-booking-feedback is-success"
          role="status"
        >
          Modifiche salvate.

          {editFeedback.date
            !== date && (
            <>
              {' '}
              <a
                href={
                  `/prenotazioni/giorno?date=${editFeedback.date}`
                }
              >
                Apri la nuova data
              </a>
            </>
          )}
        </p>
      )}

      <section
        id="agenda-list"
        className="agenda-view"
        aria-label="Elenco prenotazioni"
        hidden={
          viewMode !== 'list'
        }
      >
        {!loading && !error && (
          <p className={`agenda-unassigned-count${unassignedCount === 0 ? ' is-empty' : ''}`} role="status">
            {unassignedCount} da assegnare
          </p>
        )}
        {!loading
          && !error
          && !visibleBookings
            .length && (
            <p role="status">
              Nessuna prenotazione per questa data.
            </p>
          )}

        <div className="booking-time-groups">
          {timeGroups.map(
            ([
              time,
              group,
            ]) => (
              <section
                key={time}
                className="booking-time-group"
                aria-labelledby={
                  `time-${time}`
                }
              >
                <h2
                  id={
                    `time-${time}`
                  }
                  className="booking-time-heading"
                >
                  <time>
                    {time}
                  </time>
                  <span className="booking-time-count">
                    · {group.length} {group.length === 1 ? 'prenotazione' : 'prenotazioni'}
                  </span>
                </h2>

                <div className="booking-time-list">
                  {group.map(
                    booking => {
                      const previousNoShows =
                        previousCustomerNoShowCount(
                          booking,
                          appointments,
                          now
                        );

                      const hasNotes =
                        Boolean(
                          String(
                            booking.notes
                            || ''
                          ).trim()
                        );

                      const unassigned =
                        booking.booking_type === 'normale'
                        &&
                        !String(
                          booking.tables
                          || ''
                        ).trim()
                        && [
                          'confirmed',
                          'arrived',
                        ].includes(
                          bookingStatus(
                            booking.status
                          )
                        );

                      const isDelayed = Boolean(bookingDelayNotification(booking, now));

                      return (
                        <article
                          id={
                            `booking-${booking.id}`
                          }
                          tabIndex={-1}
                          key={
                            booking.id
                          }
                          className={
                            `booking-row booking-card-compact service-${booking.booking_type || "unknown"} status-${bookingStatus(booking.status).toLowerCase()}${
                              [
                                "cancelled",
                                "no_show",
                              ].includes(
                                bookingStatus(
                                  booking.status
                                )
                              )
                                ? " is-cancelled"
                                : ""
                            }`
                          }
                        >
                          <button
                            type="button"
                            className="booking-card-summary"
                            aria-label={
                              `Prenotazione di ${booking.name}${unassigned ? ', tavolo da assegnare' : ''}`
                            }
                            aria-haspopup="dialog"
                            aria-controls="booking-detail-drawer"
                            aria-expanded={
                              String(
                                detailBookingId
                              )
                              === String(
                                booking.id
                              )
                            }
                            disabled={
                              viewBusy
                              || Boolean(
                                assignmentBooking
                              )
                            }
                            onClick={() =>
                              openBookingDetail(
                                booking
                              )
                            }
                          >
                            <strong className="booking-card-name">
                              {
                                booking.name
                              }
                            </strong>
                            <span className="booking-card-covers">{booking.party_size} pers.</span>
                            <span className="booking-card-meta">
                              {booking.tables ? (
                                <span className="booking-card-table is-assigned" title={`Tavolo ${booking.tables}`}>Tavolo {booking.tables}</span>
                              ) : (
                                <span className="booking-card-table is-unassigned">Tavolo da assegnare</span>
                              )}
                              <span className={`booking-indicator is-status status-${bookingStatus(booking.status).toLowerCase()}`}>{bookingStatusLabel(booking.status)}</span>
                            </span>
                          </button>
                          {(hasNotes || isDelayed || previousNoShows > 0) && <div className="booking-card-quick-actions" aria-label={`Indicatori ${booking.name}`}>
                            {hasNotes && <button type="button" className="booking-indicator is-note" onClick={() => openBookingDetail(booking)}>NOTE</button>}
                            {isDelayed && <button type="button" className="booking-indicator is-delay" onClick={() => openBookingDetail(booking)}>RITARDO</button>}
                            {previousNoShows > 0 && <span className="booking-indicator is-noshow">NO_SHOW · {previousNoShows}</span>}
                          </div>}
                        </article>
                      );
                    }
                  )}
                </div>
              </section>
            )
          )}
        </div>
        <div className="booking-export-tools">
          <details className="booking-export-menu">
            <summary>Esporta / Stampa</summary>
            <div className="booking-export-actions">
              <button type="button" disabled={!exportReady} onClick={printBookings}>Stampa</button>
              <button type="button" disabled={!exportReady} onClick={downloadBookingsCsv}>Scarica CSV</button>
            </div>
          </details>
          {!exportReady && <p className="booking-export-message" role={appointmentsError ? 'alert' : 'status'}>
            {appointmentsError ? 'Esportazione non disponibile: impossibile caricare tutte le prenotazioni. Aggiorna e riprova.' : 'Esportazione disponibile al termine del caricamento.'}
          </p>}
        </div>
        <section className="booking-export-print" aria-label="Prenotazioni da stampare">
          <h1>Makai — Prenotazioni</h1>
          <p>{exportDateLabel}</p>
          <table>
            <thead><tr>{BOOKING_EXPORT_COLUMNS.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
            <tbody>{exportRows.map((row, index) => <tr key={`${row.Ora}-${index}`}>
              {BOOKING_EXPORT_COLUMNS.map(column => <td key={column}>{row[column]}</td>)}
            </tr>)}</tbody>
          </table>
        </section>
      </section>

      <section
        id="agenda-map"
        className="agenda-view"
        aria-label="Mappa tavoli della giornata"
        hidden={
          viewMode !== 'map'
        }
      >
        {viewMode === 'map'
          && statusError && (
          <p
            className="manual-booking-feedback is-error"
            role="alert"
          >
            {statusError.message}
          </p>
        )}

        {viewMode === 'map'
          && statusSavingId
            !== null && (
            <p role="status">
              Salvataggio…
            </p>
          )}

        {viewMode === 'map'
          && (
            bookings
              ? (
                <TableMap
                  key={
                    `${date}-${assignmentBooking?.id || 'overview'}`
                  }
                  appointments={
                    operationalBookings
                  }
                  date={date}
                  assignmentBooking={
                    assignmentBooking
                  }
                  disabled={
                    statusSavingId
                      !== null
                    || editingId
                      !== null
                  }
                  onSaving={
                    setMapSaving
                  }
                  now={now}
                  onNoShow={
                    item =>
                      changeStatus(
                        item,
                        'no_show'
                      )
                  }
                  onOpenAssignment={
                    openAssignmentMap
                  }
                  renderBookingDetail={
                    bookingDetailContent
                  }
                  onCreateBooking={() => {
                    setShowCreate(true);
                    setCustomerSearch("");
                  }}
                  onCancel={
                    assignmentBooking
                      ? () =>
                          returnToBooking(
                            assignmentBooking
                          )
                      : undefined
                  }
                  onSaved={
                    result => {
                      applyUpdate(
                        result.booking
                      );

                      setRequestRevision(
                        value =>
                          value + 1
                      );

                      window.dispatchEvent(
                        new Event(
                          'admin-notifications-changed'
                        )
                      );

                      if (
                        assignmentBooking
                      ) {
                        returnToBooking(
                          result.booking
                        );
                      }
                    }
                  }
                />
              )
              : (
                <p role="status">
                  {error
                    ? 'Mappa non disponibile: aggiorna le prenotazioni.'
                    : 'Caricamento mappa…'}
                </p>
              )
          )}
      </section>

      {detailBooking && (
        <div
          className="booking-detail-overlay"
          onClick={
            closeBookingDetail
          }
        >
          <aside
            id="booking-detail-drawer"
            className="booking-detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-detail-title"
            onClick={
              event =>
                event.stopPropagation()
            }
          >
            <header className="booking-detail-drawer-header">
              <div className="booking-detail-title-group">
                <h2 id="booking-detail-title">
                  {detailBooking.name}
                </h2>
                <span className="booking-detail-mode">
                  {editingId === detailBooking.id
                    ? 'Modifica'
                    : 'Visualizzazione'}
                </span>
              </div>

              <button
                type="button"
                className="admin-button admin-button-secondary booking-drawer-close"
                onClick={
                  closeBookingDetail
                }
              >
                Chiudi
              </button>
            </header>

            {bookingDetailContent(
              detailBooking
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
