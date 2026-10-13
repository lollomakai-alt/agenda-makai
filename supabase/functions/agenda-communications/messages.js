export const KINDS = Object.freeze({ confirmation: 'Conferma prenotazione', updated: 'Prenotazione modificata', cancelled: 'Prenotazione cancellata', reminder:'La tua rotta di domani', reconfirmation:'Riconferma la tua prenotazione', delay:'Ti aspettiamo al Makai', alternative:'Proposta alternativa' });
export function communicationMessage(snapshot, kind) {
  if (!Object.hasOwn(KINDS, kind)) throw new Error('Tipo comunicazione non valido.');
  const { name, booking_date, booking_time, party_size } = snapshot;
  const [year, month, day] = String(booking_date).split('-');
  return { subject: `${KINDS[kind]} Makai - ${day}/${month}/${year}`,
    text: `Ahoy ${name}! 🏴‍☠️\n\n${KINDS[kind].toUpperCase()}\n\nData: ${day}/${month}/${year}\nOra: ${String(booking_time).slice(0,5)}\nPersone: ${party_size}\n\n${kind === 'cancelled' ? 'La prenotazione è stata cancellata.' : kind === 'updated' ? 'La modifica richiesta è stata approvata. Questi sono i dati aggiornati.' : 'La prenotazione è confermata. Ti aspettiamo al Makai Grand Line Pigneto!'}${snapshot.tables ? `\nTavolo: ${snapshot.tables}` : ''}${['reminder','reconfirmation'].includes(kind) ? '\nRiconferma la tua rotta dal collegamento qui sotto. La mancata riconferma non annulla la prenotazione.' : ''}${kind==='delay' ? '\nFacci sapere il tuo orario di arrivo.' : ''}${kind==='alternative' && snapshot.proposal ? `\nAlternativa proposta: ${snapshot.proposal}` : ''}${typeof snapshot.management_url === 'string' && /^https:\/\/[^\s]+\/prenotazioni\/gestisci#token=[A-Za-z0-9_-]{43}$/.test(snapshot.management_url) ? `\n\nGestisci o riconferma la prenotazione:\n${snapshot.management_url}` : ''}` };
}
export function whatsappConfirmationMessage(snapshot) {
  const [year, month, day] = String(snapshot.booking_date).split('-');
  const table = String(snapshot.tables || '').trim();
  return `Ahoy ${snapshot.name}! 🏴‍☠️\nLa tua rotta verso Makai Pigneto è confermata.\n\n📅 ${day}/${month}/${year}\n⏰ ${String(snapshot.booking_time).slice(0,5)}\n👥 ${snapshot.party_size} persone${table ? `\n🪑 Tavolo ${table}` : ''}\n\nL'equipaggio Makai ti aspetta.\nA presto a bordo! 🌴`;
}

export function whatsappCommunicationUrl(row) {
  if (row.channel !== 'whatsapp' || row.status !== 'opened' || !/^\+[1-9][0-9]{7,14}$/.test(row.recipient)) throw new Error('Chat non disponibile.');
  return `https://wa.me/${row.recipient.slice(1)}?text=${encodeURIComponent(row.kind === 'confirmation' ? whatsappConfirmationMessage(row.snapshot) : communicationMessage(row.snapshot,row.kind).text)}`;
}
