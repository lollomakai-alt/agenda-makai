import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';
test('giornata renders confirmed bookings without phone/email and with phone, without undefined communication variables',async()=>{
 const previousWindow=globalThis.window;
 globalThis.window={location:{search:'?date=2026-10-04',hash:''}};
 const server=await createServer({server:{middlewareMode:true,hmr:false},plugins:[{
  name:'test-day-data',enforce:'pre',
  load(id){if(id.endsWith('/src/hooks/useAppointments.js'))return `export function useAppointments(){return {appointments:[
   {id:1,name:'Senza Contatti',phone:'',email:'',booking_date:'2026-10-04',booking_time:'20:00',party_size:2,tables:'',status:'confirmed',source:'agenda'},
   {id:2,name:'Con Telefono',phone:'+393331234567',email:'cliente@example.com',booking_date:'2026-10-04',booking_time:'20:30',party_size:2,tables:'12',status:'confirmed',source:'agenda'}
  ],loading:false,error:null,refresh(){},applyUpdate(){}}}`;}
 }]});
 try{
  const {default:Page}=await server.ssrLoadModule('/src/pages/BookingsPage.jsx');
  const html=renderToString(React.createElement(Page));
  assert.match(html,/Senza Contatti/);assert.match(html,/Con Telefono/);assert.match(html,/Comunicazioni e log/);assert.match(html,/Mappa tavoli/);
 }finally{await server.close();if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
});
