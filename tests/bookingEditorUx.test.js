import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('booking editor protects unsaved changes and duplicate saves', async () => {
  const previousHooks = globalThis.__editorHooks;
  const previousClient = globalThis.__editorClient;
  const previousWindow = globalThis.window;
  let slots = [], index = 0, effects = [], rpcCalls = 0, resolveRpc;
  globalThis.__editorHooks = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
    },
    useRef(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useEffect(fn) { effects.push(fn); },
  };
  globalThis.__editorClient = {
    rpc: async (_name, args) => {
      rpcCalls++;
      await new Promise(resolve => { resolveRpc = resolve; });
      return { data: { booking: { ...booking, ...args.changes } }, error: null };
    },
  };
  let confirms = [], editing = [], dirty = [], saved = [];
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    confirm(message) { confirms.push(message); return false; },
  };
  const booking = { id: 42, booking_date: '2026-10-10', booking_time: '20:00', party_size: 2, tables: '', notes: '', status: 'confirmed', booking_type: 'normale' };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{
    name: 'booking-editor-ux-harness', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/src/components/BookingEditor.jsx')) return code.replace(
        "import { useEffect, useRef, useState } from 'react';",
        'const {useEffect,useRef,useState}=globalThis.__editorHooks;'
      );
    },
    load(id) { if (id.endsWith('/src/lib/supabase.js')) return 'export const supabase=globalThis.__editorClient;'; },
  }] });
  function nodes(element) { return !element || typeof element !== 'object' ? [] : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]; }
  function render(Component) {
    index = 0; effects = [];
    const tree = nodes(Component({ booking, appointments: [booking], hideTableField: true,
      onEditing: value => editing.push(value), onDirtyChange: value => dirty.push(value), onSaved: value => saved.push(value) }));
    effects.forEach(effect => effect());
    return tree;
  }
  try {
    const { default: Editor } = await server.ssrLoadModule('/src/components/BookingEditor.jsx');
    let tree = render(Editor);
    tree.find(node => node.type === 'button').props.onClick();
    tree = render(Editor);
    const serviceSelect = tree.find(node => node.type === 'select' && node.props.name === 'booking_type');
    assert.deepEqual(nodes(serviceSelect).filter(node => node.type === 'option').map(node => node.props.value), ['normale','dopocena']);
    serviceSelect.props.onChange({ target: { name: 'booking_type', value: 'dopocena' } });
    tree = render(Editor);
    assert.equal(tree.find(node => node.type === 'input' && node.props.name === 'booking_time').props.value, '23:00');
    tree.find(node => node.type === 'select' && node.props.name === 'booking_type').props.onChange({ target: { name: 'booking_type', value: 'normale' } });
    tree = render(Editor);
    tree.find(node => node.type === 'textarea').props.onChange({ target: { name: 'notes', value: 'Terrazza' } });
    tree = render(Editor);
    assert.equal(dirty.at(-1), true);

    tree.find(node => node.type === 'button' && node.props.children === 'Annulla').props.onClick();
    assert.equal(confirms.length, 1);
    assert.equal(editing.at(-1), true);

    const form = tree.find(node => node.type === 'form');
    const event = { preventDefault() {} };
    const first = form.props.onSubmit(event);
    const second = form.props.onSubmit(event);
    assert.equal(rpcCalls, 1);
    resolveRpc();
    await Promise.all([first, second]);
    assert.equal(saved.length, 1);
    assert.equal(editing.at(-1), false);
  } finally {
    await server.close();
    globalThis.window = previousWindow;
    if (previousHooks === undefined) delete globalThis.__editorHooks; else globalThis.__editorHooks = previousHooks;
    if (previousClient === undefined) delete globalThis.__editorClient; else globalThis.__editorClient = previousClient;
  }
});
