import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';

// Le fixture del servizio usano il 4 ottobre:
// isolare i test dalla data reale.
beforeEach(context =>
  context.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-10-04T12:00:00Z'),
  })
);

test(
  'giornata renders compact bookings, mobile shell and table map without exposing secondary details',
  async () => {
    const previousWindow = globalThis.window;

    globalThis.window = {
      location: {
        search: '?date=2026-10-04',
        hash: '',
        pathname: '/prenotazioni/giorno',
      },
    };

    const server = await createServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },

      plugins: [
        {
          name: 'test-day-data',
          enforce: 'pre',

          load(id) {
            if (id.endsWith('/src/hooks/useMobileLayout.js')) {
              return `
                export default function useMobileLayout() {
                  return Boolean(globalThis.__agendaMobileFixture);
                }
              `;
            }

            if (id.endsWith('/src/hooks/useAppointments.js')) {
              return `
                export function useAppointments() {
                  return {
                    appointments: [
                      {
                        id: 1,
                        name: 'Senza Contatti',
                        phone: '',
                        email: '',
                        booking_date: '2026-10-04',
                        booking_time: '20:00',
                        party_size: 2,
                        tables: '',
                        status: globalThis.__agendaStatusFixture || 'confirmed',
                        source: 'agenda'
                      },
                      {
                        id: 2,
                        name: 'Con Telefono',
                        phone: '+393331234567',
                        email: 'cliente@example.com',
                        booking_date: '2026-10-04',
                        booking_time: '20:30',
                        party_size: 2,
                        tables: '12',
                        status: 'confirmed',
                        source: 'agenda'
                      }
                    ],
                    loading: false,
                    error: null,
                    refresh() {},
                    applyUpdate() {}
                  };
                }
              `;
            }
          },
        },
      ],
    });

    try {
      const { default: Page } =
        await server.ssrLoadModule(
          '/src/pages/BookingsPage.jsx'
        );

      const html = renderToString(
        React.createElement(Page)
      );

      /*
       * LISTA COMPATTA
       */

      assert.match(
        html,
        /class="booking-admin bookings-day-page"/
      );

      assert.match(
        html,
        /<time dateTime="2026-10-04">domenica 4 ottobre 2026<\/time>/
      );

      assert.match(
        html,
        /id="booking-1"/
      );

      assert.match(
        html,
        /id="booking-2"/
      );

      const firstStart =
        html.indexOf('<article id="booking-1"');

      const firstEnd =
        html.indexOf('</article>', firstStart);

      const firstCard =
        html.slice(firstStart, firstEnd);

      assert.match(
        firstCard,
        /booking-row booking-card-compact/
      );

      assert.match(
        firstCard,
        /class="booking-card-summary"/
      );

      assert.match(
        firstCard,
        /aria-haspopup="dialog"/
      );

      assert.match(
        firstCard,
        /aria-controls="booking-detail-drawer"/
      );

      assert.match(
        firstCard,
        /aria-expanded="false"/
      );

      assert.match(
        firstCard,
        /20:00/
      );

      assert.match(
        firstCard,
        /Senza Contatti/
      );

      assert.match(
        firstCard,
        /2(?:<!-- -->)?\s*(?:<!-- -->)?persone/
      );

      assert.match(
        firstCard,
        /Confermata/
      );

      // La prenotazione senza tavolo mostra solo il flag compatto.
      assert.match(
        firstCard,
        /booking-flag-table/
      );

      assert.match(
        firstCard,
        /Senza tavolo/
      );

      // I dati secondari non devono essere nella riga.
      assert.doesNotMatch(
        firstCard,
        /booking-card-phone/
      );

      assert.doesNotMatch(
        firstCard,
        /booking-card-type/
      );

      assert.doesNotMatch(
        firstCard,
        /booking-card-quick-actions/
      );

      assert.doesNotMatch(
        firstCard,
        /booking-card-content/
      );

      assert.doesNotMatch(
        firstCard,
        /ASSEGNA TAVOLO|Modifica prenotazione|Arrivato|Non venuto/
      );

      /*
       * PRENOTAZIONE CON TAVOLO
       */

      const secondStart =
        html.indexOf('<article id="booking-2"');

      const secondEnd =
        html.indexOf('</article>', secondStart);

      const secondCard =
        html.slice(secondStart, secondEnd);

      assert.match(
        secondCard,
        /booking-row booking-card-compact/
      );

      assert.match(
        secondCard,
        /Con Telefono/
      );

      assert.match(
        secondCard,
        /20:30/
      );

      assert.doesNotMatch(
        secondCard,
        /Senza tavolo/
      );

      // Telefono e tavolo non vengono mostrati nella lista.
      assert.doesNotMatch(
        secondCard,
        /\+393331234567|Tavolo 12|booking-card-phone/
      );

      /*
       * DRAWER CHIUSO AL RENDER INIZIALE
       */

      assert.doesNotMatch(
        html,
        /id="booking-detail-drawer"/
      );

      assert.doesNotMatch(
        html,
        /Comunicazioni e log|Storico modifiche|customer-card|marketing-consent-panel/
      );

      /*
       * FILTRO SENZA TAVOLO
       */

      assert.match(
        html,
        /Da assegnare/
      );

      assert.doesNotMatch(
        html,
        /type="checkbox" checked=""/
      );

      /*
       * STATO DELLA RIGA
       */

      for (const status of [
        'arrived',
        'seated',
        'completed',
        'no_show',
      ]) {
        globalThis.__agendaStatusFixture = status;

        const stateHtml = renderToString(
          React.createElement(Page)
        );

        const stateStart =
          stateHtml.indexOf('<article id="booking-1"');

        const stateEnd =
          stateHtml.indexOf('</article>', stateStart);

        const stateCard =
          stateHtml.slice(stateStart, stateEnd);

        assert.match(
          stateCard,
          /Senza Contatti/
        );

        assert.match(
          stateCard,
          /booking-card-summary/
        );

        // Le azioni operative restano fuori dalla riga.
        assert.doesNotMatch(
          stateCard,
          /Fai accomodare|Libera tavolo|Cambia stato|Modifica prenotazione/
        );
      }

      globalThis.__agendaStatusFixture = 'cancelled';
      const cancelledHtml = renderToString(
        React.createElement(Page)
      );
      assert.doesNotMatch(cancelledHtml, /<article id="booking-1"/);
      assert.match(cancelledHtml, /<article id="booking-2"/);

      globalThis.__agendaStatusFixture = 'confirmed';
      const restoredHtml = renderToString(
        React.createElement(Page)
      );
      assert.match(restoredHtml, /<article id="booking-1"/);

      delete globalThis.__agendaStatusFixture;

      /*
       * MAPPA DI ASSEGNAZIONE
       */

      globalThis.window.location.search =
        '?date=2026-10-04&assign=1';

      globalThis.__agendaStatusFixture = 'cancelled';
      const cancelledMapHtml = renderToString(
        React.createElement(Page)
      );
      assert.match(cancelledMapHtml, /<h2[^>]*>Mappa tavoli<\/h2>/);
      assert.doesNotMatch(
        cancelledMapHtml,
        /assignment-selected-booking/
      );

      globalThis.__agendaStatusFixture = 'confirmed';
      const mapHtml = renderToString(
        React.createElement(Page)
      );
      delete globalThis.__agendaStatusFixture;

      assert.match(
        mapHtml,
        /Assegna tavolo/
      );

      assert.match(
        mapHtml,
        /assignment-selected-booking/
      );

      assert.match(
        mapHtml,
        /Senza Contatti/
      );

      assert.match(
        mapHtml,
        /combinazione consigliata/
      );

      assert.match(
        mapHtml,
        /Seleziona consigliata/
      );

      assert.match(
        mapHtml,
        /<section id="agenda-list"[^>]*hidden=""/
      );

      assert.match(
        mapHtml,
        /<section id="agenda-map"[^>]*aria-label="Mappa tavoli della giornata"/
      );

      /*
       * MOBILE
       */

      globalThis.window.location.search =
        '?date=2026-10-04';

      globalThis.window.location.hash = '';

      globalThis.__agendaMobileFixture = true;

      const mobileHtml = renderToString(
        React.createElement(Page)
      );

      assert.doesNotMatch(
        mobileHtml,
        /Richieste clienti|>Aggiorna<\/button>|class="day-summary"/
      );

      assert.match(
        mobileHtml,
        /agenda-day-summary/
      );

      assert.match(
        mobileHtml,
        /agenda-online-toggle is-unknown/
      );

      assert.match(
        mobileHtml,
        /<time dateTime="2026-10-04">domenica 4 ottobre 2026/
      );

      assert.match(
        mobileHtml,
        /booking-row booking-card-compact/
      );

      assert.match(
        mobileHtml,
        /class="booking-card-summary"/
      );

      assert.doesNotMatch(
        mobileHtml,
        /id="booking-detail-drawer"/
      );

      assert.ok(
        mobileHtml.indexOf('agenda-heading') <
          mobileHtml.indexOf('agenda-day-summary')
      );

      assert.match(
        mobileHtml,
        /mobile-primary-action/
      );

      assert.match(
        mobileHtml,
        /bookings-day-page/
      );

      /*
       * SHELL MOBILE
       */

      globalThis.window.location.pathname =
        '/prenotazioni/giorno';

      const { default: App } =
        await server.ssrLoadModule(
          '/src/App.jsx'
        );

      const shell = renderToString(
        React.createElement(App)
      );

      assert.match(
        shell,
        /<nav class="admin-mobile-nav" aria-label="Navigazione Agenda">/
      );

      assert.match(
        shell,
        /href="\/prenotazioni" aria-current="page">Agenda<\/a>/
      );

      assert.doesNotMatch(
        shell,
        /href="\/lista-attesa"/
      );

      assert.match(
        shell,
        /href="\/attivita">Attività<\/a>/
      );

      globalThis.window.location.pathname = '/';

      assert.doesNotMatch(
        renderToString(
          React.createElement(App)
        ),
        /admin-mobile-nav/
      );

      delete globalThis.__agendaMobileFixture;

      /*
       * NOTIFICHE
       */

      const { default: Notifications } =
        await server.ssrLoadModule(
          '/src/components/AdminNotifications.jsx'
        );

      const notifications = renderToString(
        React.createElement(Notifications)
      );

      assert.match(
        notifications,
        /notification-bell/
      );

      assert.match(
        notifications,
        /notification-badge/
      );

      assert.match(
        notifications,
        /aria-expanded="false"/
      );

      const { default: Activity } =
        await server.ssrLoadModule(
          '/src/pages/ActivityPage.jsx'
        );

      const activity = renderToString(
        React.createElement(Activity)
      );

      assert.match(
        activity,
        /activity-filters/
      );

      assert.match(
        activity,
        /activity-search/
      );

      /*
       * MAPPA TAVOLI
       */

      const { default: Map } =
        await server.ssrLoadModule(
          '/src/components/TableMap.jsx'
        );

      const booking = {
        id: 1,
        name: 'Senza Contatti',
        booking_date: '2026-10-04',
        booking_time: '20:00',
        party_size: 2,
        tables: '',
        status: 'confirmed',
      };

      const map = renderToString(
        React.createElement(Map, {
          appointments: [booking],
          date: booking.booking_date,
          assignmentBooking: booking,
        })
      );

      assert.match(
        map,
        /Sala Principale/
      );

      assert.match(
        map,
        /Sala Nami/
      );

      assert.match(
        map,
        /Senza Contatti/
      );

      assert.doesNotMatch(
        map,
        /Prenotazione da assegnare/
      );

      assert.equal(
        (
          map.match(
            /class="table-map-number"/g
          ) || []
        ).length,
        10
      );

      assert.equal(
        (
          map.match(
            /class="table-map-state"/g
          ) || []
        ).length,
        10
      );

      assert.ok(
        map.indexOf('table-map-rooms') <
          map.indexOf('table-map-suggestions'),
        'rooms precede assignment alternatives'
      );

      assert.match(
        map,
        /<details class="table-map-alternatives"><summary>Vedi tutte le combinazioni/
      );

      const occupiedMap = renderToString(
        React.createElement(Map, {
          appointments: [
            {
              ...booking,
              id: 3,
              tables: '10+11',
              status: 'confirmed',
            },
            {
              ...booking,
              id: 4,
              tables: '12',
              status: 'arrived',
            },
          ],
          date: booking.booking_date,
        })
      );

      assert.match(
        occupiedMap,
        /is-reserved/
      );

      assert.match(
        occupiedMap,
        /is-occupied/
      );

      assert.match(
        occupiedMap,
        /is-free/
      );

      assert.match(
        occupiedMap,
        /Tavolo 12: OCCUPATO/
      );
    } finally {
      delete globalThis.__agendaStatusFixture;
      delete globalThis.__agendaMobileFixture;

      await server.close();

      if (previousWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window =
          previousWindow;
      }
    }
  }
);