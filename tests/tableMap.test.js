import test from 'node:test';
import assert from 'node:assert/strict';
import { tableMapForDate, tableRooms, unverifiedTableBookings, tableGroupsForPhysicalTable, availableMapAssignments, rankedMapAssignments, assignMapTable } from '../src/utils/tableMap.js';
import { todayInRome } from '../src/utils/calendar.js';
const date='2026-10-04';
const future=new Date(`${todayInRome()}T12:00:00Z`);future.setUTCDate(future.getUTCDate()+1);if(future.getUTCDay()===1)future.setUTCDate(future.getUTCDate()+1);
const booking={id:42,booking_date:future.toISOString().slice(0,10),booking_time:'20:00',party_size:2,tables:'',notes:'Seggiolone',status:'confirmed',booking_type:'normale'};

test('map uses all 14 physical tables and distinguishes reserved/occupied/free with linked bookings',()=>{
  const rows=[{id:1,booking_date:date,tables:'10+11',status:'confirmed'},{id:2,booking_date:date,tables:'12',status:'arrived'},{id:3,booking_date:date,tables:'13+14',status:'completed'}];
  const map=tableMapForDate(rows,date);
  assert.equal(map.length,14);
  assert.deepEqual(map.filter(t=>t.status==='reserved').map(t=>t.id),['10','11']);
  assert.deepEqual(map.filter(t=>t.status==='occupied').map(t=>t.id),['12','13','14']);
  assert.equal(map.find(t=>t.id==='15').status,'free');
  assert.deepEqual(map.find(t=>t.id==='10').bookings,[rows[0]]);
  assert.deepEqual(map.find(t=>t.id==='11').bookings,[rows[0]]);
});
test('type filter separates normal/dopocena and occupancy takes precedence in the combined view',()=>{
  const rows=[{id:1,booking_date:date,tables:'15+16',status:'confirmed',booking_type:'dopocena'},{id:2,booking_date:date,tables:'15+16',status:'arrived',booking_type:'normale'}];
  const all=tableMapForDate(rows,date);
  assert.equal(all.find(t=>t.id==='15').status,'occupied');
  assert.deepEqual(all.find(t=>t.id==='16').bookingTypes,['dopocena','normale']);
  assert.equal(tableMapForDate(rows,date,'dopocena').find(t=>t.id==='15').status,'reserved');
  assert.deepEqual(tableMapForDate(rows,date,'normale').find(t=>t.id==='16').bookings,[rows[1]]);
});
test('inactive and other-date rows are excluded; missing/invalid assignments are explicitly unverified',()=>{
  const rows=[{id:1,booking_date:date,tables:'10+11',status:'cancelled'},{id:2,booking_date:date,tables:'12',status:'no_show'},{id:3,booking_date:'2026-10-05',tables:'12',status:'confirmed'},{id:4,booking_date:date,tables:'99',status:'confirmed'},{id:5,booking_date:date,tables:'',status:'confirmed'}];
  assert.ok(tableMapForDate(rows,date).every(t=>t.status==='free'));
  assert.deepEqual(unverifiedTableBookings(rows,date).map(b=>b.id),[4,5]);
  assert.equal(tableMapForDate([{booking_date:date,tables:'23'}],date).find(t=>t.id==='23').status,'reserved');
});
test('rooms and configured group capacities follow the real layout, not sums of physical capacities',()=>{
  assert.deepEqual(tableRooms(tableMapForDate([],date)).map(room=>[room.name,room.tables.map(t=>t.id)]),[
    ['Sala Principale',['10','11','12','13','14','15','16','17','18','19']],['Sala Nami',['20','21','22','23']],
  ]);
  assert.deepEqual(tableGroupsForPhysicalTable('10'),[['10+11',3]]);
  assert.deepEqual(tableGroupsForPhysicalTable('11'),[['10+11',3]]);
  assert.deepEqual(tableGroupsForPhysicalTable('15'),[['15+16+17',6],['15+16',4]]);
  assert.deepEqual(tableGroupsForPhysicalTable('20'),[['20+21',4]]);
});
test('assignment options honor capacity, physical conflicts, configuration, active status and booking type',()=>{
  assert.deepEqual(availableMapAssignments({...booking,party_size:6},[],'15'),[['15+16+17',6]]);
  assert.deepEqual(availableMapAssignments({...booking,party_size:4},[],'10'),[]);
  const busy={...booking,id:43,tables:'15+16+17'};
  assert.deepEqual(availableMapAssignments(booking,[busy],'17'),[]);
  assert.equal(availableMapAssignments(booking,[{...busy,booking_type:'dopocena',booking_time:'23:00'}],'17').length,0);
  assert.ok(availableMapAssignments(booking,[{...busy,status:'cancelled'}],'17').length);
  for(const status of ['completed','cancelled','no_show'])assert.deepEqual(availableMapAssignments({...booking,status},[],'12'),[]);
  assert.deepEqual(availableMapAssignments({...booking,booking_date:'2020-01-01'},[],'12'),[]);
  assert.deepEqual(availableMapAssignments(booking,[],'99'),[]);
});
test('map assignment reuses editor RPC and preserves contacts, scheduling, notes and optimistic concurrency',async()=>{
  const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:{booking:{...booking,...args.changes}}};}};
  await assignMapTable(client,booking,'10+11',[],'11');
  assert.equal(calls[0][0],'admin_assign_booking_tables');
  assert.deepEqual(calls[0][1].changes,{tables:'10+11'});
  assert.deepEqual(calls[0][1].expected,{booking_date:booking.booking_date,booking_time:'20:00',party_size:2,tables:'',notes:'Seggiolone'});
  await assert.rejects(assignMapTable(client,booking,'12',[{...booking,id:43,tables:'12'}],'12'),/non disponibile/);
  assert.equal(calls.length,1);
  await assert.rejects(assignMapTable({rpc:async()=>({error:{message:'Prenotazione cambiata'}})},booking,'12',[],'12'),/cambiata/);
  await assert.rejects(assignMapTable({rpc:async()=>({data:{booking:{id:999}}})},booking,'12',[],'12'),/non confermato/);
});


