import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T12:00:00Z') }));
test('dedicated assignment validates tables, selects recommended group, confirms, saves and cancels', async () => {
 const previousHooks=globalThis.__assignmentHooks, previousClient=globalThis.__assignmentClient;
 let slots=[],index=0;
 globalThis.__assignmentHooks={
  useEffect(){},
  useState(initial){const slot=index++;if(!(slot in slots))slots[slot]=initial;return [slots[slot],value=>{slots[slot]=typeof value==='function'?value(slots[slot]):value;}];},
  useRef(initial){const slot=index++;if(!(slot in slots))slots[slot]={current:initial};return slots[slot];},
 };
 const calls=[];
 let current={id:42,name:'Cliente Makai',booking_date:'2026-10-10',booking_time:'20:00',party_size:6,tables:'',notes:'Note conservate',phone:'+393331234567',status:'confirmed'};
 globalThis.__assignmentClient={rpc:async(name,args)=>{calls.push({name,args});return {data:{booking:{...current,...args.changes}}};}};
 const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},plugins:[{
  name:'assignment-hook-harness',enforce:'pre',
  transform(code,id){if(id.endsWith('/src/components/TableMap.jsx'))return code.replace("import { useEffect, useRef, useState } from 'react';",'const {useEffect,useRef,useState}=globalThis.__assignmentHooks;');},
  load(id){if(id.endsWith('/src/lib/supabase.js'))return 'export const supabase=globalThis.__assignmentClient;';},
 }]});
 function nodes(element){if(!element||typeof element!=='object')return [];return [element,...[element.props?.children].flat(Infinity).flatMap(nodes)];}
 try{
  const {default:Map}=await server.ssrLoadModule('/src/components/TableMap.jsx');
  let saved=null,cancelled=0;
  let others=[{...current,id:43,party_size:4,tables:'18+19',booking_time:'20:30'}];
  function render(overrides={}){index=0;return nodes(Map({appointments:[current,...others],date:current.booking_date,assignmentBooking:current,onSaved:result=>{saved=result;},onCancel:()=>cancelled++,...overrides}));}
  function table(tree,id){return tree.find(node=>node.type==='button'&&node.props['data-unit']?.split('+').includes(id));}
  let tree=render();
  assert.ok(tree.some(node=>node.props.className==='assignment-selected-booking'));
  assert.ok(tree.some(node=>node.props.children==='Assegna tavolo'));
  assert.equal(table(tree,'12').props.disabled,true); // Too small.
  assert.equal(table(tree,'18').props.disabled,true); // Occupied during an overlapping interval.
  assert.equal(table(tree,'15').props.disabled,false);
  assert.match(table(tree,'15').props.className,/is-recommended/);
  assert.ok(!tree.some(node=>node.type==='form'));
  table(tree,'12').props.onClick();tree=render();assert.ok(!tree.some(node=>node.type==='form'));
  table(tree,'15').props.onClick();tree=render();
  for(const id of ['15','16','17'])assert.equal(table(tree,id).props['aria-pressed'],true);
  let form=tree.find(node=>node.type==='form');assert.ok(form);
  assert.ok(tree.some(node=>node.props.children==='Conferma assegnazione'));
  assert.equal(calls.length,0);
  await form.props.onSubmit({preventDefault(){}});
  assert.equal(calls.length,1);assert.equal(calls[0].name,'admin_assign_booking_tables');
  assert.deepEqual(calls[0].args.changes,{tables:'15+16+17'});
  assert.equal(saved.booking.id,42);assert.equal(saved.booking.phone,current.phone);assert.equal(saved.booking.notes,current.notes);assert.equal(saved.booking.status,current.status);

  slots=[];saved=null;tree=render();table(tree,'15').props.onClick();tree=render();
  tree.find(node=>node.type==='button'&&node.props.children==='Annulla').props.onClick();
  assert.equal(cancelled,1);assert.equal(calls.length,1);assert.equal(saved,null);

  // Changing a current assignment excludes its own occupancy and preserves identity.
  slots=[];current={...current,party_size:2,tables:'12'};others=[];tree=render();
  assert.ok(tree.some(node=>node.type==='span'&&node.props.children?.includes('12')));
  assert.equal(table(tree,'10').props.disabled,false);
  table(tree,'10').props.onClick();tree=render();
  assert.ok(tree.some(node=>node.props.children==='Sostituisce il tavolo 12.'));
  await tree.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.deepEqual(calls[1].args.changes,{tables:'10+11'});assert.equal(calls[1].args.expected.tables,'12');
  assert.equal(saved.booking.id,42);assert.equal(saved.booking.tables,'10+11');assert.equal(saved.booking.name,current.name);

  // A conflict arriving after selection prevents the write.
  slots=[];tree=render();table(tree,'10').props.onClick();tree=render();form=tree.find(node=>node.type==='form');
  others=[{...current,id:99,tables:'10+11'}];tree=render();
  await tree.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(calls.length,2);assert.ok(render().some(node=>node.props.role==='alert'));
 }finally{
  await server.close();
  if(previousHooks===undefined)delete globalThis.__assignmentHooks;else globalThis.__assignmentHooks=previousHooks;
  if(previousClient===undefined)delete globalThis.__assignmentClient;else globalThis.__assignmentClient=previousClient;
 }
});
