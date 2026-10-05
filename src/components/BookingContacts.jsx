import { useEffect, useRef, useState } from 'react';
import { bookingCallUrl } from '../utils/bookingCall';

export default function BookingContacts({ booking, busy = false, onWhatsApp }) {
  const [open, setOpen] = useState(false);
  const container = useRef(null);
  const trigger = useRef(null);
  const callUrl = bookingCallUrl(booking.phone);
  const menuId = `booking-contacts-${booking.id}`;

  useEffect(() => {
    if (!open) return;
    function dismiss(event) {
      if (!container.current?.contains(event.target)) setOpen(false);
    }
    function escape(event) {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return <div className="booking-contacts" ref={container}>
    <button ref={trigger} type="button" className="admin-button admin-button-secondary"
      disabled={busy || !callUrl} aria-expanded={open && Boolean(callUrl)} aria-controls={menuId}
      title={!callUrl ? 'Numero di telefono mancante o non valido' : undefined}
      onClick={() => setOpen(value => !value)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z" /></svg>
      Contatti
    </button>
    {!callUrl && <small className="booking-contacts-unavailable">Numero non disponibile</small>}
    {open && callUrl && <div id={menuId} className="booking-contacts-menu" role="group" aria-label={`Contatti di ${booking.name}`}>
      <a className="admin-button admin-button-secondary" href={callUrl} onClick={() => setOpen(false)}>Chiama</a>
      <button type="button" className="admin-button admin-button-secondary" disabled={busy}
        onClick={() => { setOpen(false); trigger.current?.focus(); onWhatsApp(); }}>WhatsApp</button>
    </div>}
  </div>;
}
