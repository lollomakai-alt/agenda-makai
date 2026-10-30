import { isDay, todayInRome, operationalDayInRome } from './calendar.js';

export function normalizePhone(raw = '') {
  const value = String(raw).trim();

  if (!value) return null;
  if (!/^\+?[0-9\s().-]+$/.test(value)) return null;

  let phone = value.replace(/[^0-9+]/g, '');

  if (phone.startsWith('00')) {
    phone = `+${phone.slice(2)}`;
  }

  const digits = phone.replace(/\D/g, '');

  if (digits.length < 8 || digits.length > 15) {
    return null;
  }

  let national = digits;

  if (phone.startsWith('+39') || (!phone.startsWith('+') && digits.startsWith('39'))) {
    national = digits.slice(2);
  } else if (phone.startsWith('+')) {
    return digits.startsWith('0') ? null : `+${digits}`;
  }

  return /^(3[0-9]{9}|0[0-9]{5,10})$/.test(national)
    ? `+39${national}`
    : null;
}

const emailPattern =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function validateBooking(
  values,
  {
    requirePhone = true,
    now = Date.now(),
  } = {}
) {
  const errors = {};

  const name = String(values.name || '')
    .trim()
    .replace(/\s+/g, ' ');

  const rawPhone = String(values.phone || '').trim();
  const phone = normalizePhone(rawPhone);

  const email = String(values.email || '')
    .trim()
    .toLowerCase();

  const notes = String(values.notes || '').trim();
  const partySize = Number(values.party_size);

  if (
    name.length < 2 || name.length > 60 ||
    !/^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*(?: [\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*)*$/u.test(name)
  ) {
    errors.name = 'Inserisci nome e cognome, senza numeri o simboli.';
  }

  if (requirePhone && !phone) {
    errors.phone =
      'Inserisci un numero completo: cellulare italiano di 10 cifre, fisso o numero estero con prefisso +.';
  } else if (rawPhone && !phone) {
    errors.phone =
      'Il numero inserito non è valido. Correggilo oppure lascia il campo vuoto.';
  }

  if (email && (email.length > 120 || !emailPattern.test(email))) {
    errors.email =
      'Scrivi solo un indirizzo completo, senza spazi (nome@dominio.it).';
  }

  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 6) {
    errors.party_size = 'Inserisci un numero intero da 1 a 6.';
  }

  if (!/^(19:00|21:30)$/.test(values.time)) {
    errors.time =
      'Scegli uno dei turni: 19:00 o 21:30.';
  }

  if (notes.length > 300) {
    errors.notes = 'Le note possono contenere al massimo 300 caratteri.';
  }

  const today = todayInRome(now);
  const lastDay = new Date(`${today}T12:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() + 60);

  if (
    !isDay(values.date) ||
    values.date < operationalDayInRome(now) ||
    values.date > lastDay.toISOString().slice(0, 10)
  ) {
    errors.date =
      'Scegli dal calendario una data entro i prossimi 60 giorni.';
  } else if (
    new Date(`${values.date}T12:00:00Z`).getUTCDay() === 1
  ) {
    errors.date =
      'Il lunedì il locale è chiuso. Scegli un altro giorno dal calendario.';
  }

  return {
    errors,
    data: {
      ...values,
      name,
      phone: phone || '',
      email,
      notes,
      party_size: partySize,
    },
  };
}

// Staff entry keeps data-shape checks but deliberately skips online service,
// date-window, party-size and availability rules.
export function validateManualBooking(values, { requirePhone = false } = {}) {
  const validation = validateBooking(values, { requirePhone });
  const errors = { ...validation.errors };
  delete errors.party_size;
  delete errors.time;
  delete errors.date;
  const partySize = Number(values.party_size);
  if (!Number.isSafeInteger(partySize) || partySize < 1 || partySize > 2147483647) {
    errors.party_size = 'Inserisci un numero intero positivo.';
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(values.time || ''))) {
    errors.time = 'Inserisci un orario valido.';
  }
  if (!isDay(values.date)) errors.date = 'Inserisci una data valida.';
  return { errors, data: { ...validation.data, party_size: partySize } };
}
