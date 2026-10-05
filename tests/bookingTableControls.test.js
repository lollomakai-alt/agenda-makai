import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('table controls: assign, pencil menu, change and remove only tables through existing RPC', async () => {
 const previousHooks = globalThis.__tableHooks;
 const previousClient = globalThis.__tableClient;
 let slots = [], index = 0;
 globalThis.__tableHooks = {
  useState(initial) { const slot=index++; if(!(slot in slots)) slots[slot]=initial;
   return [slots[slot], value=>{ slots[slot]=typeof value==='function'?value(slots[slot]):value; }]; },
  useRef(initial) { const slot=index++; if(!(slot in slots)) slots[slot]={current:initial}; return slots[slot]; },
  useEffect() {},
 };
 const calls=[];
 globalThis.__tableClient={rpc:async(name,args)=>{
  calls.push({name,args});
  return {data:{booking:{...booking,...args.changes},history_error:null}};
 }};
 const server=await createServer({server:{middlewareMode:true,hmr:false},plugins:[{
  name:'table-controls-harness',enforce:'pre',
  transform(code,id){if(id.endsWith('/src/components/BookingTableControls.jsx'))return code.replace(
   "import { useEffect, useRef, useState } from 'react';",'const {useEffect,useRef,useState}=globalThis.__tableHooks;');},
  load(id){if(id.endsWith('/src/lib/supabase.js'))return 'export const supabase=globalThis.__tableClient;';},
 }]});
 const booking={id:42,name:'Cliente',phone:'+393331234567',booking_date:'2026-10-10',booking_time:'20:00',party_size:2,tables:'10+11',notes:'Seggiolone',status:'arrived'};
 function nodes(element){if(!element||typeof element!=='object')return [];return [element,...[element.props?.children].flat(Infinity).flatMap(nodes)];}
 try{
  const {default:Controls}=await server.ssrLoadModule('/src/components/BookingTableControls.jsx');
  let mapCalls=0,saved=null;const locks=[];
  const props={booking,appointments:[booking],onOpenMap:()=>mapCalls++,onSaved:result=>{saved=result;},onSaving:value=>locks.push(value)};
  function render(overrides={}){index=0;return nodes(Controls({...props,...overrides}));}
  let tree=render({booking:{...booking,tables:''}});
  assert.ok(tree.some(node=>node.props.children==='Nessun tavolo assegnato'));
  const assign=tree.find(node=>node.type==='button');assert.equal(assign.props.children,'ASSEGNA TAVOLO');assign.props.onClick();assert.equal(mapCalls,1);
  slots=[];tree=render();
  assert.ok(tree.some(node=>node.props.children?.[0]==='Tavolo '));
  assert.ok(!tree.some(node=>node.props.children==='ASSEGNA TAVOLO'));
  let pencil=tree.find(node=>node.type==='button');assert.match(pencil.props['aria-label'],/Modifica tavolo/);assert.equal(pencil.props['aria-expanded'],false);
  pencil.props.onClick();tree=render();assert.equal(tree.find(node=>node.type==='button').props['aria-expanded'],true);
  assert.ok(tree.some(node=>node.props.children==='Rimuovi assegnazione'));
  tree.find(node=>node.props.children==='Cambia tavolo').props.onClick();assert.equal(mapCalls,2);
  tree=render();assert.ok(!tree.some(node=>node.props.role==='group'));
  tree.find(node=>node.type==='button').props.onClick();tree=render();
  await tree.find(node=>node.props.children==='Rimuovi assegnazione').props.onClick();
  assert.equal(calls.length,1);assert.equal(calls[0].name,'admin_assign_booking_tables');
  assert.deepEqual(calls[0].args.changes,{tables:''});assert.equal(calls[0].args.booking_id,42);
  assert.equal(saved.booking.id,42);assert.equal(saved.booking.tables,'');assert.equal(saved.booking.status,'arrived');assert.equal(saved.booking.phone,booking.phone);assert.equal(saved.booking.notes,booking.notes);
  assert.deepEqual(locks,[true,false]);
  tree=render({booking:saved.booking});assert.ok(tree.some(node=>node.props.children==='ASSEGNA TAVOLO'));
  slots=[];tree=render();tree.find(node=>node.type==='button').props.onClick();tree=render();
  globalThis.__tableClient.rpc=async()=>({error:{message:'Accesso negato'}});
  saved=null;await tree.find(node=>node.props.children==='Rimuovi assegnazione').props.onClick();tree=render();
  assert.equal(saved,null);assert.ok(tree.some(node=>node.props.role==='alert'&&node.props.children==='Accesso negato'));
  assert.equal(booking.tables,'10+11');
  assert.equal(render({disabled:true}).find(node=>node.type==='button').props.disabled,true);
 }finally{
  await server.close();
  if(previousHooks===undefined)delete globalThis.__tableHooks;else globalThis.__tableHooks=previousHooks;
  if(previousClient===undefined)delete globalThis.__tableClient;else globalThis.__tableClient=previousClient;
 }
});
