import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T12:00:00Z') }));

test('ADMIN compone unità dalla mappa, deseleziona, conferma e rispetta i conflitti fisici', async () => {
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
  let saved=null;
  let others=[];
  function render(overrides={}){index=0;return nodes(Map({appointments:[current,...others],date:current.booking_date,assignmentBooking:current,onSaved:result=>{saved=result;},...overrides}));}
  function table(tree,id){return tree.find(node=>node.type==='button'&&node.props['data-unit']?.split('+').includes(id));}
  function choice(tree,group){return tree.find(node=>node.type==='button'&&node.props['data-choice']===group);}
  function confirm(tree){return tree.find(node=>node.type==='button'&&node.props.children==='CONFERMA');}

  let tree=render();
  assert.ok(tree.some(node=>node.props.className==='assignment-selected-booking'));
  assert.equal(table(tree,'13').props.disabled,false);
  assert.equal(table(tree,'18').props.disabled,false);
  assert.equal(tree.some(node=>node.type==='select'),false);
  assert.equal(tree.some(node=>JSON.stringify(node.props).includes('Nuova assegnazione')),false);
  assert.equal(confirm(tree).props.disabled,true);

  // 22+23 is a catalog unit; each physical table can be tapped separately.
  table(tree,'22').props.onClick(); tree=render();
  assert.equal(confirm(tree).props.disabled,false); // 22 alone is also an allowed physical unit.
  assert.equal(table(tree,'22').props['aria-pressed'],true);
  table(tree,'22').props.onClick(); tree=render();
  assert.equal(table(tree,'22').props['aria-pressed'],false); // tap again to deselect
  assert.equal(confirm(tree).props.disabled,true);
  table(tree,'22').props.onClick(); tree=render();
  table(tree,'23').props.onClick(); tree=render();
  assert.equal(confirm(tree).props.disabled,false);
  assert.ok(tree.some(node=>node.type==='span'&&node.props.className==='table-map-assignment-selection'&&node.props.children==='22+23'));
  assert.equal(calls.length,0);
  await tree.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(calls.length,1);assert.equal(calls[0].name,'admin_assign_booking_tables');
  assert.deepEqual(calls[0].args.changes,{tables:'22+23'});
  assert.equal(calls[0].args.party_size,undefined); // preserves the existing covers
  assert.equal(saved.booking.id,42);assert.equal(saved.booking.phone,current.phone);assert.equal(saved.booking.notes,current.notes);assert.equal(saved.booking.status,current.status);

  // Physical catalog triplets can be assembled one touch at a time.
  slots=[];tree=render();table(tree,'15').props.onClick();tree=render();table(tree,'16').props.onClick();tree=render();
  assert.equal(confirm(tree).props.disabled,false); // 15+16 is a valid interim group.
  table(tree,'17').props.onClick();tree=render();
  assert.ok(tree.some(node=>node.type==='span'&&node.props.className==='table-map-assignment-selection'&&node.props.children==='15+16+17'));
  assert.equal(confirm(tree).props.disabled,false);
  table(tree,'15').props.onClick();tree=render();
  assert.equal(table(tree,'15').props['aria-pressed'],false); // any selected physical table can be deselected again.
  assert.equal(confirm(tree).props.disabled,true); // incomplete 16+17 cannot be saved.
  table(tree,'16').props.onClick();tree=render();table(tree,'17').props.onClick();tree=render();
  table(tree,'15').props.onClick();tree=render();
  table(tree,'14').props.onClick();tree=render();
  assert.equal(table(tree,'14').props['aria-pressed'],true); // a new alternative replaces the old partial choice.
  assert.equal(table(tree,'15').props['aria-pressed'],false);
  assert.equal(confirm(tree).props.disabled,true);
  assert.equal(calls.length,1);

  // Suggestions are advisory; every available manual alternative replaces the previous choice locally.
  slots=[];tree=render();
  assert.match(choice(tree,'15+16+17').props.className,/is-recommended/);
  assert.equal(choice(tree,'12').props.disabled,false); // 2 places remain a valid ADMIN manual override.
  assert.equal(choice(tree,'22+23').props.disabled,false);
  choice(tree,'15+16+17').props.onClick();tree=render();
  assert.equal(choice(tree,'15+16+17').props['aria-pressed'],true);
  choice(tree,'22+23').props.onClick();tree=render();
  assert.equal(choice(tree,'15+16+17').props['aria-pressed'],false);
  assert.equal(choice(tree,'22+23').props['aria-pressed'],true);
  assert.equal(confirm(tree).props.disabled,false);
  table(tree,'12').props.onClick();tree=render();
  assert.equal(choice(tree,'12').props['aria-pressed'],true);
  assert.equal(choice(tree,'22+23').props['aria-pressed'],false);
  assert.equal(calls.length,1, 'switching choices never writes before confirmation');
  slots=[];current={...current,party_size:2};tree=render();
  assert.match(choice(tree,'12').props.className,/is-recommended/);
  assert.equal(choice(tree,'15+16+17').props.disabled,false, 'a larger valid group stays selectable manually');
  choice(tree,'15+16+17').props.onClick();tree=render();
  assert.equal(confirm(tree).props.disabled,false);
  assert.equal(calls.length,1);
  current={...current,party_size:6};

  // A physically occupied unit is excluded by the map options.
  slots=[];current={...current,tables:''};saved=null;
  others=[{...current,id:99,tables:'10+11',booking_time:'20:30'}];tree=render();
  assert.equal(table(tree,'10').props.disabled,true);
  assert.equal(table(tree,'11').props.disabled,true);
  assert.equal(choice(tree,'10+11'),undefined);
  assert.equal(confirm(tree).props.disabled,true);

  // A different, non-overlapping unit can still violate the fixed 15–19 row configuration.
  slots=[];others=[{...current,id:101,tables:'18',booking_time:'20:30'}];tree=render();
  assert.equal(choice(tree,'15+16+17'),undefined);
  assert.ok(choice(tree,'15+16'));
  assert.equal(calls.length,1);

  // Conflicts appearing after selection are rejected by the existing save guard.
  slots=[];others=[];tree=render();table(tree,'12').props.onClick();tree=render();
  // 12 is one complete catalog unit and remains selectable irrespective of party size.
  assert.equal(confirm(tree).props.disabled,false);
  others=[{...current,id:100,tables:'12',booking_time:'20:30'}];tree=render();
  await tree.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(calls.length,1);assert.ok(render().some(node=>node.props.role==='alert'));
 }finally{
  await server.close();
  if(previousHooks===undefined)delete globalThis.__assignmentHooks;else globalThis.__assignmentHooks=previousHooks;
  if(previousClient===undefined)delete globalThis.__assignmentClient;else globalThis.__assignmentClient=previousClient;
 }
});
