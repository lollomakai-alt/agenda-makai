import test from 'node:test';
import assert from 'node:assert/strict';
import { communicationMessage, whatsappConfirmationMessage, whatsappCommunicationUrl, KINDS } from '../supabase/functions/agenda-communications/messages.js';
import { confirmationMessage, confirmationEmailUrl, confirmationWhatsAppUrl } from '../src/utils/bookingConfirmation.js';
import { onlineDopocenaWhatsAppUrl } from '../src/utils/onlineDopocenaRequests.js';
import { COMMUNICATION_STATUSES } from '../src/utils/bookingCommunications.js';

const booking = { id: 73, name: 'Anna & Luca', phone: '+393331234567', email: 'cliente@example.com', status: 'confirmed', booking_date: '2026-10-15', booking_time: '23:00:00', party_size: 2, tables: '' };
const management_url = `https://www.makaipigneto.it/prenotazioni/gestisci#token=${'a'.repeat(43)}`;

test('all existing kinds preserve facts, secure functional links and literal alternatives without adding marketing', () => {
  const snapshot = { ...booking, tables: '10+11', management_url, proposal: '16/10 alle 23:30 per 2; confermare con lo staff' };
  const original = structuredClone(snapshot);
  for (const kind of Object.keys(KINDS)) {
    const message = communicationMessage(snapshot, kind);
    assert.match(message.text, /^Ahoy Anna & Luca! 🏴‍☠️/);
    for (const fact of ['15/10/2026', '23:00', 'Persone: 2']) assert.ok(message.text.includes(fact));
    assert.equal(message.text.includes(management_url), !['rejected','cancelled'].includes(kind));
    assert.doesNotMatch(message.text, /tavol|assegnazion|10\+11/i);
    assert.doesNotMatch(message.text, /offerte|sconti|compleanno|rispondi.*Sì|invio automatico/i);
    assert.equal(communicationMessage({ ...snapshot, management_url: 'javascript:alert(1)' }, kind).text.includes('javascript:'), false);
  }
  const alternative = communicationMessage(snapshot, 'alternative').text;
  assert.ok(alternative.includes(snapshot.proposal));
  assert.match(alternative, /proposta da concordare/);
  assert.match(alternative, /non modifica la prenotazione/);
  assert.deepEqual(snapshot, original);
});

test('DOPOCENA acceptance never implies an assigned table; pending has no outgoing review channel', () => {
  const request = { ...booking, request_id: 'r1', status: 'pending' };
  assert.equal(onlineDopocenaWhatsAppUrl(request, 'pending'), null);
  const accepted = new URL(onlineDopocenaWhatsAppUrl(request, 'accepted', 73));
  assert.equal(accepted.pathname, '/393331234567');
  const text = accepted.searchParams.get('text');
  assert.match(text, /richiesta DOPOCENA è stata accettata/);
  assert.doesNotMatch(text, /tavol|assegnazion/i);
  assert.doesNotMatch(text, /🪑|Tavolo:|ti aggiorneremo|appena disponibile/i);
  const rejected = new URL(onlineDopocenaWhatsAppUrl(request, 'rejected')).searchParams.get('text');
  assert.match(rejected, /non possiamo accoglierti/);
  assert.doesNotMatch(rejected, /prenotazione.*confermata|richiesta.*accettata/i);
  for (const tables of ['', '   ', '10+11']) {
    const snapshot = { ...booking, booking_type: 'dopocena', tables };
    for (const text of [communicationMessage(snapshot, 'confirmation').text, whatsappConfirmationMessage(snapshot)]) {
      assert.match(text, /richiesta DOPOCENA è stata accettata/);
      assert.doesNotMatch(text, /tavol|assegnazion|10\+11/i);
    }
  }
});

test('snapshots without service metadata never infer DOPOCENA from the slot, and explicit states do not get false confirmation', () => {
  assert.equal(communicationMessage(booking, 'confirmation').subject, 'La tua prenotazione al Makai è confermata · 15/10/2026');
  for (const status of ['pending', 'rejected', 'cancelled', 'arrived', 'completed', 'no_show']) {
    const message = communicationMessage({ ...booking, status, booking_type: 'dopocena' }, 'confirmation');
    assert.doesNotMatch(`${message.subject}\n${message.text}`, /è confermata|è stata accettata/);
  }
  for (const kind of ['updated', 'cancelled', 'rejected', 'alternative', 'delay', 'reconfirmation', 'reminder']) {
    assert.doesNotMatch(communicationMessage(booking, kind).text, /La prenotazione al Makai è confermata/);
  }
  assert.match(communicationMessage(booking, 'reminder').text, /mancata riconferma non annulla/);
  assert.doesNotMatch(communicationMessage(booking, 'reminder').text, /domani/);
});

test('reconfirmation email includes the personal page link for reconfirming, changing or cancelling', () => {
  const message = communicationMessage({ ...booking, management_url }, 'reconfirmation', 'email').text;
  assert.match(message, /riconfermare la presenza, modificare o annullare la prenotazione/i);
  assert.ok(message.includes(management_url));
  const page = communicationMessage({ ...booking, management_url }, 'reconfirmation', 'whatsapp').text;
  assert.ok(page.includes(management_url));
  assert.doesNotMatch(page, /modificare o annullare la prenotazione/i);
});

