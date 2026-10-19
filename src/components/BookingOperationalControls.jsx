import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { prepareEmailTemplate, sendEmailTemplate } from '../utils/bookingCommunications';

export default function BookingOperationalControls({ booking }) {
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  async function sendReconfirmation() {
    if (sending) return;
    setSending(true);
    setFeedback('');
    try {
      const communication = await prepareEmailTemplate(supabase, booking.id, 'reconfirmation');
      const result = await sendEmailTemplate(supabase, booking.id, communication.id);
      setFeedback(result.status === 'accepted'
        ? 'Richiesta inviata: il provider ha accettato l’email.'
        : result.status === 'unknown'
          ? 'Esito incerto: controlla il log prima di riprovare.'
          : 'Invio non riuscito: controlla il log.');
      window.dispatchEvent(new Event('admin-notifications-changed'));
    } catch (error) {
      setFeedback(error.message || 'Invio non riuscito. Controlla il log prima di riprovare.');
    } finally {
      setSending(false);
    }
  }
  const canSend = booking.status === 'confirmed' && typeof booking.email === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email);
  return (
    <section className="booking-detail-operations" aria-label="Informazioni operative">
      <p className="booking-reconfirmation-summary">
        Riconferma:{' '}
        {booking.reconfirmation_status === 'reconfirmed'
          ? 'RICONFERMATA'
          : booking.reconfirmation_status === 'pending'
            ? 'In attesa del cliente · nessuna cancellazione automatica'
            : 'Non richiesta'}
      </p>
      {canSend && <button type="button" className="admin-button admin-button-secondary booking-reconfirmation-send"
        disabled={sending} onClick={sendReconfirmation}>
        {sending ? 'Invio…' : 'Invia richiesta di riconferma'}
      </button>}
      {feedback && <p className="booking-reconfirmation-feedback" role="status">{feedback}</p>}
      {booking.booking_type === 'dopocena' && booking.status === 'arrived' && !booking.tables && (
        <p role="alert">
          Arrivo DOPOCENA registrato: nessun tavolo assegnato. L’accettazione della richiesta non assegna un tavolo.
        </p>
      )}
    </section>
  );
}
