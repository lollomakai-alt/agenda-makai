import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const nodes = element => !element || typeof element !== 'object' ? []
  : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
const textContent = value => (Array.isArray(value) ? value : [value]).flat(Infinity)
  .map(item => item && typeof item === 'object' ? textContent(item.props?.children) : String(item ?? '')).join('');

function hooks(seed = []) {
  let index = 0;
  const slots = seed;
  return {
    slots,
    reset() { index = 0; },
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], value => {
        slots[slot] = typeof value === 'function' ? value(slots[slot]) : value;
      }];
    },
    useRef(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useEffect() {},
    useMemo(fn) { return fn(); },
    useCallback(fn) { return fn; },
  };
}

const booking = {
  id: 310, name: 'Alex Peterson', booking_date: '2026-11-01', booking_time: '20:30',
  party_size: 4, tables: '14+15', phone: '+393331234567', email: 'alex@example.com', status: 'confirmed',
};

test('customer requests page lists only pending cards with three actions and contacts inside the detail', async () => {
  const previous = globalThis.__requestsUi;
  const state = hooks([[{
    id: 3, booking_id: 310, request_type: 'data', requested_value: '2026-11-02',
    status: 'pending', created_at: '2026-10-21T12:00:00Z', origin: 'customer', booking,
  }, {
    id: 4, booking_id: 311, request_type: 'ora', requested_value: '21:00',
    status: 'approved', created_at: '2026-10-20T12:00:00Z', origin: 'customer',
    booking: { ...booking, id: 311, name: 'Giulia Rossi' },
  }], null, '', '', false, null, false]);
  globalThis.__requestsUi = state;
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{
    name: 'requests-list-ui', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/src/components/BookingRequests.jsx')) return code.replace(
        "import { useEffect, useRef, useState } from 'react';",
        'const {useEffect,useRef,useState}=globalThis.__requestsUi;');
    },
    load(id) {
      if (id.endsWith('/src/lib/supabase.js')) return 'export const supabase={};';
    },
  }] });
  try {
    const { default: Requests } = await server.ssrLoadModule('/src/components/BookingRequests.jsx');
    const render = () => { state.reset(); return nodes(Requests({ appointments: [booking], onChanged() {} })); };
    let tree = render();
    const text = textContent(tree.map(node => node.props.children));
    assert.match(text, /Alex Peterson/);
    assert.doesNotMatch(text, /Giulia Rossi/, 'decided requests are not duplicated in the pending list');
    assert.doesNotMatch(text, /Decisioni recenti|Vedi archivio/);
    assert.doesNotMatch(text, /Prenotazione #/);
    assert.deepEqual(tree.filter(node => node.type === 'button'
      && ['Accetta', 'Proponi alternativa', 'Rifiuta'].includes(node.props.children))
      .map(node => node.props.children), ['Accetta', 'Proponi alternativa', 'Rifiuta']);
    assert.equal(tree.filter(node => node.type === 'button' && node.props.children === 'Aggiorna').length, 1);
    assert.equal(tree.filter(node => node.type === 'details' && node.props.className === 'makai-record-details').length, 1);
    const detail = tree.find(node => node.type === 'details' && node.props.className === 'makai-record-details');
    const detailNodes = nodes(detail);
    assert.ok(detailNodes.some(node => node.type === 'a' && node.props.href === 'tel:+393331234567'));
    assert.ok(detailNodes.some(node => node.type === 'a' && node.props.href === 'mailto:alex@example.com'));
    assert.ok(tree.some(node => node.props.action === undefined && node.props.href === '/prenotazioni/giorno?date=2026-11-01#booking-310'));
  } finally {
    await server.close();
    if (previous === undefined) delete globalThis.__requestsUi; else globalThis.__requestsUi = previous;
  }
});

