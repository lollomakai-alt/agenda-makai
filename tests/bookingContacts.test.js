import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Harness dei soli hook: esercita gli handler reali del componente senza DOM.
test('Contatti opens call/WhatsApp choices, closes and reuses the supplied WhatsApp action', async () => {
  const previousHooks = globalThis.__contactsHooks;
  const previousDocument = globalThis.document;
  const slots = [];
  let index = 0;
  let effects = [];
  let cleanups = [];
  const listeners = new Map();
  globalThis.document = {
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: (event, fn) => { if (listeners.get(event) === fn) listeners.delete(event); },
  };
  globalThis.__contactsHooks = {
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
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, plugins: [{
    name: 'contacts-hook-harness', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/src/components/BookingContacts.jsx')) return code.replace(
        "import { useEffect, useRef, useState } from 'react';",
        'const { useEffect, useRef, useState } = globalThis.__contactsHooks;');
    },
  }] });
  function nodes(element) {
    if (!element || typeof element !== 'object') return [];
    return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
  }
  try {
    const { default: Contacts } = await server.ssrLoadModule('/src/components/BookingContacts.jsx');
    let whatsAppCalls = 0;
    const props = { booking: { id: 42, name: 'Cliente', phone: '+39 333 1234567' }, onWhatsApp: () => whatsAppCalls++ };
    function render(overrides = {}) {
      cleanups.forEach(fn => fn?.()); cleanups = []; effects = []; index = 0;
      const tree = Contacts({ ...props, ...overrides });
      cleanups = effects.map(fn => fn());
      return nodes(tree);
    }
    let tree = render();
    let trigger = tree.find(node => node.type === 'button');
    assert.equal(trigger.props.disabled, false);
    assert.equal(trigger.props['aria-expanded'], false);
    assert.ok(tree.some(node => node.type === 'svg' && node.props['aria-hidden'] === 'true'));
    assert.ok(!tree.some(node => node.type === 'a'));
    trigger.props.onClick();
    tree = render();
    assert.equal(tree.find(node => node.type === 'button').props['aria-expanded'], true);
    const call = tree.find(node => node.type === 'a');
    assert.equal(call.props.href, 'tel:+393331234567');
    assert.equal(call.props.children, 'Chiama');
    const whatsapp = tree.find(node => node.type === 'button' && node.props.children === 'WhatsApp');
    whatsapp.props.onClick();
    assert.equal(whatsAppCalls, 1);
    tree = render();
    assert.ok(!tree.some(node => node.props.role === 'group'));
    tree.find(node => node.type === 'button').props.onClick();
    tree = render();
    tree.find(node => node.type === 'a').props.onClick();
    assert.ok(!render().some(node => node.type === 'a'));
    render().find(node => node.type === 'button').props.onClick();
    render(); listeners.get('keydown')({ key: 'Escape' });
    assert.ok(!render().some(node => node.type === 'a'));
    render().find(node => node.type === 'button').props.onClick();
    render(); listeners.get('pointerdown')({ target: {} });
    assert.ok(!render().some(node => node.type === 'a'));
    for (const phone of ['', null, 'invalid']) {
      tree = render({ booking: { ...props.booking, phone } });
      assert.equal(tree.find(node => node.type === 'button').props.disabled, true);
      assert.ok(tree.some(node => node.type === 'small' && node.props.children === 'Numero non disponibile'));
      assert.ok(!tree.some(node => node.type === 'a'));
    }
    tree = render({ busy: true });
    assert.equal(tree.find(node => node.type === 'button').props.disabled, true);
    assert.equal(whatsAppCalls, 1);
  } finally {
    cleanups.forEach(fn => fn?.());
    await server.close();
    if (previousHooks === undefined) delete globalThis.__contactsHooks; else globalThis.__contactsHooks = previousHooks;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
