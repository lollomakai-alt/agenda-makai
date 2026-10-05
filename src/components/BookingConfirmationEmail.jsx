import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { sendCommunication, emailSendBlocked } from '../utils/bookingCommunications';

export function canSendConfirmationEmail(booking) {
  return booking.status === 'confirmed' && typeof booking.email === 'string'
    && booking.email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email);
}

export default function BookingConfirmationEmail({ booking, rows = [], ready = false, busy = false, onSettled = () => {}, onBusy = () => {} }) {
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const inFlight = useRef(false);
  if (!canSendConfirmationEmail(booking)) return null;
  const blocked = emailSendBlocked(booking, rows);

  async function send() {
    if (inFlight.current || !ready || busy || emailSendBlocked(booking, rows) || feedback?.blocked) return;
    inFlight.current = true;
    setSending(true);
    onBusy(true);
    setFeedback(null);
    try {
      const result = await sendCommunication(supabase, booking.id);
      setFeedback({ error: result.status !== 'accepted', blocked: result.status !== 'failed',
        message: result.status === 'accepted' ? 'Email accettata dal servizio.'
          : result.status === 'unknown' ? 'Esito incerto: verifica su Resend prima di intervenire.'
          : 'Invio fallito. Aggiorna il log prima di riprovare.' });
    } catch (failure) {
      setFeedback({ error: true, blocked: true, message: failure.message || 'Invio non confermato. Aggiorna il log e verifica su Resend.' });
    } finally {
      inFlight.current = false;
      setSending(false);
      onBusy(false);
      onSettled();
    }
  }

  return <div className="booking-confirmation-email">
    <button type="button" className="admin-button admin-button-secondary" disabled={sending || busy || !ready || emailSendBlocked(booking, rows) || Boolean(feedback?.blocked)} onClick={send}>
      {sending ? 'Invio…' : 'Invia conferma email'}
    </button>
    {blocked && !feedback && <p role="status">Email già gestita o invio da verificare. Consulta il log.</p>}
    {feedback && <p className={`manual-booking-feedback${feedback.error ? ' is-error' : ''}`}
      role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
  </div>;
}
