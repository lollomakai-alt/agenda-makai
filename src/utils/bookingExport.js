import { bookingStatus, bookingStatusLabel } from './bookingStatus.js';
import { bookingType } from './bookingType.js';

export const BOOKING_EXPORT_COLUMNS = Object.freeze([
  'Ora', 'Turno', 'Cliente', 'Persone', 'Tavolo', 'Stato',
]);

function exportTime(value) {
  const time = String(value || '').slice(0, 5);
  return time === '00:00' ? '24:00' : time;
}

export function prepareBookingExport(bookings, serviceDate) {
  const rows = (bookings || [])
    .filter(booking => booking.booking_date === serviceDate && bookingStatus(booking.status) !== 'cancelled')
    .map(booking => ({
      Ora: String(booking.booking_time || '').slice(0, 5),
      Turno: bookingType(booking.booking_type) === 'dopocena' ? 'DOPOCENA' : 'CENA',
      Cliente: String(booking.name || ''),
      Persone: booking.party_size,
      Tavolo: String(booking.tables || '').trim() || 'Da assegnare',
      Stato: bookingStatusLabel(booking.status),
    }))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => exportTime(a.row.Ora).localeCompare(exportTime(b.row.Ora)) || a.index - b.index)
    .map(({ row }) => row);
  return rows;
}

function protectSpreadsheetFormula(value) {
  const text = String(value ?? '');
  return /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const safeValue = protectSpreadsheetFormula(value);
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function bookingsToCsv(rows) {
  const data = [BOOKING_EXPORT_COLUMNS, ...(rows || []).map(row => BOOKING_EXPORT_COLUMNS.map(column => row[column]))];
  return `\uFEFF${data.map(line => line.map(csvCell).join(';')).join('\r\n')}`;
}

export function formatBookingServiceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value || '');
  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}
