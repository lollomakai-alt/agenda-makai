import BookingRequests from '../components/BookingRequests';
import { useAppointments } from '../hooks/useAppointments';

export default function CustomerRequestsPage() {
  const { appointments, refresh } = useAppointments('all');
  return (
    <main className="booking-admin makai-page requests-page">
      <BookingRequests appointments={appointments} onChanged={refresh} />
    </main>
  );
}
