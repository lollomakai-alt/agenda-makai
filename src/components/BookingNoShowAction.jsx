import { noShowEligibility } from '../utils/bookingNoShow';

export default function BookingNoShowAction({ booking, now, disabled = false, compact = false, onNoShow }) {
  const eligibility = noShowEligibility(booking, now);
  if (!eligibility.allowed || !onNoShow) return null;
  if (compact) {
    return <button
      type="button"
      className="admin-button admin-button-secondary booking-action-caution booking-no-show-quick booking-icon-action"
      disabled={disabled}
      title="Non venuto"
      aria-label={`Non venuto: ${booking.name}`}
      onClick={() => {
        if (!disabled) {
          return onNoShow(booking);
        }
      }}
    >
      <span aria-hidden="true">×</span>
    </button>;
  }

  return <button type="button" className="admin-button admin-button-secondary booking-action-caution booking-no-show-quick"
    disabled={disabled} title={eligibility.message} aria-label={`Non venuto: ${booking.name}`}
    onClick={() => { if (!disabled) return onNoShow(booking); }}>
    Non venuto
  </button>;
}
