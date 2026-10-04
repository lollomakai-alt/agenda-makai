export const KINDS = Object.freeze({ confirmation: 'Conferma prenotazione', updated: 'Prenotazione modificata', cancelled: 'Prenotazione cancellata' });
export function communicationMessage(snapshot, kind) {
  if (!Object.hasOwn(KINDS, kind)) throw new Error('Tipo comunicazione non valido.');
  const { name, booking_date, booking_time, party_size } = snapshot;
  const [year, month, day] = String(booking_date).split('-');
  return { subject: `${KINDS[kind]} Makai - ${day}/${month}/${year}`,
    text: `Ciao ${name}!\n\n${KINDS[kind].toUpperCase()}\n\nData: ${day}/${month}/${year}\nOra: ${String(booking_time).slice(0,5)}\nPersone: ${party_size}\n\n${kind === 'cancelled' ? 'La prenotazione è stata cancellata.' : kind === 'updated' ? 'La modifica richiesta è stata approvata. Questi sono i dati aggiornati.' : 'La prenotazione è confermata. Ti aspettiamo al Makai Grand Line Pigneto!'}` };
}
export function whatsappCommunicationUrl(row) {
  if (row.channel !== 'whatsapp' || row.status !== 'opened' || !/^\+[1-9][0-9]{7,14}$/.test(row.recipient)) throw new Error('Chat non disponibile.');
  return `https://wa.me/${row.recipient.slice(1)}?text=${encodeURIComponent(communicationMessage(row.snapshot,row.kind).text)}`;
}
