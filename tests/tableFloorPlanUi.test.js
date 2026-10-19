import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { TABLE_15_19_CONFIGURATIONS, TABLE_ASSIGNMENTS } from '../src/config/tableAssignments.js';
import { physicalTableIds } from '../src/utils/tableConflicts.js';

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
    { ...base, id: 5, name: 'Cliente Completato', tables: '13+14', status: 'completed' },
    { ...base, id: 6, name: 'Cliente Dopocena Senza Tavolo', tables: '', booking_type: 'dopocena', booking_time: '23:00' }];
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
const textContent = value => (Array.isArray(value) ? value : [value]).flat(Infinity)
  .map(item => item && typeof item === 'object' ? textContent(item.props?.children) : String(item ?? '')).join('');
  try {
    const { default: Map } = await server.ssrLoadModule('/src/components/TableMap.jsx');
    const render = (props = {}) => { index = 0; return nodes(Map({ appointments: rows, date: day,
      onOpenAssignment: booking => opened.push(booking), onSaved: result => saved.push(result), onSaving: value => busy.push(value), ...props })); };
    const unit = (tree, group) => tree.find(node => node.props['data-unit'] === group);

    await t.test('CENA, DOPOCENA and LIVE switch presentation without time slots or writes', () => {
      slots = []; let tree = render();
      const modeButtons = () => tree.filter(node => node.type === 'button' && ['CENA', 'DOPOCENA', 'LIVE'].includes(node.props.children));
      assert.deepEqual(modeButtons().map(button => button.props.children), ['CENA', 'DOPOCENA', 'LIVE']);
      assert.equal(tree.some(node => node.type === 'button' && /^\d\d:\d\d$/.test(String(node.props.children))), false);
      assert.equal(modeButtons()[0].props['aria-pressed'], true);
      assert.match(unit(tree, '10+11').props['aria-label'], /Cliente Uno/);
      assert.match(unit(tree, '10+11').props.className, /service-normale/);
      assert.ok(tree.some(node => node.props.className === 'table-map-counts'), 'table state counters remain visible');
      assert.equal(tree.some(node => node.type === 'summary' && textContent(node.props.children).includes('Da assegnare')), false, 'unassigned bookings remain in ELENCO');
      assert.equal(tree.some(node => ['Ingresso', 'Bar', 'Bagni', 'Finestre'].includes(node.props.children)), false);
      assert.equal(tree.some(node => node.props.className === 'table-map-note'), false);
      assert.ok(tree.some(node => node.props.role === 'tab' && node.props.id === 'room-tab-principale'));
      assert.ok(tree.some(node => node.props.role === 'tab' && node.props.id === 'room-tab-nami'));
      let namiTab = tree.find(node => node.props.role === 'tab' && node.props.id === 'room-tab-nami');
      namiTab.props.onClick(); tree = render();
      assert.match(unit(tree, '23').props['aria-label'], /LIBERO/);

      modeButtons()[1].props.onClick(); tree = render();
      assert.equal(modeButtons()[1].props['aria-pressed'], true);
      assert.match(unit(tree, '23').props['aria-label'], /Cliente Dopocena/);
      assert.match(unit(tree, '23').props.className, /service-dopocena/);
      const mainTab = tree.find(node => node.props.role === 'tab' && node.props.id === 'room-tab-principale');
      mainTab.props.onClick(); tree = render();
      // The CENA assignment is filtered out in DOPOCENA, so its physical tables are single free units here.
      assert.match(unit(tree, '10').props['aria-label'], /LIBERO/);

      modeButtons()[2].props.onClick(); tree = render();
      assert.equal(modeButtons()[2].props['aria-pressed'], true);
      assert.match(unit(tree, '15+16+17').props['aria-label'], /Cliente Arrivato/);
      assert.equal(tree.some(node => node.props.className === 'table-map-note'), false);
      namiTab = tree.find(node => node.props.role === 'tab' && node.props.id === 'room-tab-nami');
      namiTab.props.onClick(); tree = render();
      assert.match(unit(tree, '23').props['aria-label'], /Cliente Dopocena/);
      assert.match(unit(tree, '23').props.className, /service-dopocena/);
      assert.equal(calls.length, 0);
    });

    await t.test('valid grouped units and identifying content remain visible in the selected shift', () => {
      slots = []; let tree = render();
      assert.equal(tree.filter(node => node.props['data-unit']).length, 6);
      assert.match(unit(tree, '15+16+17').props['aria-label'], /OCCUPATO.*20:00 Cliente Arrivato, 6 persone/);
      assert.match(unit(tree, '13+14').props['aria-label'], /OCCUPATO/);
      assert.match(unit(tree, '12').props['aria-label'], /LIBERO/);
      assert.match(unit(tree, '15+16+17').props['aria-label'], /^Tavolo 15\+16\+17:/);
      assert.equal(unit(tree, '15+16+17').props['data-physical-count'], 3);
      assert.ok(unit(tree, '15+16+17').props['aria-label'].includes('15+16+17'));
      assert.ok(tree.some(node => node.type === 'strong' && node.props.children === '15+16+17'));
      assert.ok(tree.some(node => node.type === 'small' && node.props.className === 'floor-plan-booking-name' && node.props.children === 'Cliente Arrivato'));
      assert.ok(tree.some(node => node.type === 'small' && node.props.className === 'floor-plan-status-label' && textContent(node.props.children) === 'OCCUPATO'));
      assert.ok(tree.some(node => node.type === 'small' && node.props.className === 'floor-plan-party-size' && textContent(node.props.children) === '6 pers.'));
      assert.equal(tree.filter(node => node.type === 'li' && node.props.style?.['--unit-x']).length, 6);
      assert.ok(tree.filter(node => node.props['data-unit']).every(tile => !('transform' in (tile.props.style || {}))));
      assert.equal(calls.length, 0);
    });

    await t.test('iPhone keeps the spatial floor plan and opens the shared booking detail below the map', () => {
      const previousWindow = globalThis.window;
      globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };
      try {
        slots = [];
        const created = [];
        const props = { renderBookingDetail: linked => ({ type: 'div', props: { 'data-shared-detail': linked.id, children: linked.name } }),
          onCreateBooking: () => created.push(true) };
        let tree = render(props);
        const groups = () => tree.filter(node => node.props['data-unit']).map(node => node.props['data-unit']);
        assert.deepEqual([...groups()].sort(), ['10+11', '12', '13+14', '15+16+17', '18', '19'].sort());
        assert.equal(tree.some(node => node.props.className === 'floor-plan-physical-heading'), false);
        assert.ok(tree.some(node => node.props.className === 'table-map table-floor-plan is-wide-map'));
        assert.ok(tree.filter(node => node.type === 'li' && /floor-plan-unit/.test(node.props.className)).every(node =>
          typeof node.props.style?.['--landscape-x'] === 'string' && typeof node.props.style?.['--landscape-y'] === 'string'));
        assert.equal(tree.some(node => node.props.id === 'table-map-detail'), false);
        unit(tree, '10+11').props.onClick(); tree = render(props);
        const detailIndex = tree.findIndex(node => node.props.id === 'table-map-detail');
        const canvasIndex = tree.findIndex(node => node.props.className === 'floor-plan-canvas');
        assert.ok(canvasIndex < detailIndex);
        assert.equal(tree.find(node => node.props['data-shared-detail'] === 1).props.children, base.name);
        assert.equal(unit(tree, '10+11').props['aria-expanded'], true);
        tree.find(node => node.props['aria-label'] === 'Chiudi dettaglio tavolo 10+11').props.onClick();
        tree = render(props);
        assert.equal(tree.some(node => node.props.id === 'table-map-detail'), false);
        unit(tree, '12').props.onClick(); tree = render(props);
        assert.ok(tree.some(node => node.props.id === 'table-map-detail'), 'un tavolo libero apre il dettaglio');
        assert.equal(created.length, 0);
        tree.find(node => node.type === 'button' && node.props.children === 'Nuova prenotazione').props.onClick();
        assert.equal(created.length, 1);
        tree.find(node => node.props.id === 'room-tab-nami').props.onClick(); tree = render(props);
        assert.deepEqual([...groups()].sort(), ['20', '21', '22', '23'].sort());
        tree.find(node => node.props.children === 'DOPOCENA').props.onClick(); tree = render(props);
        assert.match(unit(tree, '23').props.className, /service-dopocena/);
      } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
    });

    await t.test('iPhone assignment switches valid physical combinations without saving on touch', () => {
      const previousWindow = globalThis.window;
      globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };
      try {
        slots = [];
        const selected = rows[2];
        const props = { appointments: [selected], assignmentBooking: selected };
        let tree = render(props);
        const choice = group => tree.find(node => node.props['data-choice'] === group);
        assert.ok(unit(tree, '15') && unit(tree, '16') && unit(tree, '17'));
        assert.equal(tree.some(node => node.props.className === 'floor-plan-physical-heading'), false);
        assert.ok(tree.filter(node => node.type === 'li' && /floor-plan-unit/.test(node.props.className)).every(node =>
          typeof node.props.style?.['--landscape-x'] === 'string' && typeof node.props.style?.['--landscape-y'] === 'string'));
        choice('15+16+17').props.onClick(); tree = render(props);
        assert.ok(unit(tree, '15') && unit(tree, '16') && unit(tree, '17'));
        assert.equal(choice('15+16+17').props['aria-pressed'], true);
        choice('22+23').props.onClick(); tree = render(props);
        assert.ok(unit(tree, '22') && unit(tree, '23'));
        assert.equal(choice('15+16+17').props['aria-pressed'], false);
        assert.equal(choice('22+23').props['aria-pressed'], true);
        unit(tree, '12').props.onClick(); tree = render(props);
        assert.equal(choice('12').props['aria-pressed'], true);
        assert.equal(choice('22+23').props['aria-pressed'], false);
        assert.equal(calls.length, 0);
      } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
    });

    for (const [index, configuration] of TABLE_15_19_CONFIGURATIONS.entries()) {
      await t.test(`row 15–19 configuration ${index + 1} renders each physical table once`, () => {
        slots = [];
        const assigned = configuration.map((group, groupIndex) => ({
          ...base,
          id: 100 + groupIndex,
          name: `Configurazione ${index + 1} ${group}`,
          party_size: TABLE_ASSIGNMENTS[group],
          tables: group,
          status: 'confirmed',
          booking_type: 'normale',
        }));
        const tree = render({ appointments: assigned });
        const rowGroups = tree.filter(node => node.props['data-unit'])
          .map(node => node.props['data-unit'])
          .filter(group => physicalTableIds(group).some(id => Number(id) >= 15 && Number(id) <= 19));
        assert.deepEqual([...rowGroups].sort(), [...configuration].sort());
        const rowIds = rowGroups.flatMap(physicalTableIds);
        assert.deepEqual([...rowIds].sort((a, b) => Number(a) - Number(b)), ['15', '16', '17', '18', '19']);
        assert.equal(new Set(rowIds).size, rowIds.length, 'nessun tavolo fisico compare in più gruppi');
      });
    }

    await t.test('linked-table change opens the exact existing booking without a write', () => {
      slots = []; let tree = render();
      assert.equal(tree.some(node => node.props['data-unit'] === ''), false);
      unit(tree, '10+11').props.onClick(); tree = render();
      assert.equal(tree.find(node => node.props.id === 'table-map-detail').props.tabIndex, -1);
      assert.ok(tree.some(node => node.type === 'a' && node.props.href?.endsWith('#booking-1')));
      tree.find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === 'Cambia tavolo').props.onClick();
      assert.equal(opened.at(-1), base);
      assert.equal(tree.some(node => node.type === 'select'), false, 'assignments are selected from the map');
      const disabledTree = render({ disabled: true });
      unit(disabledTree, '10+11').props.onClick();
      assert.equal(opened.length, 1);
      assert.equal(calls.length, 0);
    });

    await t.test('shared units retain all linked bookings and never offer terminal-booking assignment', () => {
      slots = []; const shared = [...rows, { ...base, id: 7, name: 'Secondo Arrivo', booking_time: '22:30' }];
      let tree = render({ appointments: shared }); unit(tree, '10+11').props.onClick(); tree = render({ appointments: shared });
      assert.ok(tree.some(node => node.type === 'a' && node.props.href?.endsWith('#booking-1')));
      assert.ok(tree.some(node => node.type === 'a' && node.props.href?.endsWith('#booking-7')));
      assert.equal(tree.some(node => node.type === 'select'), false, 'the map has no assignment dropdown');
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
      assert.equal(button.props.children[1].props.children, 'Non venuto');
      await button.props.onClick(); assert.equal(marked[0], base);
      const disabledAction = render({ ...props, disabled: true }).find(node => node.type?.name === 'BookingNoShowAction');
      assert.equal(disabledAction.type(disabledAction.props).props.disabled, true);
      await disabledAction.type(disabledAction.props).props.onClick(); assert.equal(marked.length, 1);
      unit(tree, '15+16+17').props.onClick(); tree = render(props);
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
      assert.equal(tree.find(node => node.props.children === 'SALVO…').props.disabled, true);
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
