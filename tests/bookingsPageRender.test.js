import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { bookingsToCsv, formatBookingServiceDate, prepareBookingExport } from '../src/utils/bookingExport.js';

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
                  const appointments = [
                      {
                        id: 1,
                        name: 'Senza Contatti',
                        phone: '',
                        email: '',
                        booking_date: '2026-10-04',
                        booking_time: '20:00',
                        booking_type: 'normale',
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
                        booking_type: 'normale',
                        party_size: 2,
                        tables: '12',
                        status: 'confirmed',
                        source: 'agenda'
                      }
                    ];
                  if (globalThis.__agendaGroupFixture) appointments.push({
                    id: 3,
                    name: 'Cliente DOPOCENA',
                    phone: '',
                    email: '',
                    booking_date: '2026-10-04',
                    booking_time: '22:47',
                    booking_type: 'dopocena',
                    party_size: 3,
                    tables: globalThis.__agendaAssignedAfterDinnerFixture ? '10+11' : '',
                    status: 'confirmed',
                    source: 'agenda'
                  });
                  if (globalThis.__agendaGroupFixture) appointments.push(
                    {
                      id: 4, name: 'Cliente Cancellato', phone: '', email: '', booking_date: '2026-10-04',
                      booking_time: '19:00', booking_type: 'normale', party_size: 2, tables: '13+14',
                      status: 'cancelled', source: 'agenda'
                    },
                    {
                      id: 5, name: 'Cliente No-show', phone: '', email: '', booking_date: '2026-10-04',
                      booking_time: '23:30', booking_type: 'dopocena', party_size: 4, tables: '',
                      status: 'no_show', source: 'agenda'
                    }
                  );
                  const loadState = globalThis.__agendaLoadFixture || {};
                  return {
                    appointments,
                    loading: loadState.loading ?? false,
                    error: loadState.error ?? null,
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

      globalThis.__agendaGroupFixture = true;
      const html = renderToString(
        React.createElement(Page)
      );
      globalThis.__agendaGroupFixture = false;
      const normalizedHtml = html.replaceAll('<!-- -->', '');

      /*
       * LISTA COMPATTA
       */

      assert.match(
        html,
        /class="booking-admin bookings-day-page"/
      );

      assert.match(html, /aria-label="Nuova prenotazione"/);
      assert.match(html, /agenda-create-text">Nuova prenotazione<\/span>/);

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
        /Senza Contatti/
      );

      assert.doesNotMatch(firstCard, /booking-card-time|20:00/);

      assert.match(normalizedHtml, /<h2 id="time-20:00" class="booking-time-heading">[\s\S]*?<time>20:00<\/time>[\s\S]*?<span class="booking-time-count">· 1 prenotazione/);
      assert.match(normalizedHtml, /<h2 id="time-20:30" class="booking-time-heading">[\s\S]*?<time>20:30<\/time>[\s\S]*?<span class="booking-time-count">· 1 prenotazione/);
      assert.match(normalizedHtml, /<h2 id="time-22:47" class="booking-time-heading">[\s\S]*?<time>22:47<\/time>[\s\S]*?<span class="booking-time-count">· 1 prenotazione/);
      assert.ok(normalizedHtml.indexOf('id="time-20:00"') < normalizedHtml.indexOf('id="time-20:30"'));
      assert.match(normalizedHtml, /class="booking-row booking-card-compact service-dopocena/);
      assert.match(normalizedHtml, /Tavolo da assegnare/);
      globalThis.__agendaGroupFixture = true;
      globalThis.__agendaAssignedAfterDinnerFixture = true;
      const assignedAfterDinnerHtml = renderToString(React.createElement(Page));
      assert.match(assignedAfterDinnerHtml, /Cliente DOPOCENA/);
      assert.match(assignedAfterDinnerHtml, /Tavolo 10\+11/);
      delete globalThis.__agendaAssignedAfterDinnerFixture;
      globalThis.__agendaGroupFixture = false;
      const printStart = html.indexOf('class="booking-export-print"');
      const printEnd = html.indexOf('</section>', printStart);
      const printMarkup = html.slice(printStart, printEnd);
      assert.match(printMarkup, /Makai — Prenotazioni/);
      assert.match(printMarkup, /domenica 4 ottobre 2026/);
      assert.match(printMarkup, /Ora[\s\S]*Turno[\s\S]*Cliente[\s\S]*Persone[\s\S]*Tavolo[\s\S]*Stato/);
      assert.match(printMarkup, /Cliente DOPOCENA/);
      assert.match(printMarkup, /Cliente No-show/);
      assert.doesNotMatch(printMarkup, /Cliente Cancellato|\+393331234567|cliente@example\.com|consenso|marketing/);
      assert.match(html, /<summary>Esporta \/ Stampa<\/summary>[\s\S]*>Stampa<\/button>[\s\S]*>Scarica CSV<\/button>/);
      assert.ok(html.indexOf('booking-time-groups') < html.indexOf('booking-export-tools'));

      globalThis.__agendaLoadFixture = { loading: true };
      const loadingExport = renderToString(React.createElement(Page));
      assert.match(loadingExport, /Esportazione disponibile al termine del caricamento/);
      assert.match(loadingExport, /<button type="button" disabled=""[^>]*>Stampa/);
      globalThis.__agendaLoadFixture = { error: { message: 'offline' } };
      const failedExport = renderToString(React.createElement(Page));
      assert.match(failedExport, /Esportazione non disponibile: impossibile caricare tutte le prenotazioni/);
      assert.match(failedExport, /<button type="button" disabled=""[^>]*>Scarica CSV/);
      delete globalThis.__agendaLoadFixture;

      assert.match(
        firstCard,
        /Senza Contatti/
      );

      assert.match(
        firstCard,
        /2(?:<!-- -->)?\s*(?:<!-- -->)?pers\./
      );

      assert.match(
        firstCard,
        /Confermata/
      );

      assert.match(
        firstCard,
        /booking-card-table is-unassigned">Tavolo da assegnare/
      );

      assert.doesNotMatch(firstCard, /booking-flag-table|DA ASSEGNARE/);
      assert.doesNotMatch(firstCard, />!<|>\s+!\s*</);
      assert.match(normalizedHtml, /agenda-unassigned-count[^>]*>[\s\S]*?da assegnare/);

      // Gli indicatori operativi restano raggiungibili con azioni touch.
      assert.doesNotMatch(
        firstCard,
        /booking-card-phone/
      );

      assert.doesNotMatch(
        firstCard,
        /booking-card-type/
      );

      assert.match(
        firstCard,
        /booking-indicator is-status/
      );

      assert.doesNotMatch(html, /Filtro turno|>TUTTE</);
      assert.match(html, /service-normale/);
      assert.match(html, /service-dopocena/);

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
        /booking-card-compact/
      );

      assert.doesNotMatch(secondCard, /booking-card-time|20:30/);

      assert.doesNotMatch(
        secondCard,
        /Senza tavolo/
      );

      // Telefono e tavolo non vengono mostrati nella lista.
      assert.doesNotMatch(
        secondCard,
        /\+393331234567|booking-card-phone/
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

      assert.doesNotMatch(html, /DA ASSEGNARE/);

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

      assert.match(mapHtml, /CONFERMA/);
      assert.doesNotMatch(mapHtml, /Seleziona combinazione|Nuova assegnazione/);

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

      // The header is now behind AdminAccess: SSR must not expose private navigation.
      assert.match(shell, /Verifica dell’accesso|Configura Supabase/);
      assert.doesNotMatch(shell, /mobile-header-menu|notification-bell/);

      assert.doesNotMatch(shell, /admin-mobile-nav/);

      assert.doesNotMatch(
        shell,
        /href="\/prenotazioni" aria-current="page">Agenda<\/a>/
      );

      assert.doesNotMatch(
        shell,
        /href="\/lista-attesa"/
      );

      assert.doesNotMatch(
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

      const { default: Archive } =
        await server.ssrLoadModule(
          '/src/pages/ArchivePage.jsx'
        );

      const archive = renderToString(
        React.createElement(Archive)
      );

      assert.match(
        archive,
        /Archivio/
      );

      assert.match(
        archive,
        /Eventi/
      );

      assert.match(
        archive,
        /Caricamento archivio/
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
          booking_type: 'normale',
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

      assert.ok(
        (
          map.match(
            /class="table-map-number"/g
          ) || []
        ).length >= 10
      );

      assert.ok(
        (
          map.match(
            /class="table-map-state"/g
          ) || []
        ).length >= 10
      );

      assert.match(map, /class="table-map-rooms"/);
      assert.match(map, /table-map-assignment-bar/);
      assert.match(map, /CONFERMA/);
      assert.doesNotMatch(map, /table-map-assignment-options|Seleziona combinazione|Nuova assegnazione/);

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
      delete globalThis.__agendaLoadFixture;

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

test('booking export orders both services through midnight and creates spreadsheet-safe CSV', () => {
  const serviceDate = '2026-10-04';
  const rows = prepareBookingExport([
    { id: 1, booking_date: serviceDate, booking_time: '00:00', booking_type: 'dopocena', name: 'Arrivo mezzanotte', party_size: 3, tables: '12', status: 'arrived' },
    { id: 2, booking_date: serviceDate, booking_time: '23:30', booking_type: 'dopocena', name: '=HYPERLINK("https://example.com";"Apri")', party_size: 4, tables: '', status: 'no_show' },
    { id: 3, booking_date: serviceDate, booking_time: '19:30', booking_type: 'normale', name: 'Cena; "Cliente"', party_size: 2, tables: '13+14', status: 'confirmed' },
    { id: 4, booking_date: serviceDate, booking_time: '19:00', booking_type: 'normale', name: 'Cancellata', party_size: 2, tables: '', status: 'cancelled' },
    { id: 5, booking_date: '2026-10-05', booking_time: '18:00', booking_type: 'normale', name: 'Altro giorno', party_size: 2, tables: '', status: 'confirmed' },
  ], serviceDate);

  assert.deepEqual(rows.map(row => row.Ora), ['19:30', '23:30', '00:00']);
  assert.deepEqual(rows.map(row => row.Turno), ['CENA', 'DOPOCENA', 'DOPOCENA']);
  assert.deepEqual(rows.map(row => row.Tavolo), ['13+14', 'Da assegnare', '12']);
  assert.deepEqual(rows.map(row => row.Stato), ['Confermata', 'No-show', 'Arrivato']);

  const csv = bookingsToCsv(rows);
  assert.ok(csv.startsWith('\uFEFF"Ora";"Turno";"Cliente";"Persone";"Tavolo";"Stato"\r\n'));
  assert.match(csv, /"Cena; ""Cliente"""/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com"";""Apri""\)"/);
  assert.match(csv, /"Da assegnare"/);
  assert.doesNotMatch(csv, /Cancellata|Altro giorno/);
  assert.equal(formatBookingServiceDate(serviceDate), 'domenica 4 ottobre 2026');
});
