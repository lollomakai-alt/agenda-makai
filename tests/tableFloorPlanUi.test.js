import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('floor plan touch actions reuse assignment flow, show all occupancy and guard saves', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T12:00:00Z') });
  const previous = globalThis.__floorPlan;
  let slots = [], index = 0, resolveWrite;
  const calls = [], opened = [], saved = [], busy = [];
  const day = '2026-10-10';
  const base = { id: 1, name: 'Cliente Uno', booking_date: day, booking_time: '20:00', party_size: 2,
    tables: '10+11', phone: '+393331234567', notes: 'Conservare', status: 'confirmed', booking_type: 'normale' };
  const rows = [base, { ...base, id: 2, name: 'Cliente Arrivato', tables: '15+16+17', party_size: 6, status: 'arrived' },
    { ...base, id: 3, name: 'Cliente Da Assegnare', tables: '' },
    { ...base, id: 4, name: 'Cliente Dopocena', tables: '23', booking_type: 'dopocena', booking_time: '22:30' },
    { ...base, id: 5, name: 'Cliente Completato', tables: '13+14', status: 'completed' }];
  globalThis.__floorPlan = {
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useRef(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useEffect() {},
    client: { rpc(name, args) {
      calls.push({ name, args });
      return new Promise(resolve => { resolveWrite = () => resolve({ data: { booking: { ...rows.find(row => row.id === args.booking_id), ...args.changes } } }); });
    } },
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{
    name: 'floor-plan-ui-harness', enforce: 'pre',
    transform(code, id) { if (id.endsWith('/src/components/TableMap.jsx')) return code.replace(
      "import { useEffect, useRef, useState } from 'react';", 'const {useEffect,useRef,useState}=globalThis.__floorPlan;'); },
    load(id) { if (id.endsWith('/src/lib/supabase.js')) return 'export const supabase=globalThis.__floorPlan.client;'; },
  }] });
  const nodes = element => !element || typeof element !== 'object' ? []
    : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
  try {
    const { default: Map } = await server.ssrLoadModule('/src/components/TableMap.jsx');
    const render = (props = {}) => { index = 0; return nodes(Map({ appointments: rows, date: day,
      onOpenAssignment: booking => opened.push(booking), onSaved: result => saved.push(result), onSaving: value => busy.push(value), ...props })); };
    const unit = (tree, group) => tree.find(node => node.props['data-unit'] === group);

    await t.test('valid grouped units, text states, coordinates and full-day occupancy remain visible under type filter', () => {
      slots = []; let tree = render();
      assert.equal(tree.filter(node => node.props['data-unit']).length, 10);
      assert.match(unit(tree, '10+11').props['aria-label'], /IN ARRIVO.*20:00 Cliente Uno/);
      assert.match(unit(tree, '15+16').props['aria-label'], /OCCUPATO/);
      assert.match(unit(tree, '13+14').props['aria-label'], /OCCUPATO/);
      assert.match(unit(tree, '12').props['aria-label'], /LIBERO/);
      assert.equal(tree.filter(node => node.type === 'li' && node.props.style?.['--unit-x']).length, 10);
      tree.find(node => node.type === 'select').props.onChange({ target: { value: 'normale' } }); tree = render();
      assert.match(unit(tree, '23').props['aria-label'], /IN ARRIVO.*Cliente Dopocena/);
      assert.equal(calls.length, 0);
    });

    await t.test('pending booking and linked-table change open exact existing booking without a write', () => {
      slots = []; let tree = render();
      tree.find(node => node.props['aria-label'] === 'Assegna tavolo a Cliente Da Assegnare').props.onClick();
      assert.equal(opened.at(-1), rows[2]);
      unit(tree, '10+11').props.onClick(); tree = render();
      assert.equal(tree.find(node => node.props.id === 'table-map-detail').props.tabIndex, -1);
      assert.ok(tree.some(node => node.type === 'a' && node.props.href?.endsWith('#booking-1')));
      tree.find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === 'Cambia tavolo').props.onClick();
      assert.equal(opened.at(-1), base);
      assert.equal(tree.filter(node => node.type === 'select')[1].props.value, '1', 'one linked active booking is preselected');
      const disabledTree = render({ disabled: true });
      disabledTree.find(node => node.props['aria-label'] === 'Assegna tavolo a Cliente Da Assegnare').props.onClick();
      assert.equal(opened.length, 2);
      assert.equal(calls.length, 0);
    });

    await t.test('shared units retain all linked bookings and never offer terminal-booking assignment', () => {
      slots = []; const shared = [...rows, { ...base, id: 6, name: 'Secondo Arrivo', booking_time: '22:30' }];
      let tree = render({ appointments: shared }); unit(tree, '10+11').props.onClick(); tree = render({ appointments: shared });
      assert.ok(tree.some(node => node.type === 'a' && node.props.href?.endsWith('#booking-1')));
      assert.ok(tree.some(node => node.type === 'a' && node.props.href?.endsWith('#booking-6')));
      assert.equal(tree.filter(node => node.type === 'select')[1].props.value, '');
      unit(tree, '13+14').props.onClick(); tree = render();
      assert.ok(!tree.some(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === 'Cambia tavolo'));
      assert.equal(calls.length, 0);
    });

    await t.test('linked-table no-show is available only through existing eligibility and callback', async () => {
      slots = []; const marked = [];
      const props = { now: Date.parse('2026-10-10T18:30:00Z'), onNoShow: booking => marked.push(booking) };
      let tree = render(props); unit(tree, '10+11').props.onClick(); tree = render(props);
      const action = tree.find(node => node.type?.name === 'BookingNoShowAction');
      const button = action.type(action.props);
      assert.equal(button.props.children, 'Non venuto');
      await button.props.onClick(); assert.equal(marked[0], base);
      const disabledAction = render({ ...props, disabled: true }).find(node => node.type?.name === 'BookingNoShowAction');
      assert.equal(disabledAction.type(disabledAction.props).props.disabled, true);
      await disabledAction.type(disabledAction.props).props.onClick(); assert.equal(marked.length, 1);
      unit(tree, '15+16').props.onClick(); tree = render(props);
      const arrivedAction = tree.find(node => node.type?.name === 'BookingNoShowAction');
      assert.equal(arrivedAction.type(arrivedAction.props), null);
      assert.equal(calls.length, 0);
    });

    await t.test('touching a unit chooses a valid whole combination; explicit save preserves identity and rejects duplicate taps', async () => {
      slots = []; const selected = rows[2];
      let tree = render({ assignmentBooking: selected }); unit(tree, '12').props.onClick(); tree = render({ assignmentBooking: selected });
      assert.equal(unit(tree, '12').props['aria-pressed'], true);
      const form = tree.find(node => node.type === 'form');
      const staleTile = unit(tree, '18');
      const sending = form.props.onSubmit({ preventDefault() {} });
      staleTile.props.onClick(); tree = render({ assignmentBooking: selected });
      assert.equal(unit(tree, '12').props['aria-pressed'], true, 'an immediate second tap cannot change a pending assignment');
      assert.equal(unit(tree, '12').props.disabled, true);
      assert.equal(tree.find(node => node.props.children === 'Salvataggio…').props.disabled, true);
      await form.props.onSubmit({ preventDefault() {} });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].name, 'admin_assign_booking_tables');
      assert.equal(calls[0].args.booking_id, selected.id);
      assert.deepEqual(calls[0].args.changes, { tables: '12' });
      assert.equal(calls[0].args.expected.tables, '');
      resolveWrite(); await sending;
      assert.deepEqual(busy, [true, false]);
      assert.equal(saved[0].booking.id, selected.id);
      assert.equal(saved[0].booking.phone, selected.phone);
      assert.equal(saved[0].booking.notes, selected.notes);
      assert.equal(saved[0].booking.status, selected.status);
    });
  } finally {
    await server.close();
    if (previous === undefined) delete globalThis.__floorPlan; else globalThis.__floorPlan = previous;
  }
});
