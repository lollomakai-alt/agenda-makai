import { useState } from 'react';
import { customerBookingSummary } from '../utils/customerBookings';
import { bookingStatus, bookingStatusLabel } from '../utils/bookingStatus';
import { bookingScheduledAt } from '../utils/bookingTime';

const dateFormat = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short',
});

export default function CustomerCard({ booking, appointments, now }) {
  const [open, setOpen] = useState(false);
  const profile = open ? customerBookingSummary(booking, appointments) : null;
  const contactRows = profile ? [booking, ...profile.bookings.filter(item => String(item.id) !== String(booking.id))] : [];
  const firstValue = field => contactRows.find(item => String(item[field] || '').trim())?.[field] || 'Non presente';
  return <details className="customer-card" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Apri scheda cliente</summary>
    {open && <>
      <div className="customer-card-contact">
        <p><strong>Nome:</strong> {firstValue('name')}</p>
        <p><strong>Telefono:</strong> {firstValue('phone')}</p>
        <p><strong>Email:</strong> {firstValue('email')}</p>
        <p><strong>Profilo:</strong> {booking.user_id ? 'Cliente registrato' : 'Cliente senza account'}</p>
      </div>
      <dl className="customer-card-stats">
        <div><dt>Prenotazioni</dt><dd>{profile.totalBookings}</dd></div>
        <div><dt>NO_SHOW</dt><dd>{profile.noShows}</dd></div>
        <div><dt>Ultima prenotazione</dt><dd>{profile.latestBooking ? dateFormat.format(bookingScheduledAt(profile.latestBooking)) : 'Non disponibile'}</dd></div>
        <div><dt>Ultima visita</dt><dd>{profile.latestVisit ? dateFormat.format(bookingScheduledAt(profile.latestVisit)) : 'Non registrata'}</dd></div>
      </dl>
      {!profile.identifiable && <p>Telefono, email e account mancanti: lo storico non può essere collegato ad altre prenotazioni.</p>}
      <h4>Storico prenotazioni</h4>
      {profile.bookings.length ? <ul className="customer-card-history">
        {profile.bookings.map(item => {
          const scheduledAt = bookingScheduledAt(item);
          return <li key={item.id}>
            <div>
              <time>{scheduledAt ? dateFormat.format(scheduledAt) : `${item.booking_date || 'Data assente'} · ${item.booking_time || 'Ora assente'}`}</time>
              {' · '}{item.party_size} persone
            </div>
            <span className={`booking-status status-${bookingStatus(item.status)}`}>{bookingStatusLabel(item.status)}</span>
            {item.notes && <p><strong>Note:</strong> {item.notes}</p>}
          </li>;
        })}
      </ul> : <p>Nessuna prenotazione collegata.</p>}
    </>}
  </details>;
}
