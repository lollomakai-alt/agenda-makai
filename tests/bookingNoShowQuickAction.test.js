import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { tableMapForDate } from '../src/utils/tableMap.js';

const nodes = element =>
  !element || typeof element !== 'object'
    ? []
    : [
        element,
        ...[element.props?.children]
          .flat(Infinity)
          .flatMap(nodes),
      ];

const original = {
  id: 42,
  name: 'Cliente',
  booking_date: '2026-10-04',
  booking_time: '20:00',
  party_size: 2,
  tables: '12',
  phone: '+393331234567',
  status: 'confirmed',
};

const boundary = Date.parse('2026-10-04T18:30:00Z');

test(
  'quick no-show uses existing eligibility, confirmation and status RPC; releases only after confirmed save',
  async t => {
    t.mock.timers.enable({
      apis: ['Date'],
      now: boundary,
    });

    const oldWindow = globalThis.window;
    const oldHarness = globalThis.__noShowUi;

    let slots = [];
    let index = 0;
    let confirm = false;
    let outcome;
    let resolveWrite;

    const writes = [];
    const confirmations = [];

    globalThis.__noShowUi = {
      useState(initial) {
        const slot = index++;

        if (!(slot in slots)) {
          slots[slot] =
            typeof initial === 'function'
              ? initial()
              : initial;
        }

        return [
          slots[slot],
          value => {
            slots[slot] =
              typeof value === 'function'
                ? value(slots[slot])
                : value;
          },
        ];
      },

      useRef(initial) {
        const slot = index++;

        if (!(slot in slots)) {
          slots[slot] = { current: initial };
        }

        return slots[slot];
      },

      useEffect() {},

      client: {
        rpc(name, args) {
          writes.push({ name, args });

          return new Promise(resolve => {
            resolveWrite = () => resolve(outcome);
          });
        },
      },

      data: {
        appointments: [original],
        loading: false,
        error: null,

        refresh() {},

        applyUpdate(update) {
          this.appointments = this.appointments.map(row => ({
            ...row,
            ...update,
          }));
        },
      },
    };

    globalThis.window = {
      location: {
        search: '?date=2026-10-04',
        hash: '',
      },

      confirm(message) {
        confirmations.push(message);
        return confirm;
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
          name: 'no-show-ui-harness',
          enforce: 'pre',

          transform(code, id) {
            if (id.endsWith('/src/pages/BookingsPage.jsx')) {
              return code.replace(
                'import { useEffect, useRef, useState } from "react";',
                'const {useEffect,useRef,useState}=globalThis.__noShowUi;'
              );
            }
          },

          load(id) {
            if (id.endsWith('/src/lib/supabase.js')) {
              return 'export const supabase=globalThis.__noShowUi.client;';
            }

            if (id.endsWith('/src/hooks/useAppointments.js')) {
              return 'export function useAppointments(){const d=globalThis.__noShowUi.data;return {...d,applyUpdate:u=>d.applyUpdate(u)};}';
            }
          },
        },
      ],
    });

    try {
      const { default: Action } =
        await server.ssrLoadModule(
          '/src/components/BookingNoShowAction.jsx'
        );

      const { default: Page } =
        await server.ssrLoadModule(
          '/src/pages/BookingsPage.jsx'
        );

      const render = () => {
        index = 0;
        return nodes(Page());
      };

      const openDetail = () => {
        let tree = render();

        const summary = tree.find(
          node =>
            node.type === 'button' &&
            node.props.className === 'booking-card-summary' &&
            node.props['aria-label'] === 'Prenotazione di Cliente'
        );

        assert.ok(summary, 'booking summary must be visible');

        summary.props.onClick();

        tree = render();

        assert.ok(
          tree.some(
            node => node.props.id === 'booking-detail-drawer'
          ),
          'booking detail drawer must open'
        );

        return tree;
      };

      const quick = tree =>
        tree.find(node => node.type === Action);

      const button = tree => {
        const action = quick(tree);
        return action ? Action(action.props) : null;
      };

      const tableState = () =>
        tableMapForDate(
          globalThis.__noShowUi.data.appointments,
          original.booking_date
        ).find(table => table.id === '12').status;

      await t.test(
        'button appears at existing Rome boundary only; terminal and invalid rows stay hidden',
        () => {
          const html = (
            booking,
            now,
            disabled = false
          ) =>
            renderToString(
              React.createElement(Action, {
                booking,
                now,
                disabled,
                onNoShow() {},
              })
            );

          assert.equal(
            html(original, boundary - 1),
            ''
          );

          assert.match(
            html(original, boundary),
            />Non venuto<\/button>/
          );

          assert.match(
            html(original, boundary, true),
            /disabled=""/
          );

          for (const status of [
            'arrived',
            'completed',
            'cancelled',
            'no_show',
          ]) {
            assert.equal(
              html(
                { ...original, status },
                boundary
              ),
              ''
            );
          }

          assert.equal(
            html(
              {
                ...original,
                booking_time: '',
              },
              boundary
            ),
            ''
          );

          const tree = openDetail();
          const action = quick(tree);

          assert.ok(action);

          const drawer = tree.find(
            node =>
              node.props.id ===
              'booking-detail-drawer'
          );

          const actions = nodes(drawer).find(
            node =>
              node.props.className ===
              'booking-primary-actions'
          );

          assert.ok(actions);
          assert.ok(nodes(actions).includes(action));
        }
      );

      await t.test(
        'declining confirmation never writes or frees a table',
        async () => {
          const tree = openDetail();
          const actionButton = button(tree);

          assert.ok(actionButton);

          await actionButton.props.onClick();

          assert.match(
            confirmations.at(-1),
            /Cliente.*non si è presentato/
          );

          assert.equal(writes.length, 0);
          assert.equal(tableState(), 'reserved');
        }
      );

      await t.test(
        'approved save uses existing history RPC, disables action and frees table after success',
        async () => {
          confirm = true;

          outcome = {
            data: {
              booking_id: 42,
              status: 'no_show',
            },
          };

          const stale = button(openDetail());

          assert.ok(stale);

          const saving = stale.props.onClick();

          let tree = render();
          let currentButton = button(tree);

          assert.ok(currentButton);
          assert.equal(
            currentButton.props.disabled,
            true
          );

          await stale.props.onClick();

          tree = render();
          currentButton = button(tree);

          assert.ok(currentButton);
          assert.equal(
            currentButton.props.disabled,
            true
          );

          assert.equal(writes.length, 1);
          assert.equal(tableState(), 'reserved');

          assert.deepEqual(
            writes[0],
            {
              name: 'admin_set_booking_status_with_history',
              args: {
                booking_id: 42,
                booking_status: 'no_show',
              },
            }
          );

          resolveWrite();
          await saving;

          assert.equal(
            globalThis.__noShowUi.data.appointments[0].status,
            'no_show'
          );

          assert.equal(
            globalThis.__noShowUi.data.appointments[0].tables,
            '12'
          );

          assert.equal(
            tableState(),
            'free'
          );

          assert.equal(
            button(render()),
            null
          );
        }
      );

      await t.test(
        'map shares the confirmation handler and shows errors without releasing on failure',
        async () => {
          slots = [];

          globalThis.__noShowUi.data.appointments = [
            { ...original },
          ];

          window.location.search =
            '?date=2026-10-04&view=map';

          let tree = render();

          const map = tree.find(
            node => node.type?.name === 'TableMap'
          );

          assert.ok(map);
          assert.equal(map.props.now, boundary);

          outcome = {
            error: {
              message: 'Salvataggio non riuscito',
            },
          };

          const saving =
            map.props.onNoShow(original);

          resolveWrite();
          await saving;

          tree = render();

          const mapSection = tree.find(
            node => node.props.id === 'agenda-map'
          );

          assert.ok(
            nodes(mapSection).some(
              node =>
                node.props.role === 'alert' &&
                node.props.children ===
                  'Salvataggio non riuscito'
            )
          );

          assert.equal(
            tableState(),
            'reserved'
          );

          // Torna alla lista e verifica che
          // l'azione sia ancora disponibile.
          slots = [];

          window.location.search =
            '?date=2026-10-04';

          const detailTree = openDetail();
          const actionButton = button(detailTree);

          assert.ok(actionButton);
          assert.equal(
            actionButton.props.disabled,
            false
          );
        }
      );
    } finally {
      await server.close();

      if (oldWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = oldWindow;
      }

      if (oldHarness === undefined) {
        delete globalThis.__noShowUi;
      } else {
        globalThis.__noShowUi = oldHarness;
      }
    }
  }
);