test('UI recommendation minimizes sufficient capacity then physical tables without changing manual choices',()=>{
  const four=Object.freeze({...booking,party_size:4});
  const ranked=rankedMapAssignments(four,[]);
  assert.equal(ranked[0][0],'15+16');
  assert.ok(ranked.findIndex(([group])=>group==='15+16+17')>ranked.findIndex(([group])=>group==='15+16'));
  assert.ok(availableMapAssignments(four,[],'15').some(([group])=>group==='15+16+17')); // Still manually allowed.
  assert.equal(rankedMapAssignments({...booking,party_size:2},[])[0][0],'12'); // One table instead of 13+14.
  assert.equal(rankedMapAssignments({...booking,party_size:3},[])[0][0],'10+11');
  assert.equal(rankedMapAssignments({...booking,party_size:6},[])[0][0],'15+16+17');
  assert.equal(four.tables,'');
});
test('recommendations exclude conflicts, insufficient groups and invalid bookings and share day occupancy across booking types',()=>{
  const four={...booking,party_size:4};
  const busy={...booking,id:43,tables:'15+16',party_size:4};
  assert.equal(rankedMapAssignments(four,[busy])[0][0],'18+19');
  assert.ok(!rankedMapAssignments(four,[busy]).some(([group])=>group.includes('15')));
  assert.equal(rankedMapAssignments(four,[{...busy,booking_type:'dopocena',booking_time:'23:00'}])[0][0],'18+19');
  assert.deepEqual(rankedMapAssignments({...booking,status:'cancelled'},[]),[]);
  assert.deepEqual(rankedMapAssignments({...booking,party_size:7},[]),[]);
  assert.deepEqual(rankedMapAssignments({...booking,party_size:6},[busy]),[]);
});

test('manual assignment requires sufficient capacity and preserves physical conflicts',async()=>{
 const five={...booking,party_size:5};
 assert.ok(!availableMapAssignments(five,[],'15',{manualTables:true}).some(([g])=>g==='15+16'));
 assert.ok(!rankedMapAssignments(five,[]).some(([g])=>g==='15+16'));
 const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:{booking:{...five,tables:args.changes.tables}}};}};
 await assert.rejects(assignMapTable(client,five,'15+16',[],'15'),/non disponibile/);
 assert.equal(calls.length,0);
 await assert.rejects(assignMapTable(client,five,'15+16',[{...booking,id:43,tables:'15+16',status:'arrived'}],'15'),/non disponibile/);
 const {tableCapacityWarning}=await import('../src/utils/tableConflicts.js');
 assert.match(tableCapacityWarning('15+16',5),/Sovracapienza/);assert.equal(tableCapacityWarning('15+16',4),'');
});


test('pending bookings influence recommendations but never veto a free manual choice', () => {
 const online={id:301,name:'Pending Online',booking_date:'2026-10-15',booking_time:'20:00',party_size:6,tables:'',status:'confirmed',source:'booking',booking_type:'normale'};
 const small={...online,id:302,name:'Staff Choice',party_size:2,source:'agenda'};
 const entries=[online,small];
 assert.ok(availableMapAssignments(small,entries,'15',{manualTables:true}).some(([group])=>group==='15+16+17'));
 assert.ok(availableMapAssignments(small,entries,'12',{manualTables:true}).some(([group])=>group==='12'));
 assert.ok(rankedMapAssignments(small,entries).some(([group])=>group==='15+16'));
 assert.equal(rankedMapAssignments(small,entries)[0][0],'12');
});
