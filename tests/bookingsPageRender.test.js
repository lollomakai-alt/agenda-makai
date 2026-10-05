import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Le fixture del servizio usano il 4 ottobre: isolare i test dalla data reale.
beforeEach(context => context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T12:00:00Z') }));
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';
test('giornata renders confirmed bookings without phone/email and with phone, without undefined communication variables',async()=>{
 const previousWindow=globalThis.window;
 globalThis.window={location:{search:'?date=2026-10-04',hash:''}};
 const server=await createServer({server:{middlewareMode:true,hmr:false},plugins:[{
  name:'test-day-data',enforce:'pre',
  load(id){if(id.endsWith('/src/hooks/useMobileLayout.js'))return 'export default function useMobileLayout(){return Boolean(globalThis.__agendaMobileFixture)}';if(id.endsWith('/src/hooks/useAppointments.js'))return `export function useAppointments(){return {appointments:[
   {id:1,name:'Senza Contatti',phone:'',email:'',booking_date:'2026-10-04',booking_time:'20:00',party_size:2,tables:'',status:globalThis.__agendaStatusFixture || 'confirmed',source:'agenda'},
   {id:2,name:'Con Telefono',phone:'+393331234567',email:'cliente@example.com',booking_date:'2026-10-04',booking_time:'20:30',party_size:2,tables:'12',status:'confirmed',source:'agenda'}
  ],loading:false,error:null,refresh(){},applyUpdate(){}}}`;}
 }]});
 try{
  const {default:Page}=await server.ssrLoadModule('/src/pages/BookingsPage.jsx');
  const html=renderToString(React.createElement(Page));
  assert.doesNotMatch(html,/>ANNULLA<\/button>|booking-status-feedback/);
  assert.match(html,/Senza Contatti/);assert.doesNotMatch(html,/id="booking-2"/);assert.doesNotMatch(html,/Comunicazioni e log/);assert.doesNotMatch(html,/Sala Principale/);assert.match(html,/ASSEGNA TAVOLO per Senza Contatti/);
  const card=html.slice(html.indexOf('<article id="booking-1"'),html.indexOf('</article>'));
  const summary=card.slice(card.indexOf('<div class="booking-card-summary"'),card.indexOf('</div>'));
  assert.match(card,/booking-card-operational/);
  assert.doesNotMatch(card,/<details|<summary|Storico modifiche|Aggiorna log|customer-card|marketing-consent-panel|booking-confirmation-preview/);
  assert.match(summary,/20:00/);assert.match(summary,/Senza Contatti/);assert.match(summary,/persone/);assert.match(summary,/Confermata/);assert.match(summary,/Nessun tavolo assegnato/);assert.match(summary,/ASSEGNA TAVOLO/);
  assert.doesNotMatch(summary,/Telefono|Comunicazioni|Cambia stato|Apri mappa/);
  assert.match(card,/booking-card-content/);assert.doesNotMatch(card,/Cambia stato|<select/);assert.match(card,/>Arrivato<\/button>/);
  assert.match(card,/<dl class="booking-detail-meta">/);
  assert.match(card,/<section class="booking-detail-management" aria-label="Gestione prenotazione">/);
  assert.ok(card.indexOf('Modifica prenotazione') < card.indexOf('booking-operational-actions'), 'edit action is directly available in management');
  assert.match(card,/class="admin-button booking-detail-primary"[^>]*aria-label="ASSEGNA TAVOLO/);
  assert.doesNotMatch(card,/Apri mappa tavoli/);
  assert.match(card,/disabled="" aria-expanded="false" aria-controls="booking-contacts-1"/);
  assert.match(card,/Contatti/);assert.match(card,/Numero non disponibile/);
  assert.doesNotMatch(card,/Chiama cliente|WhatsApp|booking-contacts-menu/);
  assert.match(card,/booking-communication-actions/);
  assert.match(card,/booking-action-danger/);assert.match(card,/booking-action-caution/);
  assert.match(card,/Prepara email/);assert.doesNotMatch(card,/Registra risposta positiva/);

  globalThis.window.location.hash='#booking-1';
  for (const status of ['arrived', 'seated', 'completed', 'cancelled', 'no_show']) {
    globalThis.__agendaStatusFixture=status;
    const stateHtml=renderToString(React.createElement(Page));
    const stateCard=stateHtml.slice(stateHtml.indexOf('<article id="booking-1"'),stateHtml.indexOf('</article>'));
    assert.match(stateCard,/Senza Contatti/);
    assert.doesNotMatch(stateCard,/>Arrivato<\/button>|>Fai accomodare<\/button>|Cambia stato|<select/);
    if (status === 'arrived') assert.match(stateCard,/>Libera tavolo<\/button>/);
    else assert.doesNotMatch(stateCard,/>Libera tavolo<\/button>/);
    assert.match(stateCard,/Modifica prenotazione/);
  }
  delete globalThis.__agendaStatusFixture;
  globalThis.window.location.hash='#booking-2';
  const linkedHtml=renderToString(React.createElement(Page));
  assert.match(linkedHtml,/id="booking-2"/);
  const assignedCard=linkedHtml.slice(linkedHtml.indexOf('<article id="booking-2"'),linkedHtml.indexOf('</article>',linkedHtml.indexOf('<article id="booking-2"')));
  assert.match(assignedCard,/Tavolo (?:<!-- -->)?12/);assert.match(assignedCard,/Modifica tavolo di Con Telefono/);
  assert.doesNotMatch(assignedCard,/ASSEGNA TAVOLO|Apri mappa tavoli|Rimuovi assegnazione/);
  assert.match(linkedHtml,/type="checkbox" checked=""/);
  globalThis.window.location.search='?date=2026-10-04&assign=1';
  const mapHtml=renderToString(React.createElement(Page));
  assert.match(mapHtml,/Assegna tavolo/);assert.match(mapHtml,/assignment-selected-booking/);
  assert.match(mapHtml,/Senza Contatti/);assert.match(mapHtml,/combinazione consigliata/);
  assert.match(mapHtml,/Seleziona consigliata/);assert.doesNotMatch(mapHtml,/<article id=/);
  globalThis.window.location.search='?date=2026-10-04';
  globalThis.window.location.hash='';
  globalThis.__agendaMobileFixture=true;
  const mobileHtml=renderToString(React.createElement(Page));
  assert.match(mobileHtml,/<details class="mobile-section " name="mobile-agenda-area"><summary>Richieste clienti/);
  assert.match(mobileHtml,/<details class="mobile-section " name="mobile-agenda-area"><summary>Prenotazioni online/);
  assert.match(mobileHtml,/<div class="booking-card-operational">/);
  assert.ok(mobileHtml.indexOf('agenda-heading') < mobileHtml.indexOf('Richieste clienti'), 'day heading precedes secondary sections');
  assert.match(mobileHtml,/mobile-primary-action/);
  assert.match(mobileHtml,/bookings-day-page/);
  globalThis.window.location.pathname='/prenotazioni/giorno';
  const {default:App}=await server.ssrLoadModule('/src/App.jsx');
  const shell=renderToString(React.createElement(App));
  assert.match(shell,/<nav class="admin-mobile-nav" aria-label="Navigazione Agenda">/);
  assert.match(shell,/<a href="\/prenotazioni" aria-current="page">Agenda<\/a>/);
  assert.match(shell,/<a href="\/lista-attesa">Lista d’attesa<\/a>/);
  assert.match(shell,/<a href="\/attivita">Attività<\/a>/);
  globalThis.window.location.pathname='/';
  assert.doesNotMatch(renderToString(React.createElement(App)),/admin-mobile-nav/);
  delete globalThis.__agendaMobileFixture;
  const {default:Notifications}=await server.ssrLoadModule('/src/components/AdminNotifications.jsx');
  const notifications=renderToString(React.createElement(Notifications));
  assert.match(notifications,/notification-bell/);assert.match(notifications,/notification-badge/);assert.match(notifications,/aria-expanded="false"/);
  const {default:Waitlist}=await server.ssrLoadModule('/src/pages/WaitlistPage.jsx');
  const waitlist=renderToString(React.createElement(Waitlist));
  assert.match(waitlist,/waitlist-page/);assert.match(waitlist,/waitlist-filters/);
  assert.match(waitlist,/Aggiungi cliente/);assert.match(waitlist,/Aggiorna lista e disponibilità/);
  const {default:Activity}=await server.ssrLoadModule('/src/pages/ActivityPage.jsx');
  const activity=renderToString(React.createElement(Activity));
  assert.match(activity,/activity-filters/);assert.match(activity,/activity-search/);

  const {default:Map}=await server.ssrLoadModule('/src/components/TableMap.jsx');
  const booking={id:1,name:'Senza Contatti',booking_date:'2026-10-04',booking_time:'20:00',party_size:2,tables:'',status:'confirmed'};
  const map=renderToString(React.createElement(Map,{appointments:[booking],date:booking.booking_date,assignmentBooking:booking}));
  assert.match(map,/Sala Principale/);assert.match(map,/Sala Nami/);assert.match(map,/Senza Contatti/);
  assert.doesNotMatch(map,/Prenotazione da assegnare/);
  assert.equal((map.match(/class="table-map-number"/g) || []).length,14);
  assert.equal((map.match(/class="table-map-state"/g) || []).length,14);
  assert.ok(map.indexOf('table-map-rooms') < map.indexOf('table-map-suggestions'), 'rooms precede assignment alternatives');
  assert.match(map,/<details class="table-map-alternatives"><summary>Vedi tutte le combinazioni/);
  const occupiedMap=renderToString(React.createElement(Map,{appointments:[
    {...booking,id:3,tables:'10+11',status:'confirmed'},
    {...booking,id:4,tables:'12',status:'arrived'}
  ],date:booking.booking_date}));
  assert.match(occupiedMap,/is-reserved/);assert.match(occupiedMap,/is-occupied/);assert.match(occupiedMap,/is-free/);
  assert.match(occupiedMap,/Tavolo 12: Occupato/);

 }finally{delete globalThis.__agendaStatusFixture;delete globalThis.__agendaMobileFixture;await server.close();if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
});
