import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';

test('calendar and navigation remove secondary UI while retaining daylinks, month controls and live data rendering', async t => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: Date.parse('2026-10-06T12:00:00Z')
  });

  const previousWindow = globalThis.window;
  const previousData = globalThis.__cleanupData;

  globalThis.window = {
    location: {
      search: '?month=2026-10',
      pathname: '/prenotazioni',
      hash: ''
    }
  };

  globalThis.__cleanupData = {
    appointments: [
      {
        id: 1,
        booking_date: '2026-10-06',
        booking_time: '20:00',
        party_size: 3,
        status: 'confirmed'
      },
      {
        id: 2,
        booking_date: '2026-10-06',
        booking_time: '21:00',
        party_size: 5,
        status: 'cancelled'
      },
    ],
    loading: false,
    error: null
  };

  const server = await createServer({
    server: {
      middlewareMode: true,
      hmr: false,
      ws: false
    },
    plugins: [
      {
        name: 'cleanup-calendar-fixture',
        enforce: 'pre',

        load(id) {
          if (id.endsWith('/src/hooks/useAppointments.js')) {
            return 'export function useAppointments(){return globalThis.__cleanupData;}';
          }
        },
      },
    ]
  });

  try {
    const { default: Calendar } =
      await server.ssrLoadModule(
        '/src/pages/CalendarPage.jsx'
      );

    const render = () =>
      renderToString(
        React.createElement(Calendar)
      );

    let html = render();

    assert.doesNotMatch(
      html,
      /Richieste clienti|calendar-summary|coperti nel mese|Solo prenotazioni confermate|calendar-actions|>Aggiorna<\/button>|>Oggi<\/a>/
    );

    assert.match(
      html,
      /Mese precedente/
    );

    assert.match(
      html,
      /Mese successivo/
    );

    assert.match(
      html,
      /href="\?month=2026-09"/
    );

    assert.match(
      html,
      /href="\?month=2026-11"/
    );

    assert.match(
      html,
      /href="\/prenotazioni\/giorno\?date=2026-10-06"/
    );

    assert.match(
      html,
      /aria-label="martedì 6 ottobre 2026, oggi: 3 coperti, stato prenotazioni online da verificare"/
    );

    globalThis.__cleanupData.appointments[0].party_size = 4;

    assert.match(
      render(),
      /oggi: 4 coperti/
    );

    globalThis.__cleanupData.loading = true;

    assert.match(
      render(),
      /aria-busy="true"/
    );

    globalThis.__cleanupData.loading = false;

    globalThis.__cleanupData.error = {
      message: 'Connessione interrotta'
    };

    assert.match(
      render(),
      /role="alert">Connessione interrotta/
    );

    globalThis.__cleanupData.error = null;

    const { default: App } =
      await server.ssrLoadModule(
        '/src/App.jsx'
      );

    html = renderToString(
      React.createElement(App)
    );

    assert.doesNotMatch(
      html,
      /href="\/lista-attesa"/
    );

    assert.match(
      html,
      /href="\/prenotazioni" aria-current="page">Agenda/
    );

    assert.match(
      html,
      /href="\/attivita"/
    );

    assert.match(
      html,
      /<summary>Menu/
    );

    const { default: Notifications } =
      await server.ssrLoadModule(
        '/src/components/AdminNotifications.jsx'
      );

    assert.match(
      renderToString(
        React.createElement(
          Notifications
        )
      ),
      /notification-bell/
    );
  } finally {
    await server.close();

    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }

    if (previousData === undefined) {
      delete globalThis.__cleanupData;
    } else {
      globalThis.__cleanupData = previousData;
    }
  }
});