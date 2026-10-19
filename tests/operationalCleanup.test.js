import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const nodes = element => !element || typeof element !== 'object' ? []
  : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
const text = value => (Array.isArray(value) ? value : [value]).flat(Infinity)
  .map(item => item && typeof item === 'object' ? text(item.props?.children) : String(item ?? '')).join('');

test('calendar uses monthly Backend data, navigates dates and never presents unknown/error data as zero covers or available CENA', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-06T12:00:00Z') });
  const previousWindow = globalThis.window, previousHarness = globalThis.__calendarContract;
  const states = [], effectDeps = [], cleanups = [], effects = [], requests = [];
  let stateIndex = 0, effectIndex = 0;
  const url = new URL('https://agenda.example/prenotazioni?month=2026-10');
  const location = {
    get href() { return url.href; },
    set href(value) { url.href = new URL(value, url).href; },
    get search() { return url.search; },
    get pathname() { return url.pathname; },
    get searchParams() { return url.searchParams; },
  };
  globalThis.window = { location, history: { replaceState(_s, _t, url) { location.href = url; } } };
  globalThis.__calendarContract = {
    useMemo: fn => fn(),
    useState(initial) {
      const slot = stateIndex++;
      if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial;
      return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }];
    },
    useEffect(fn, deps) {
      const slot = effectIndex++;
      if (!effectDeps[slot] || deps.some((value, i) => value !== effectDeps[slot][i])) {
        effectDeps[slot] = deps;
        effects.push(() => { cleanups[slot]?.(); cleanups[slot] = fn(); });
      }
    },
    fetch(url, options) { return new Promise(resolve => requests.push({ url, options, resolve })); },
  };
  const server = await createServer({ configLoader: 'native', server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{
    name: 'monthly-calendar-contract', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/src/pages/CalendarPage.jsx')) return code.replace(
        'import { useEffect, useMemo, useState } from "react";',
        'const {useEffect,useMemo,useState}=globalThis.__calendarContract;');
    },
    load(id) {
      if (id.endsWith('/src/lib/adminFetch.js')) return 'export const adminFetch=(...args)=>globalThis.__calendarContract.fetch(...args);';
    },
  }] });
  try {
    const { default: Calendar } = await server.ssrLoadModule('/src/pages/CalendarPage.jsx');
    const render = () => { stateIndex = 0; effectIndex = 0; return nodes(Calendar()); };
    const flush = () => { while (effects.length) effects.shift()(); };
    const settle = () => new Promise(resolve => setImmediate(resolve));
    const cell = (tree, date) => tree.find(node => node.type === 'button' && node.key === date);
    let tree = render();
    assert.equal(tree[0].props['aria-busy'], true);
    assert.match(cell(tree, '2026-10-06').props['aria-label'], /coperti da verificare.*CENA non verificata/);
    flush();
    assert.equal(requests[0].url, '/api/admin/bookings/month?month=2026-10');
    assert.equal(requests[0].options.cache, 'no-store');
    requests[0].resolve({ ok: true, json: async () => ({ days: [
      { date: '2026-10-06', covers: 3, availability: 'available' },
      { date: '2026-10-07', covers: 8, availability: 'full' },
      { date: '2026-10-08', covers: 0, availability: 'closed' },
    ] }) });
    await settle(); tree = render();
    assert.equal(tree[0].props['aria-busy'], false);
    assert.match(cell(tree, '2026-10-06').props['aria-label'], /3 coperti, posti CENA disponibili/);
    assert.match(cell(tree, '2026-10-07').props['aria-label'], /8 coperti, CENA non disponibile/);
    assert.match(cell(tree, '2026-10-08').props['aria-label'], /0 coperti, CENA non disponibile/);
    assert.match(cell(tree, '2026-10-09').props['aria-label'], /coperti da verificare/);
    cell(tree, '2026-10-07').props.onClick(); tree = render();
    assert.equal(location.searchParams.get('day'), '2026-10-07');
    assert.match(text(tree.find(node => node.props.className === 'calendar-day-summary')), /CENA non disponibile.*8coperti prenotati/);
    tree.find(node => node.props.className === 'day-summary-btn').props.onClick();
    assert.equal(location.pathname, '/prenotazioni/giorno');
    assert.equal(location.searchParams.get('date'), '2026-10-07');
    tree.find(node => node.props['aria-label'] === 'Mese successivo').props.onClick();
    tree = render(); flush(); tree = render();
    assert.equal(requests[1].url, '/api/admin/bookings/month?month=2026-11');
    assert.equal(tree[0].props['aria-busy'], true);
    requests[1].resolve({ ok: false });
    await settle(); tree = render();
    assert.equal(tree[0].props['aria-busy'], false);
    assert.match(text(tree.find(node => node.props.role === 'alert')), /Riepilogo del mese non disponibile/);
    assert.match(cell(tree, '2026-11-03').props['aria-label'], /coperti da verificare.*CENA non verificata/);
    assert.ok(!text(tree.find(node => node.props.className === 'calendar-day-summary')).includes('Posti CENA disponibili'));
    tree.find(node => node.props['aria-label'] === 'Mese precedente').props.onClick();
    tree = render(); flush();
    requests[2].resolve({ ok: true, json: async () => ({ unexpected: [] }) });
    await settle(); tree = render();
    assert.ok(tree.some(node => node.props.role === 'alert'), 'invalid payload is not an empty month');
  } finally {
    cleanups.forEach(cleanup => cleanup?.());
    await server.close();
    globalThis.window = previousWindow;
    globalThis.__calendarContract = previousHarness;
  }
});
