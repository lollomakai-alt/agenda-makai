import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { openBookingWhatsApp } from '../utils/bookingCommunications';
import { cancellationFeedback, cancellationWhatsAppAllowed } from '../utils/bookingCancellation';
import { normalizePhone } from '../utils/bookingValidation';

export default function BookingCancellationFeedback({ booking, status }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function whatsapp() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await openBookingWhatsApp(supabase, { ...booking, status: 'cancelled' }); }
    catch (failure) { setError(failure.message || 'WhatsApp non disponibile.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="booking-status-feedback" role="status">
    <span>{booking.name}: {cancellationFeedback(status)}</span>
    {cancellationWhatsAppAllowed(status) && normalizePhone(booking.phone || '') && <button
      type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={whatsapp}>
      Apri WhatsApp (email non disponibile)
    </button>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
