import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T12:00:00Z') }));
test('assign and change open dedicated map; cancel and save return to the same updated booking', async () => {
 const previousWindow=globalThis.window, previousHooks=globalThis.__flowHooks, previousData=globalThis.__flowData;
 let slots=[],index=0;
 globalThis.__flowHooks={
  useState(initial){const slot=index++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return [slots[slot],value=>{slots[slot]=typeof value==='function'?value(slots[slot]):value;}];},
  useRef(initial){const slot=index++;if(!(slot in slots))slots[slot]={current:initial};return slots[slot];},
  useEffect(){},
 };
 const events=[];
 globalThis.window={location:{search:'?date=2026-10-10',pathname:'/prenotazioni/giorno',hash:''},history:{replaceState(_state,_title,url){const parsed=new URL(url,'https://agenda.example');window.location.search=parsed.search;window.location.hash=parsed.hash;}},dispatchEvent:event=>events.push(event.type)};
 const server=await createServer({server:{middlewareMode:true,hmr:false},plugins:[{
  name:'booking-flow-harness',enforce:'pre',
  transform(code,id){if(id.endsWith('/src/pages/BookingsPage.jsx'))return code.replace('import { useEffect, useRef, useState } from "react";','const {useEffect,useRef,useState}=globalThis.__flowHooks;');},
  load(id){if(id.endsWith('/src/hooks/useAppointments.js'))return 'export function useAppointments(){return globalThis.__flowData;}';},
 }]});
 function nodes(element){if(!element||typeof element!=='object')return [];return [element,...[element.props?.children].flat(Infinity).flatMap(nodes)];}
 try{
  const {default:Page}=await server.ssrLoadModule('/src/pages/BookingsPage.jsx');
  function render(){index=0;return nodes(Page());}
  for(const tables of ['', '12']){
   slots=[];window.location.hash='';
   const original={id:42,name:'Cliente',booking_date:'2026-10-10',booking_time:'20:00',party_size:2,tables,notes:'Note',phone:'+393331234567',status:'confirmed'};
   globalThis.__flowData={appointments:[original],loading:false,error:null,refresh(){},applyUpdate(booking){globalThis.__flowData.appointments=globalThis.__flowData.appointments.map(item=>item.id===booking.id?{...item,...booking}:item);}};
   // Both entry points are supplied the same dedicated map callback.
   let tree=render();
   if(tables){tree.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});tree=render();}
   tree.find(node=>node.type?.name==='BookingTableControls').props.onOpenMap();
   tree=render();let map=tree.find(node=>node.type?.name==='TableMap');
   assert.equal(map.props.assignmentBooking.id,42);assert.equal(map.props.assignmentBooking.tables,tables);
   map.props.onCancel();tree=render();
   assert.ok(!tree.some(node=>node.type?.name==='TableMap'));
   assert.equal(tree.find(node=>node.type?.name==='BookingTableControls').props.booking.tables,tables);
   assert.equal(window.location.hash,'#booking-42');
   tree.find(node=>node.type?.name==='BookingTableControls').props.onOpenMap();
   map=render().find(node=>node.type?.name==='TableMap');
   map.props.onSaved({booking:{...original,tables:'10+11'}});
   tree=render();assert.ok(!tree.some(node=>node.type?.name==='TableMap'));
   const updated=tree.find(node=>node.type?.name==='BookingTableControls').props.booking;
   assert.equal(updated.id,42);assert.equal(updated.tables,'10+11');assert.equal(updated.status,'confirmed');assert.equal(updated.phone,original.phone);
   assert.equal(window.location.hash,'#booking-42');assert.ok(events.includes('admin-notifications-changed'));
  }
 }finally{
  await server.close();
  if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
  if(previousHooks===undefined)delete globalThis.__flowHooks;else globalThis.__flowHooks=previousHooks;
  if(previousData===undefined)delete globalThis.__flowData;else globalThis.__flowData=previousData;
 }
});
