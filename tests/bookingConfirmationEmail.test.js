import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('confirmation email visibility, exact invocation, busy guard and feedback', async () => {
  const previous = globalThis.__emailHarness;
  const slots = [];
  let index = 0, calls = [], resolveSend;
  const booking = { id: 42, status: 'confirmed', email: 'cliente@example.com', name: 'Cliente' };
  globalThis.__emailHarness = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], value => { slots[slot] = value; }];
    },
    useRef(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    supabase: {}, emailSendBlocked:()=>false, sendCommunication: (client, bookingId) => {
      calls.push({client,bookingId});
      return new Promise(resolve => { resolveSend = resolve; });
    },
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{
    name: 'confirmation-email-harness', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/src/components/BookingConfirmationEmail.jsx')) return code
        .replace("import { useRef, useState } from 'react';", 'const { useRef, useState } = globalThis.__emailHarness;')
        .replace("import { supabase } from '../lib/supabase';", 'const { supabase } = globalThis.__emailHarness;')
        .replace("import { sendCommunication, emailSendBlocked } from '../utils/bookingCommunications';", 'const sendCommunication = (...args) => globalThis.__emailHarness.sendCommunication(...args); const emailSendBlocked = (...args) => globalThis.__emailHarness.emailSendBlocked(...args);');
    },
  }] });
  const nodes = element => !element || typeof element !== 'object' ? []
    : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
  try {
    const { default: Component } = await server.ssrLoadModule('/src/components/BookingConfirmationEmail.jsx');
    const render = (overrides = {}) => { index = 0; return nodes(Component({ booking: { ...booking, ...overrides }, ready:true })); };
    for (const status of ['arrived', 'completed', 'cancelled', 'no_show', null]) assert.equal(render({ status }).length, 0);
    for (const email of ['', null, 'invalid', 'a b@example.com', 'a@example.com\n', 'x'.repeat(121)]) assert.equal(render({ email }).length, 0);
    const button = render().find(node => node.type === 'button');
    assert.equal(button.props.children, 'Invia conferma email');
    assert.equal(button.props.disabled, false);
    const pending = button.props.onClick();
    await button.props.onClick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bookingId,42);assert.equal(calls[0].client,globalThis.__emailHarness.supabase);
    assert.equal(render().find(node => node.type === 'button').props.disabled, true);
    resolveSend({ status: 'accepted' }); await pending;
    assert.equal(render().find(node => node.type === 'button').props.disabled, true);
    assert.equal(render().find(node => node.props.role === 'status').props.children, 'Email accettata dal servizio.');
    for (const result of [{ status: 'unknown' }, { status: 'failed' }]) {
      slots.length=0;
      const send = render().find(node => node.type === 'button').props.onClick();
      assert.ok(!render().some(node => node.props.role === 'status'));
      resolveSend(result); await send;
      assert.ok(render().find(node => node.props.role === 'alert'));
      assert.equal(render().find(node => node.type === 'button').props.disabled, result.status==='unknown');
    }
    slots.length=0;
    globalThis.__emailHarness.sendCommunication = async () => { throw new Error('network'); };
    await render().find(node => node.type === 'button').props.onClick();
    assert.ok(render().some(node => node.props.role === 'alert'));
    assert.equal(render().find(node => node.type === 'button').props.disabled,true);
  } finally {
    await server.close();
    globalThis.__emailHarness = previous;
  }
});
