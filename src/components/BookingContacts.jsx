import { bookingCallUrl } from '../utils/bookingCall';

export default function BookingContacts({
  booking,
  busy = false,
  onWhatsApp,
}) {
  const callUrl = bookingCallUrl(
    booking.phone
  );

  return (
    <div
      className="booking-contacts booking-contact-icons"
      aria-label={`Contatti di ${booking.name}`}
    >
      <a
        className={`admin-button admin-button-secondary booking-icon-action${!callUrl ? ' is-disabled' : ''}`}
        href={callUrl || undefined}
        aria-label="Chiama"
        title={
          callUrl
            ? 'Chiama'
            : 'Numero non disponibile'
        }
        aria-disabled={!callUrl}
        onClick={
          !callUrl
            ? event =>
                event.preventDefault()
            : undefined
        }
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="19"
          height="19"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.4.2.7.3.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z" />
        </svg>
      </a>

      <button
        type="button"
        className="admin-button admin-button-secondary booking-icon-action"
        disabled={
          busy || !callUrl
        }
        aria-label="WhatsApp"
        title="WhatsApp"
        onClick={onWhatsApp}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.1A8 8 0 1 1 20 11.5z" />
          <path d="M8.5 8.5c.5 3 2 4.5 5 5" />
        </svg>
      </button>
    </div>
  );
}