test('DOPOCENA requests page lists only pending cards with contact details and moves decisions to the archive', async () => {
  const previous = globalThis.__dopocenaUi;
  const pending = {
    request_id: 'r1', status: 'pending', name: 'Alex Peterson', phone: '+393331234567', email: 'alex@example.com',
    booking_date: '2026-10-28', booking_time: '23:00', party_size: 2, notes: 'Tiki please',
  };
  const decided = { ...pending, request_id: 'r2', status: 'accepted', name: 'Giulia Rossi', booking_id: 353 };
  const state = hooks([[pending, decided], '', '', null, false]);
  globalThis.__dopocenaUi = state;
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{
    name: 'dopocena-list-ui', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/src/components/OnlineDopocenaRequests.jsx')) return code.replace(
        "import { useCallback, useEffect, useRef, useState } from 'react';",
        'const {useCallback,useEffect,useRef,useState}=globalThis.__dopocenaUi;');
    },
    load(id) {
      if (id.endsWith('/src/lib/supabase.js')) return 'export const supabase={};';
    },
  }] });
  try {
    const { default: Requests } = await server.ssrLoadModule('/src/components/OnlineDopocenaRequests.jsx');
    const render = () => { state.reset(); return nodes(Requests({})); };
    const tree = render();
    const text = textContent(tree.map(node => node.props.children));
    assert.match(text, /Alex Peterson/);
    assert.doesNotMatch(text, /Giulia Rossi/);
    assert.doesNotMatch(text, /Archiviate|Email accettata da Resend/);
    assert.match(text, /1 richiesta da gestire/);
    assert.deepEqual(tree.filter(node => node.type === 'button'
      && ['Accetta', 'Rifiuta'].includes(node.props.children)).map(node => node.props.children), ['Accetta', 'Rifiuta']);
    assert.equal(tree.filter(node => node.type === 'button' && node.props.children === 'Aggiorna').length, 1);
    const detail = tree.find(node => node.type === 'details' && node.props.className === 'makai-record-details');
    const detailNodes = nodes(detail);
    assert.ok(detailNodes.some(node => node.type === 'a' && node.props.href === 'tel:+393331234567'));
    assert.ok(detailNodes.some(node => node.type === 'a' && node.props.href === 'mailto:alex@example.com'));
    assert.ok(tree.some(node => node.type === 'a' && node.props.href === '/archivio?tipo=dopocena'));
  } finally {
    await server.close();
    if (previous === undefined) delete globalThis.__dopocenaUi; else globalThis.__dopocenaUi = previous;
  }
});

test('archive page shows one chronological event list, collapsible filters and full detail with identifiers', async () => {
  const previous = globalThis.__archiveUi;
  const entries = [{
    source: 'booking', id: 91, booking_id: 310, booking_name: 'Alex Peterson',
    action: 'customer_request_rejected', old_data: { request_status: 'pending' },
    new_data: { request_id: 3, request_type: 'data', requested_value: '2026-11-02', request_status: 'rejected', rejection_reason: 'Sala completa.' },
    actor_id: '11111111-2222-3333-4444-555555555555', created_at: '2026-10-29T16:30:00Z',
    details: ['Richiesta #3: Data → 2026-11-02', 'Esito: Rifiutata'],
  }, {
    source: 'booking', id: 90, booking_id: 311, booking_name: 'Giulia Rossi',
    action: 'booking_created', old_data: {}, new_data: { booking_date: '2026-11-03', booking_time: '21:00', party_size: 2, tables: '' },
    actor_id: null, created_at: '2026-10-28T16:30:00Z',
    details: ['2026-11-03', '21:00', '2 persone', 'Tavoli: non assegnati'],
  }];
  const state = hooks([entries, { from: '', to: '', type: '', search: '' }, { loading: false, error: '' }, 0, {}]);
  globalThis.__archiveUi = state;
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{
    name: 'archive-list-ui', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/src/pages/ArchivePage.jsx')) return code.replace(
        "import { useEffect, useMemo, useState } from 'react';",
        'const {useEffect,useMemo,useState}=globalThis.__archiveUi;');
    },
    load(id) {
      if (id.endsWith('/src/lib/supabase.js')) return 'export const supabase={};';
    },
  }] });
  try {
    const { default: Archive } = await server.ssrLoadModule('/src/pages/ArchivePage.jsx');
    const render = () => { state.reset(); return nodes(Archive()); };
    let tree = render();
    let text = textContent(tree.map(node => node.props.children));
    assert.match(text, /2 eventi · ultimi 500/);
    assert.match(text, /Richiesta cliente rifiutata/);
    assert.match(text, /Rifiutata/);
    assert.match(text, /Prenotazione #310 · Alex Peterson/);
    assert.doesNotMatch(text, /customer_request_rejected/);
    assert.equal(tree.filter(node => node.type === 'details' && node.props.className === 'makai-filter-panel').length, 1);
    assert.ok(tree.some(node => node.props.placeholder === 'Numero prenotazione o nome'));
    assert.ok(tree.some(node => node.type === 'details' && node.props.className === 'makai-record'));
    const detail = tree.find(node => node.type === 'details' && node.props.className === 'makai-record');
    const detailNodes = nodes(detail);
    assert.ok(detailNodes.some(node => node.props.className === 'makai-reason'));
    assert.ok(detailNodes.some(node => node.type === 'dd' && textContent(node.props.children) === '#91'));
    assert.ok(detailNodes.some(node => node.type === 'dd' && node.props.children === '11111111-2222-3333-4444-555555555555'));
    assert.doesNotMatch(textContent(detailNodes.map(node => node.props.children)), /alex@example.com/, 'contacts load only after opening the detail');

    const search = tree.find(node => node.props.placeholder === 'Numero prenotazione o nome');
    search.props.onChange({ target: { value: 'alex' } });
    tree = render();
    text = textContent(tree.map(node => node.props.children));
    assert.match(text, /1 eventi · ultimi 500/);
    assert.match(text, /Alex Peterson/);
    assert.doesNotMatch(text, /Giulia Rossi/);
  } finally {
    await server.close();
    if (previous === undefined) delete globalThis.__archiveUi; else globalThis.__archiveUi = previous;
  }
});
