import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('Contatti groups call and WhatsApp and hides unavailable actions', async () => {
  const server = await createServer({
    server: {
      middlewareMode: true,
      hmr: false,
    },
  });

  function nodes(element) {
    if (!element || typeof element !== 'object') {
      return [];
    }

    return [
      element,
      ...[element.props?.children]
        .flat(Infinity)
        .flatMap(nodes),
    ];
  }

  try {
    const { default: Contacts } =
      await server.ssrLoadModule(
        '/src/components/BookingContacts.jsx'
      );

    let whatsAppCalls = 0;

    const booking = {
      id: 42,
      name: 'Cliente',
      phone: '+39 333 1234567',
    };

    let tree = nodes(
      Contacts({
        booking,
        onWhatsApp: () => {
          whatsAppCalls++;
        },
      })
    );

    const call = tree.find(
      node =>
        node.type === 'a'
        && node.props['aria-label'] === 'Chiama'
    );

    const whatsapp = tree.find(
      node =>
        node.type === 'button'
        && node.props['aria-label'] === 'Apri WhatsApp con messaggio precompilato: invio manuale'
    );

    assert.ok(tree.some(node => node.type === 'details'));
    assert.ok(tree.some(node => node.type === 'summary'
      && nodes(node).some(child => child.type === 'span' && child.props.children === 'Contatti')));

    assert.ok(call);
    assert.equal(
      call.props.href,
      'tel:+393331234567'
    );

    assert.ok(whatsapp);
    assert.ok(tree.some(node => node.type === 'span' && node.props.children === 'Chiama'));
    assert.ok(tree.some(node => node.type === 'span' && node.props.children === 'WhatsApp'));
    assert.equal(
      whatsapp.props.disabled,
      false
    );

    whatsapp.props.onClick();

    assert.equal(
      whatsAppCalls,
      1
    );

    assert.ok(
      tree.some(
        node =>
          node.type === 'svg'
          && node.props['aria-hidden']
            === 'true'
      )
    );

    assert.ok(tree.some(node => node.props?.role === 'group'));

    for (
      const phone of [
        '',
        null,
        'invalid',
      ]
    ) {
      tree = nodes(
        Contacts({
          booking: {
            ...booking,
            phone,
          },
          onWhatsApp: () => {
            whatsAppCalls++;
          },
        })
      );

      assert.equal(tree.length, 0);
    }

    tree = nodes(
      Contacts({
        booking,
        busy: true,
        onWhatsApp: () => {
          whatsAppCalls++;
        },
      })
    );

    assert.equal(
      tree.find(
        node =>
          node.type === 'button'
          && node.props[
            'aria-label'
          ] === 'Apri WhatsApp con messaggio precompilato: invio manuale'
      ).props.disabled,
      true
    );

    assert.equal(
      whatsAppCalls,
      1
    );
  } finally {
    await server.close();
  }
});