test('preview and legacy links reuse the channel text while preserving privacy and the existing link conditions', () => {
  for (const channel of ['email', 'whatsapp']) {
    const copy = confirmationMessage(booking, channel);
    assert.ok(copy.startsWith(communicationMessage(booking, 'confirmation', channel).text));
    assert.match(copy, /Informativa privacy: .*\/privacy/);
    assert.doesNotMatch(copy, /offerte|sconti|UN VANTAGGIO|basta rispondere/i);
  }
  const email = new URL(confirmationEmailUrl(booking));
  assert.equal(email.searchParams.get('subject'), communicationMessage(booking, 'confirmation').subject);
  assert.equal(email.searchParams.get('body'), confirmationMessage(booking));
  assert.equal(new URL(confirmationWhatsAppUrl(booking)).searchParams.get('text'), confirmationMessage(booking, 'whatsapp'));
  const row = { channel: 'whatsapp', status: 'opened', kind: 'confirmation', recipient: booking.phone, snapshot: { ...booking, management_url } };
  assert.equal(new URL(whatsappCommunicationUrl(row)).searchParams.get('text').includes(management_url), false);
  assert.ok(new URL(whatsappCommunicationUrl({ ...row, kind: 'updated' })).searchParams.get('text').includes(management_url));
});

test('prepared, provider-accepted and delivered statuses retain distinct meanings', () => {
  assert.match(COMMUNICATION_STATUSES.queued, /preparata.*da inviare/);
  assert.match(COMMUNICATION_STATUSES.opened, /invio manuale.*consegna non verificata/);
  assert.match(COMMUNICATION_STATUSES.accepted, /Accettata dal provider.*consegna non verificata/);
  assert.match(COMMUNICATION_STATUSES.delivered, /Consegna confermata dal provider/);
  for (const status of ['failed', 'unknown', 'sending', 'skipped', 'delivery_delayed', 'bounced', 'complained']) {
    assert.ok(COMMUNICATION_STATUSES[status]);
    assert.doesNotMatch(COMMUNICATION_STATUSES[status], /^Consegna confermata/);
  }
});

test('all customer templates retain visible emoji in both channels and after WhatsApp encoding', () => {
  for (const kind of Object.keys(KINDS)) {
    for (const channel of ['email','whatsapp']) {
      const message = communicationMessage({ ...booking, tables:'12' }, kind, channel);
      for (const emoji of ['🏴‍☠️','📅','⏰','👥']) assert.ok(message.text.includes(emoji));
      assert.doesNotMatch(message.text,/tavol|assegnazion|registrat|service_role|Resend/i);
      if (channel === 'whatsapp') {
        const url = whatsappCommunicationUrl({ channel, status:'opened', kind, recipient:booking.phone, snapshot:booking });
        assert.equal(new URL(url).searchParams.get('text'), message.text);
      }
    }
  }
});

test('refusal email and WhatsApp offer the site calendar, never a booking management token', () => {
  const calendar = 'https://www.makaipigneto.it/prenotazioni';
  for (const kind of ['rejected','confirmation']) {
    for (const channel of ['email','whatsapp']) {
      const snapshot = { ...booking, booking_type:'dopocena', status:'rejected', management_url };
      const message = communicationMessage(snapshot, kind, channel);
      assert.match(message.text,/🏴‍☠️ Scegli un’altra data:/);
      assert.ok(message.text.includes(calendar));
      assert.doesNotMatch(message.text,/Gestisci|riconferma|gestisci#token|link personale/i);
      assert.equal(message.text.includes(management_url),false);
      if (channel === 'whatsapp') {
        const url = whatsappCommunicationUrl({channel,status:'opened',kind,recipient:booking.phone,snapshot});
        assert.equal(new URL(url).searchParams.get('text'),message.text);
      }
    }
  }
  const withoutBooking = new URL(onlineDopocenaWhatsAppUrl({ ...booking, status:'pending', management_url },'rejected')).searchParams.get('text');
  assert.ok(withoutBooking.includes(calendar));
  assert.doesNotMatch(withoutBooking,/gestisci#token|Gestisci o riconferma/);
  assert.doesNotMatch(communicationMessage(booking,'confirmation').text,/Scegli un’altra data/);
});

test('management links appear only for actionable bookings and never on cancellations or pending/closed states', () => {
  for (const channel of ['email','whatsapp']) {
    for (const status of ['pending','cancelled','arrived','completed','no_show']) {
      const text = communicationMessage({...booking,status,management_url},'confirmation',channel).text;
      assert.doesNotMatch(text,/Gestisci o riconferma|gestisci#token|link personale/);
    }
    assert.doesNotMatch(communicationMessage({...booking,management_url},'cancelled',channel).text,/Gestisci o riconferma|gestisci#token/);
    for (const kind of ['updated','reminder','reconfirmation','delay','alternative']) {
      const text = communicationMessage({...booking,management_url},kind,channel).text;
      assert.ok(text.includes(management_url));
      assert.equal(new URL(management_url).pathname,'/prenotazioni/gestisci');
    }
  }
  assert.ok(communicationMessage({...booking,management_url},'confirmation','email').text.includes(management_url));
});
