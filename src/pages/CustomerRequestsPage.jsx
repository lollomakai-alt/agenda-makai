import BookingRequests from '../components/BookingRequests';
import { useAppointments } from '../hooks/useAppointments';

export default function CustomerRequestsPage() {
  const { appointments } = useAppointments('all');
  return (
    <main className="booking-admin">
      <BookingRequests appointments={appointments} />
    </main>
  );
}
