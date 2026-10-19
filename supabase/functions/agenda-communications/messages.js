export const KINDS = Object.freeze({ confirmation: 'Conferma prenotazione', updated: 'Prenotazione modificata', cancelled: 'Prenotazione cancellata', rejected: 'Richiesta DOPOCENA rifiutata', reminder: 'Promemoria della tua rotta', reconfirmation: 'Riconferma la tua prenotazione', delay: 'Ti aspettiamo al Makai', alternative: 'Proposta alternativa' });

// Only presentation: older email snapshots do not carry booking_type or status.
// Never infer the service from the time, or an assigned table from acceptance.
function confirmationCopy(snapshot) {
  const status = String(snapshot.status || '').toLowerCase();
  if (status === 'pending') return { title: 'Richiesta in attesa', text: 'Abbiamo ricevuto la tua richiesta. È in attesa della decisione dell’equipaggio.' };
  if (status === 'rejected') return { title: 'Richiesta non accolta', text: 'Ci dispiace, non possiamo accogliere la tua richiesta per questa data e questo orario.' };
  if (status === 'cancelled') return { title: 'Prenotazione cancellata', text: 'La tua prenotazione è stata cancellata.' };
  if (status === 'arrived') return { title: 'Arrivo registrato', text: 'Il tuo arrivo al Makai è registrato. Benvenuti a bordo!' };
  if (status === 'completed') return { title: 'Visita conclusa', text: 'La tua visita al Makai risulta conclusa. Grazie per essere salpati con noi!' };
  if (status === 'no_show') return { title: 'Mancato arrivo registrato', text: 'Per questa prenotazione risulta registrato un mancato arrivo. Se qualcosa non torna, contatta l’equipaggio.' };
  if (snapshot.booking_type === 'dopocena' || status === 'accepted') {
    return { title: 'Richiesta DOPOCENA accettata', text: 'La tua richiesta DOPOCENA è stata accettata e la prenotazione è registrata. L’accettazione della richiesta è distinta dall’assegnazione del tavolo.' };
  }
  return { title: 'La tua prenotazione al Makai è confermata', text: 'La prenotazione al Makai è confermata.' };
}

export function communicationMessage(snapshot, kind, channel = 'email') {
  if (!Object.hasOwn(KINDS, kind)) throw new Error('Tipo di messaggio non disponibile. Aggiorna le comunicazioni e riprova.');
  const { name, booking_date, booking_time, party_size } = snapshot;
  const [year, month, day] = String(booking_date).split('-');
  const date = `${day}/${month}/${year}`;
  const time = String(booking_time).slice(0, 5);
  const whatsapp = channel === 'whatsapp';
  const confirmation = confirmationCopy(snapshot);
  const title = kind === 'confirmation' ? confirmation.title : KINDS[kind];
  const bodies = {
    confirmation: confirmation.text,
    updated: 'La tua prenotazione è stata aggiornata. Ecco i dati registrati per la tua rotta al Makai.',
    cancelled: 'La tua prenotazione è stata cancellata. Speriamo di averti di nuovo a bordo in un’altra occasione.',
    rejected: 'Ci dispiace, questa volta non possiamo accoglierti per il DOPOCENA nella data e nell’orario richiesti. Speriamo di averti a bordo un’altra volta.',
    reminder: 'Un promemoria dalla ciurma: ecco i dati della tua prenotazione al Makai.',
    reconfirmation: 'La ciurma ti chiede di riconfermare la tua prenotazione al Makai.',
    delay: 'Non risulta ancora registrato il tuo arrivo al Makai. Facci sapere il tuo orario di arrivo.',
    alternative: 'La ciurma ha una rotta alternativa da proporti. È una proposta da concordare: non modifica la prenotazione.',
  };
  const table = String(snapshot.tables || '').trim();
  const tableLine = table ? `\n${whatsapp ? '🪑 ' : ''}Tavolo: ${table}` : '';
  const noTableNote = !table && ['confirmation', 'updated', 'reminder', 'reconfirmation', 'delay', 'alternative'].includes(kind)
    ? '\n\nNessun tavolo assegnato. Per il DOPOCENA, l’accettazione della richiesta non conferma un tavolo.' : '';
  const reconfirmation = ['reminder', 'reconfirmation'].includes(kind)
    ? '\n\nLa mancata riconferma non annulla la prenotazione.' : '';
  const proposal = kind === 'alternative' && snapshot.proposal ? `\n\nAlternativa proposta: ${snapshot.proposal}` : '';
  const managementLabel = kind === 'reconfirmation' && !whatsapp
    ? 'Per riconfermare la presenza, modificare o annullare la prenotazione, apri il tuo link personale:'
    : 'Gestisci o riconferma la prenotazione:';
  const management = typeof snapshot.management_url === 'string' && /^https:\/\/[^\s]+\/prenotazioni\/gestisci#token=[A-Za-z0-9_-]{43}$/.test(snapshot.management_url)
    && (!whatsapp || kind !== 'confirmation')
    ? `\n\n${managementLabel}\n${snapshot.management_url}` : '';
  const details = whatsapp ? `📅 ${date} · ⏰ ${time} · 👥 ${party_size} persone` : `Data: ${date}\nOra: ${time}\nPersone: ${party_size}`;
  const greeting = whatsapp ? `Ahoy ${name}! 🏴‍☠️` : `Ciao ${name},`;
  const farewell = ['cancelled', 'rejected'].includes(kind) || (kind === 'confirmation' && ['pending', 'rejected', 'cancelled', 'completed', 'no_show'].includes(String(snapshot.status || '').toLowerCase()));
  const closing = whatsapp ? 'A presto a bordo! 🌴' : `${farewell ? 'Un saluto dall’equipaggio Makai.' : 'L’equipaggio Makai ti aspetta.'}\nA presto,\nMakai Grand Line Pigneto 🏴‍☠️`;
  return {
    subject: `${title}${kind === 'confirmation' ? '' : ' Makai'} · ${date}`,
    text: `${greeting}${whatsapp ? ' ' : '\n\n'}${bodies[kind]}\n\n${details}${tableLine}${noTableNote}${reconfirmation}${proposal}${management}\n\n${closing}`,
  };
}

export function whatsappConfirmationMessage(snapshot) {
  return communicationMessage(snapshot, 'confirmation', 'whatsapp').text;
}

export function whatsappCommunicationUrl(row) {
  if (row.channel !== 'whatsapp' || row.status !== 'opened' || !/^\+[1-9][0-9]{7,14}$/.test(row.recipient)) throw new Error('Chat WhatsApp non disponibile. Verifica il numero e aggiorna le comunicazioni.');
  const text = row.kind === 'confirmation'
    ? whatsappConfirmationMessage(row.snapshot)
    : communicationMessage(row.snapshot, row.kind, 'whatsapp').text;
  const encodedText = encodeURIComponent(text);
  return `https://wa.me/${row.recipient.slice(1)}?text=${encodedText}`;
}
