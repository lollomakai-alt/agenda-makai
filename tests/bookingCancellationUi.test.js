import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';
const nodes = el => !el || typeof el !== 'object' ? [] : [el, ...[el.props?.children].flat(Infinity).flatMap(nodes)];
const booking = { id: 42, name: 'Cliente', booking_date: '2026-10-21', booking_time: '20:00', party_size: 2, tables: '12', phone: '+393331234567', email: 'test@example.com', status: 'confirmed' };

test('cancellation buttons confirm first, save before automatic email and preserve saved cancellation on email failure', async () => {
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch;
  let slots = [], index = 0, confirmed = false, writeFailure = false, sendStatus = 'accepted';
  const events = [];
  globalThis.__cancelUi = {
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }];
    },
    useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect() {},
    client: {
      auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) },
      rpc: async (name, args) => {
        events.push({ name, args });
        return writeFailure ? { error: { message: 'write failed' } } : { data: { booking_id: 42, status: 'cancelled' } };
      },
    },
    data: { appointments: [booking], loading: false, error: null, refresh() {},
      applyUpdate(update) { this.appointments = this.appointments.map(b => ({ ...b, ...update })); } },
  };
  globalThis.window = { location: { search: '?date=2026-10-21', hash: '' }, confirm() { events.push('confirm'); return confirmed; }, dispatchEvent() {}, open() { throw Error('WhatsApp must never open automatically'); } };
  globalThis.fetch = async (url, options) => {
    events.push({ url, body: JSON.parse(options.body) });
    if (url.includes('/requests/')) {
      return Response.json({ request_id: 3, status: 'rejected', booking_id: 42, email_status: sendStatus, rejection_reason: 'Siamo al completo.' });
    }
    assert.equal(globalThis.__cancelUi.data.appointments[0].status, 'cancelled');
    return url.endsWith('/communications/prepare')
      ? Response.json({ communication: { id: 7, booking_id: 42, channel: 'email', kind: 'cancelled', status: 'queued', attempts: 0 } })
      : Response.json({ status: sendStatus, bookingId: 42, communicationId: 7 }, { status: sendStatus === 'failed' ? 502 : 200 });
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{
    name: 'cancellation-ui', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/src/components/BookingRequests.jsx')) return code.replace("import { useEffect, useRef, useState } from 'react';", 'const {useEffect,useRef,useState}=globalThis.__cancelUi;');
      if (id.endsWith('/src/pages/BookingsPage.jsx')) return code.replace('import { useEffect, useRef, useState } from "react";', 'const {useEffect,useRef,useState}=globalThis.__cancelUi;');
    },
    load(id) {
      if (id.endsWith('/src/lib/supabase.js')) return 'export const supabase=globalThis.__cancelUi.client;';
      if (id.endsWith('/src/hooks/useAppointments.js')) return 'export function useAppointments(){const d=globalThis.__cancelUi.data;return {...d,applyUpdate:u=>d.applyUpdate(u)};}';
    },
  }] });
  try {
    const { default: Page } = await server.ssrLoadModule('/src/pages/BookingsPage.jsx');
    const { default: Feedback } = await server.ssrLoadModule('/src/components/BookingCancellationFeedback.jsx');
    const { default: Contacts } = await server.ssrLoadModule('/src/components/BookingContacts.jsx');
    const render = () => { index = 0; return nodes(Page()); };
    const cancelButton = () => {
      render().find(n => n.type === 'button' && n.props.className === 'booking-card-summary').props.onClick();
      return render().find(n => n.type === 'button' && nodes(n).some(x => x.props?.children?.includes?.('Cancella prenotazione')));
    };
    for (const mode of ['decline','write-failure','accepted','failed','unknown']) {
      slots = []; events.length = 0; globalThis.__cancelUi.data.appointments = [booking];
      confirmed = mode !== 'decline'; writeFailure = mode === 'write-failure'; sendStatus = mode;
      const button = cancelButton(); assert.ok(button);
      await button.props.onClick();
      assert.equal(events[0], 'confirm');
      if (mode === 'decline') { assert.equal(events.length, 1); continue; }
      assert.equal(events[1].name, 'admin_set_booking_status_with_history');
      if (writeFailure) { assert.equal(events.length, 2); assert.equal(globalThis.__cancelUi.data.appointments[0].status, 'confirmed'); continue; }
      assert.deepEqual(events.slice(2).map(e => e.url), ['/api/admin/bookings/42/communications/prepare','/api/admin/bookings/42/send-template-email']);
      const feedback = render().find(n => n.type === Feedback);
      assert.equal(feedback.props.status, mode);
    }
    const { default: Requests } = await server.ssrLoadModule('/src/components/BookingRequests.jsx');
    const request = { id: 3, booking_id: 42, request_type: 'cancellazione', status: 'pending', created_at: '2026-10-21T12:00:00Z', booking };
    const renderRequests = () => { index = 0; return nodes(Requests({ appointments: [booking], onChanged() {} })); };
    globalThis.__cancelUi.client.rpc = async (name, args) => {
      events.push({ name, args });
      if (args.p_decision === 'approved') globalThis.__cancelUi.data.appointments = [{ ...booking, status: 'cancelled' }];
      return { data: { ...request, status: args.p_decision } };
    };
    // Rifiuto: motivazione obbligatoria nel pannello, nessuna scrittura finché non si conferma.
    slots = [[request]]; index = 0; events.length = 0; confirmed = true;
    let tree = renderRequests();
    await tree.find(n => n.type === 'button' && n.props.children === 'Rifiuta').props.onClick();
    tree = renderRequests();
    const reasonField = tree.find(n => n.type === 'textarea');
    assert.ok(reasonField);
    await tree.find(n => n.type === 'button' && n.props.children === 'Annulla').props.onClick();
    tree = renderRequests();
    assert.equal(tree.some(n => n.type === 'form' && n.props.className === 'booking-request-rejection'), false);
    assert.deepEqual(events, []);
    slots = [[request]]; index = 0; events.length = 0;
    tree = renderRequests();
    await tree.find(n => n.type === 'button' && n.props.children === 'Rifiuta').props.onClick();
    tree = renderRequests();
    tree.find(n => n.type === 'textarea').props.onChange({ target: { value: 'Siamo al completo.' } });
    tree = renderRequests();
    const rejectForm = tree.find(n => n.type === 'form' && n.props.className === 'booking-request-rejection');
    assert.ok(rejectForm);
    await rejectForm.props.onSubmit({ preventDefault() {} });
    assert.equal(events.filter(e => e.name === 'admin_review_booking_request_with_reason').length, 0);
    assert.deepEqual(events.filter(e => e.url).map(e => e.url), ['/api/admin/bookings/requests/3/reject']);
    // Accettazione: RPC atomica e email di cancellazione già accodata.
    slots = [[request]]; index = 0; events.length = 0; confirmed = true; sendStatus = 'failed';
    globalThis.__cancelUi.data.appointments = [booking];
    tree = renderRequests();
    await tree.find(n => n.type === 'button' && n.props.children === 'Accetta').props.onClick();
    assert.equal(events.filter(e => e.name === 'admin_review_booking_request_with_reason').length, 1);
    assert.deepEqual(events.filter(e => e.url).map(e => e.url), ['/api/admin/bookings/42/communications/prepare','/api/admin/bookings/42/send-template-email']);
    const requestFeedback = renderRequests().find(n => n.type === Feedback);
    assert.equal(requestFeedback.props.status, 'failed');
    for (const status of ['accepted','failed','skipped','unknown','pending']) {
      const html = renderToString(React.createElement(Feedback, { booking, status }));
      assert.match(html, /Cancellazione confermata/);
      assert.equal(html.includes('Apri WhatsApp'), ['failed','skipped'].includes(status));
    }
    assert.doesNotMatch(renderToString(React.createElement(Contacts, { booking })), /WhatsApp/);
    assert.match(renderToString(React.createElement(Contacts, { booking, onWhatsApp() {} })), /WhatsApp/);
  } finally {
    await server.close(); globalThis.window = oldWindow; globalThis.fetch = oldFetch; delete globalThis.__cancelUi;
  }
});
