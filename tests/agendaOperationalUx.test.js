import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const day = '2026-10-10';

test(
  'operational Agenda: exclusive views, compact list, safe busy guards and daily online toggle',
  async t => {
    const previousWindow = globalThis.window;
    const previousHarness = globalThis.__agendaUX;

    let slots = [];
    let index = 0;
    let effects = [];
    let closed = false;
    let writeResolve;
    let readFail = false;

    const calls = [];

    const booking = {
      id: 1,
      name: 'Cliente Senza Tavolo',
      booking_date: day,
      booking_time: '20:00',
      party_size: 2,
      phone: '+393331234567',
      email: '',
      tables: '',
      status: 'confirmed',
    };

    const appointments = [
      booking,
      {
        ...booking,
        id: 2,
        name: 'Cliente Assegnato',
        tables: '12',
        booking_time: '20:30',
      },
      {
        ...booking,
        id: 3,
        name: 'Cliente Completato',
        status: 'completed',
        booking_time: '21:00',
      },
      {
        ...booking,
        id: 4,
        name: 'Altra Data',
        booking_date: '2026-10-11',
      },
    ];

    const data = {
      appointments,
      loading: false,
      error: null,
      refresh() {},
      applyUpdate() {},
    };

    const harness = globalThis.__agendaUX = {
      data,

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
          slots[slot] = {
            current: initial,
          };
        }

        return slots[slot];
      },

      useEffect(fn, deps) {
        effects.push({
          fn,
          deps,
        });
      },

      client: {
        from(table) {
          assert.equal(
            table,
            'online_booking_closures'
          );

          calls.push([
            'from',
            table,
          ]);

          const read = () => ({
            data: closed
              ? [{ booking_date: day }]
              : [],
            error: readFail
              ? { message: 'private' }
              : null,
          });

          const write = target =>
            new Promise(resolve => {
              writeResolve = () => {
                closed = target;
                resolve({
                  error: null,
                });
              };
            });

          return {
            select() {
              return {
                eq(field, date) {
                  calls.push([
                    'read',
                    field,
                    date,
                  ]);

                  return Promise.resolve(
                    read()
                  );
                },
              };
            },

            insert(row) {
              calls.push([
                'insert',
                row,
              ]);

              return write(true);
            },

            delete() {
              return {
                eq(field, date) {
                  calls.push([
                    'delete',
                    field,
                    date,
                  ]);

                  return write(false);
                },
              };
            },
          };
        },
      },
    };

    globalThis.window = {
      location: {
        search: `?date=${day}`,
        hash: '',
        pathname: '/prenotazioni/giorno',
      },

      history: {
        replaceState(
          _state,
          _title,
          url
        ) {
          const parsed = new URL(
            url,
            'https://agenda.example'
          );

          window.location.search =
            parsed.search;

          window.location.hash =
            parsed.hash;
        },
      },

      dispatchEvent() {},
    };

    const server = await createServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },

      plugins: [
        {
          name: 'operational-agenda-harness',
          enforce: 'pre',

          transform(code, id) {
            if (
              id.endsWith(
                '/src/pages/BookingsPage.jsx'
              )
            ) {
              return code.replace(
                'import { useEffect, useRef, useState } from "react";',
                'const {useEffect,useRef,useState}=globalThis.__agendaUX;'
              );
            }
          },

          load(id) {
            if (
              id.endsWith(
                '/src/hooks/useAppointments.js'
              )
            ) {
              return 'export function useAppointments(){return globalThis.__agendaUX.data;}';
            }

            if (
              id.endsWith(
                '/src/lib/supabase.js'
              )
            ) {
              return 'export const supabase=globalThis.__agendaUX.client;';
            }
          },
        },
      ],
    });

    const nodes = element =>
      !element ||
      typeof element !== 'object'
        ? []
        : [
            element,
            ...[element.props?.children]
              .flat(Infinity)
              .flatMap(nodes),
          ];

    try {
      const { default: Page } =
        await server.ssrLoadModule(
          '/src/pages/BookingsPage.jsx'
        );

      const render = () => {
        index = 0;
        effects = [];

        return nodes(Page());
      };

      const mode = (
        tree,
        id
      ) =>
        tree.find(
          node =>
            node.props.id === id
        );

      const switchTo = (
        tree,
        name
      ) =>
        tree.find(
          node =>
            node.type === 'button' &&
            node.props.children === name
        );

      const online = tree =>
        tree.find(
          node =>
            node.type === 'button' &&
            node.props[
              'aria-describedby'
            ] ===
              'online-booking-help'
        );

      await t.test(
        'selected date, compact bookings visible; map hidden; detail opens only on demand',
        () => {
          let tree = render();

          assert.equal(
            tree.find(
              node =>
                node.type === 'time' &&
                node.props.dateTime
            ).props.dateTime,
            day
          );

          assert.equal(
            mode(
              tree,
              'agenda-list'
            ).props.hidden,
            false
          );

          assert.equal(
            mode(
              tree,
              'agenda-map'
            ).props.hidden,
            true
          );

          assert.deepEqual(
            tree
              .filter(
                node =>
                  node.type ===
                  'article'
              )
              .map(
                node =>
                  node.props.id
              ),
            [
              'booking-1',
              'booking-2',
              'booking-3',
            ]
          );

          const summaries =
            tree.filter(
              node =>
                node.type ===
                  'button' &&
                node.props
                  .className ===
                  'booking-card-summary'
            );

          assert.equal(
            summaries.length,
            3
          );

          for (
            const summaryButton of summaries
          ) {
            assert.equal(
              summaryButton.props[
                'aria-haspopup'
              ],
              'dialog'
            );

            assert.equal(
              summaryButton.props[
                'aria-controls'
              ],
              'booking-detail-drawer'
            );

            assert.equal(
              summaryButton.props[
                'aria-expanded'
              ],
              false
            );
          }

          // Telefono e azioni secondarie non sono
          // visibili direttamente nella lista.
          assert.equal(
            tree.filter(
              node =>
                node.props
                  .className ===
                'booking-card-phone'
            ).length,
            0
          );

          assert.ok(
            !tree.some(
              node =>
                node.type === 'a' &&
                node.props.href ===
                  'tel:+393331234567'
            )
          );

          assert.ok(
            !tree.some(
              node =>
                node.props.id ===
                'booking-detail-drawer'
            )
          );

          // Apertura del dettaglio.
          summaries[0].props.onClick();

          tree = render();

          const drawer =
            tree.find(
              node =>
                node.props.id ===
                'booking-detail-drawer'
            );

          assert.ok(drawer);

          assert.equal(
            drawer.props.role,
            'dialog'
          );

          assert.equal(
            drawer.props[
              'aria-modal'
            ],
            'true'
          );

          const drawerNodes =
            nodes(drawer);

          assert.ok(
            drawerNodes.some(
              node =>
                node.type?.name ===
                'BookingTableControls'
            )
          );

          assert.ok(
            drawerNodes.some(
              node =>
                node.props
                  .className ===
                'booking-card-phone'
            )
          );

          // Chiusura drawer.
          const closeButton =
            drawerNodes.find(
              node =>
                node.type ===
                  'button' &&
                node.props
                  .children ===
                  'Chiudi'
            );

          assert.ok(closeButton);

          closeButton.props.onClick();

          tree = render();

          assert.ok(
            !tree.some(
              node =>
                node.props.id ===
                'booking-detail-drawer'
            )
          );

          const summary =
            tree.find(
              node =>
                node.props
                  .className ===
                'agenda-day-summary'
            );

          assert.ok(summary);

          assert.ok(
            tree.some(
              node =>
                node.props[
                  'aria-describedby'
                ] ===
                'online-booking-help'
            )
          );

          assert.equal(
            tree.filter(
              node =>
                node.props
                  .className ===
                'agenda-day-summary'
            ).length,
            1
          );

          assert.ok(
            !tree.some(
              node =>
                node.type ===
                  'button' &&
                [
                  'Oggi',
                  'Aggiorna',
                ].includes(
                  node.props.children
                )
            )
          );

          assert.ok(
            !tree.some(
              node =>
                node.type?.name ===
                'BookingRequests'
            )
          );

          assert.equal(
            calls.length,
            0,
            'Displaying or opening booking detail must not write booking data'
          );
        }
      );

      await t.test(
        'switching views never shows both; pending map save blocks switching',
        () => {
          let tree = render();

          switchTo(
            tree,
            'MAPPA'
          ).props.onClick();

          tree = render();

          assert.equal(
            mode(
              tree,
              'agenda-list'
            ).props.hidden,
            true
          );

          assert.equal(
            mode(
              tree,
              'agenda-map'
            ).props.hidden,
            false
          );

          let map =
            tree.find(
              node =>
                node.type?.name ===
                'TableMap'
            );

          assert.equal(
            map.props.appointments
              .length,
            3
          );

          assert.equal(
            map.props.date,
            day
          );

          assert.ok(
            window.location.search.includes(
              'view=map'
            )
          );

          map.props.onSaving(true);

          tree = render();

          assert.equal(
            switchTo(
              tree,
              'ELENCO'
            ).props.disabled,
            true
          );

          assert.ok(
            !tree.some(
              node =>
                node.type?.name ===
                'BookingRequests'
            )
          );

          switchTo(
            tree,
            'ELENCO'
          ).props.onClick();

          assert.equal(
            mode(
              render(),
              'agenda-list'
            ).props.hidden,
            true
          );

          map.props.onSaving(false);

          tree = render();

          switchTo(
            tree,
            'ELENCO'
          ).props.onClick();

          tree = render();

          assert.equal(
            mode(
              tree,
              'agenda-list'
            ).props.hidden,
            false
          );

          assert.equal(
            mode(
              tree,
              'agenda-map'
            ).props.hidden,
            true
          );

          assert.ok(
            !tree.some(
              node =>
                node.type?.name ===
                'TableMap'
            )
          );

          assert.equal(
            calls.length,
            0
          );
        }
      );

      await t.test(
        'unassigned filter affects only display and can be cleared',
        () => {
          let tree = render();

          tree.find(
            node =>
              node.type ===
                'input' &&
              node.props.type ===
                'checkbox'
          ).props.onChange({
            target: {
              checked: true,
            },
          });

          tree = render();

          assert.deepEqual(
            tree
              .filter(
                node =>
                  node.type ===
                  'article'
              )
              .map(
                node =>
                  node.props.id
              ),
            ['booking-1']
          );

          tree.find(
            node =>
              node.type ===
                'input' &&
              node.props.type ===
                'checkbox'
          ).props.onChange({
            target: {
              checked: false,
            },
          });

          assert.equal(
            render().filter(
              node =>
                node.type ===
                'article'
            ).length,
            3
          );

          assert.deepEqual(
            data.appointments,
            appointments
          );

          assert.equal(
            calls.length,
            0
          );
        }
      );

      await t.test(
        'failed/loading booking data never displays a misleading free map',
        () => {
          let tree = render();

          switchTo(
            tree,
            'MAPPA'
          ).props.onClick();

          data.loading = true;

          tree = render();

          assert.ok(
            !tree.some(
              node =>
                node.type?.name ===
                'TableMap'
            )
          );

          assert.ok(
            tree.some(
              node =>
                node.props
                  .children ===
                'Caricamento mappa…'
            )
          );

          data.loading = false;

          data.error = {
            message:
              'Impossibile caricare',
          };

          tree = render();

          assert.ok(
            !tree.some(
              node =>
                node.type?.name ===
                'TableMap'
            )
          );

          assert.ok(
            tree.some(
              node =>
                node.props
                  .children ===
                'Mappa non disponibile: aggiorna le prenotazioni.'
            )
          );

          data.error = null;

          switchTo(
            render(),
            'ELENCO'
          ).props.onClick();
        }
      );

      await t.test(
        'compact APERTE/CHIUSE reads back state; busy/error disables toggle; manual creation stays available',
        async () => {
          let tree = render();

          assert.equal(
            online(tree).props
              .disabled,
            true
          );

          assert.equal(
            online(tree).props[
              'aria-pressed'
            ],
            undefined
          );

          effects
            .find(
              effect =>
                effect.deps
                  ?.length === 1 &&
                effect.deps[0] ===
                  day
            )
            .fn();

          await Promise.resolve();

          tree = render();

          assert.match(
            online(tree).props
              .className,
            /is-open/
          );

          assert.equal(
            online(tree).props[
              'aria-pressed'
            ],
            true
          );

          const closing =
            online(
              tree
            ).props.onClick();

          tree = render();

          assert.equal(
            online(tree).props
              .disabled,
            true
          );

          assert.equal(
            online(tree).props[
              'aria-busy'
            ],
            true
          );

          await online(
            tree
          ).props.onClick();

          assert.equal(
            calls.filter(
              call =>
                call[0] ===
                'insert'
            ).length,
            1
          );

          writeResolve();

          await closing;

          tree = render();

          assert.match(
            online(tree).props
              .className,
            /is-closed/
          );

          assert.equal(
            online(tree).props[
              'aria-pressed'
            ],
            false
          );

          assert.ok(
            tree.some(
              node =>
                node.type ===
                  'span' &&
                node.props
                  .children ===
                  'CHIUSE'
            )
          );

          assert.equal(
            tree.find(
              node =>
                node.props[
                  'aria-controls'
                ] ===
                'manual-booking-form'
            ).props.disabled,
            false
          );

          const opening =
            online(
              tree
            ).props.onClick();

          writeResolve();

          await opening;

          tree = render();

          assert.ok(
            tree.some(
              node =>
                node.type ===
                  'span' &&
                node.props
                  .children ===
                  'APERTE'
            )
          );

          assert.deepEqual(
            calls.find(
              call =>
                call[0] ===
                'insert'
            ),
            [
              'insert',
              {
                booking_date: day,
              },
            ]
          );

          assert.deepEqual(
            calls.find(
              call =>
                call[0] ===
                'delete'
            ),
            [
              'delete',
              'booking_date',
              day,
            ]
          );

          readFail = true;

          const uncertain =
            online(
              tree
            ).props.onClick();

          writeResolve();

          await uncertain;

          tree = render();

          assert.match(
            online(tree).props
              .className,
            /is-unknown/
          );

          assert.equal(
            online(tree).props
              .disabled,
            true
          );

          assert.ok(
            tree.some(
              node =>
                node.props.role ===
                  'alert' &&
                String(
                  node.props.children
                ).includes(
                  'Modifica non confermata'
                )
            )
          );
        }
      );
    } finally {
      await server.close();

      if (
        previousWindow ===
        undefined
      ) {
        delete globalThis.window;
      } else {
        globalThis.window =
          previousWindow;
      }

      if (
        previousHarness ===
        undefined
      ) {
        delete globalThis.__agendaUX;
      } else {
        globalThis.__agendaUX =
          previousHarness;
      }
    }
  }
);