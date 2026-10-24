export const KINDS = Object.freeze({ confirmation: 'Conferma prenotazione', updated: 'Prenotazione modificata', cancelled: 'Prenotazione cancellata', rejected: 'Richiesta DOPOCENA rifiutata', request_rejected: 'Richiesta di modifica non accolta', reminder: 'Promemoria della tua rotta', reconfirmation: 'Riconferma la tua prenotazione', delay: 'Ti aspettiamo al Makai', alternative: 'Proposta alternativa' });
export const REQUEST_LABELS = Object.freeze({ data: 'Data', ora: 'Orario', persone: 'Persone', note: 'Note', cancellazione: 'Cancellazione' });

// Only presentation: older email snapshots do not carry booking_type or status.
// Never infer the service from the time, or an assigned table from acceptance.
function confirmationCopy(snapshot) {
  const status = String(snapshot.status || '').toLowerCase();
  if (status === 'pending') return { title: 'Richiesta in attesa', text: 'Abbiamo ricevuto la tua richiesta. È in attesa della decisione dell’equipaggio.' };
  if (status === 'rejected') return { title: 'Richiesta non accolta', text: 'Ci dispiace, non possiamo accogliere la tua richiesta per questa data e questo orario.' };
  if (status === 'cancelled') return { title: 'Prenotazione cancellata', text: 'La tua prenotazione è stata cancellata.' };
  if (status === 'arrived') return { title: 'Benvenuti a bordo', text: 'Siete arrivati al Makai: benvenuti a bordo!' };
  if (status === 'completed') return { title: 'Visita conclusa', text: 'Grazie per essere salpati con noi al Makai!' };
  if (status === 'no_show') return { title: 'Non vi abbiamo visti a bordo', text: 'Non vi abbiamo visti al Makai per questa prenotazione. Se qualcosa non torna, contatta l’equipaggio.' };
  if (snapshot.booking_type === 'dopocena' || status === 'accepted') {
    return { title: 'Richiesta DOPOCENA accettata', text: 'La tua richiesta DOPOCENA è stata accettata. La ciurma del Makai ti aspetta a bordo!' };
  }
  return { title: 'La tua prenotazione al Makai è confermata', text: 'La prenotazione al Makai è confermata. Preparati a salpare con la ciurma!' };
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
    updated: 'La tua prenotazione è stata aggiornata. Ecco i dettagli della tua rotta al Makai.',
    cancelled: 'La tua prenotazione è stata cancellata. Speriamo di averti di nuovo a bordo in un’altra occasione.',
    rejected: 'Ci dispiace, questa volta non possiamo accoglierti per il DOPOCENA nella data e nell’orario richiesti. Speriamo di averti a bordo un’altra volta.',
    request_rejected: 'Ci dispiace, non possiamo accogliere la modifica richiesta: la tua prenotazione resta invariata. Se vuoi cambiare giorno o orario, scegli una nuova data dal calendario del sito.',
    reminder: 'Un promemoria dalla ciurma: ecco i dati della tua prenotazione al Makai.',
    reconfirmation: 'La ciurma ti chiede di riconfermare la tua prenotazione al Makai.',
    delay: 'La ciurma ti aspetta al Makai! Se sei in ritardo, facci sapere il tuo orario di arrivo.',
    alternative: 'La ciurma ha una rotta alternativa da proporti. È una proposta da concordare: non modifica la prenotazione.',
  };
  const reconfirmation = ['reminder', 'reconfirmation'].includes(kind)
    ? '\n\nLa mancata riconferma non annulla la prenotazione.' : '';
  const proposal = kind === 'alternative' && snapshot.proposal ? `\n\nAlternativa proposta: ${snapshot.proposal}` : '';
  const managementLabel = kind === 'reconfirmation' && !whatsapp
    ? 'Per riconfermare la presenza, modificare o annullare la prenotazione, apri il tuo link personale:'
    : 'Gestisci o riconferma la prenotazione:';
  const rejected = kind === 'rejected' || kind === 'request_rejected' || (kind === 'confirmation' && String(snapshot.status || '').toLowerCase() === 'rejected');
  const requestLabel = kind === 'request_rejected' && Object.hasOwn(REQUEST_LABELS, snapshot.request_type) ? REQUEST_LABELS[snapshot.request_type] : '';
  const requestedRaw = snapshot.requested_value;
  const requestedValue = !requestLabel ? '' : snapshot.request_type === 'persone' && Number.isSafeInteger(requestedRaw)
    ? `${requestedRaw} ${requestedRaw === 1 ? 'persona' : 'persone'}`
    : snapshot.request_type === 'data' && typeof requestedRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requestedRaw)
      ? `${requestedRaw.slice(8, 10)}/${requestedRaw.slice(5, 7)}/${requestedRaw.slice(0, 4)}`
      : (typeof requestedRaw === 'string' || typeof requestedRaw === 'number') ? String(requestedRaw).trim() : '';
  const requestDetails = requestLabel
    ? `\n\nRichiesta: ${requestLabel}${requestedValue && requestedValue !== 'null' ? ` → ${requestedValue}` : ''}` : '';
  const inactive = kind === 'cancelled' || ['pending','rejected','cancelled','arrived','completed','no_show'].includes(String(snapshot.status || '').toLowerCase());
  const management = !rejected && !inactive && typeof snapshot.management_url === 'string' && /^https:\/\/[^\s]+\/prenotazioni\/gestisci#token=[A-Za-z0-9_-]{43}$/.test(snapshot.management_url)
    && (!whatsapp || kind !== 'confirmation')
    ? `\n\n${managementLabel}\n${snapshot.management_url}` : '';
  const rejectionReason = rejected && typeof snapshot.rejection_reason === 'string' && snapshot.rejection_reason.trim()
    ? `\n\nMotivazione: ${snapshot.rejection_reason.trim()}` : '';
  const rebooking = rejected ? '\n\n🏴‍☠️ Scegli un’altra data:\nhttps://www.makaipigneto.it/prenotazioni' : '';
  const details = whatsapp ? `📅 ${date} · ⏰ ${time} · 👥 ${party_size} persone` : `📅 Data: ${date}\n⏰ Ora: ${time}\n👥 Persone: ${party_size}`;
  const greeting = `Ahoy ${name}! 🏴‍☠️`;
  const farewell = ['cancelled', 'rejected', 'request_rejected'].includes(kind) || (kind === 'confirmation' && ['pending', 'rejected', 'cancelled', 'completed', 'no_show'].includes(String(snapshot.status || '').toLowerCase()));
  const closing = whatsapp ? 'A presto a bordo! 🌴' : `${farewell ? 'Un saluto dall’equipaggio Makai.' : 'L’equipaggio Makai ti aspetta.'}\nA presto,\nMakai Grand Line Pigneto 🏴‍☠️`;
  return {
    subject: `${title}${kind === 'confirmation' ? '' : ' Makai'} · ${date}`,
    text: `${greeting}${whatsapp ? ' ' : '\n\n'}${bodies[kind]}\n\n${details}${requestDetails}${reconfirmation}${proposal}${management}${rejectionReason}${rebooking}\n\n${closing}`,
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
