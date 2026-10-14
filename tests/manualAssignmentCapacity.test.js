import test from 'node:test';
import assert from 'node:assert/strict';
import { assignMapTable, availableMapAssignments, rankedMapAssignments } from '../src/utils/tableMap.js';
import { serviceCapacity, canAcceptBooking } from '../src/utils/bookingCapacity.js';
import { conflictingTableIds } from '../src/utils/tableConflicts.js';
import { todayInRome } from '../src/utils/calendar.js';

const day=new Date(`${todayInRome()}T12:00:00Z`);day.setUTCDate(day.getUTCDate()+1);if(day.getUTCDay()===1)day.setUTCDate(day.getUTCDate()+1);
const booking={id:42,name:'Cliente',booking_date:day.toISOString().slice(0,10),booking_time:'20:00',party_size:3,tables:'',notes:'',status:'confirmed'};
for(const [tables,capacity] of [['10+11',3],['15+16',4],['15+16+17',6]]){
 test(`manual 3-person booking may occupy ${tables} (${capacity} seats) via existing RPC`,async()=>{
  const calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});return {data:{booking:{...booking,...args.changes}}};}};
  const result=await assignMapTable(client,booking,tables,[booking],tables.split('+')[0]);
  assert.equal(result.booking.id,42);assert.equal(result.booking.tables,tables);
  assert.deepEqual(calls[0],{name:'admin_assign_booking_tables',args:{booking_id:42,changes:{tables},expected:{booking_date:booking.booking_date,booking_time:'20:00',party_size:3,tables:'',notes:''}}});
  const residual=serviceCapacity([result.booking],{booking_date:booking.booking_date,booking_time:'20:00'});
  assert.equal(residual.occupied,capacity);assert.equal(residual.remaining,Math.min(Math.max(0,residual.total-capacity),23));assert.equal(residual.unused,capacity-3);
 });
}
test('manual choice ignores room-layout recommendations and pending-party preference, never physical conflicts',async()=>{
 const other={...booking,id:99,party_size:6,tables:'15+16+17'};
 const small={...booking,party_size:2};
 assert.ok(availableMapAssignments(small,[other],'18',{manualTables:true}).some(([g])=>g==='18'));
 const pending={...other,tables:'',source:'booking'};
 assert.ok(availableMapAssignments(booking,[pending],'15',{manualTables:true}).some(([g])=>g==='15+16'));
 assert.ok(!availableMapAssignments(booking,[other],'15',{manualTables:true}).length);
 assert.ok(availableMapAssignments({...booking,party_size:5},[],'15',{manualTables:true}).some(([g])=>g==='15+16'));
});
test('manual suggestions keep configured units available without turning capacity into a veto',()=>{
 const suggestions=rankedMapAssignments(booking,[]);
 assert.ok(suggestions.some(([g])=>g==='10+11'));
 assert.ok(suggestions.some(([g])=>g==='15+16'));assert.ok(suggestions.some(([g])=>g==='15+16+17'));
 assert.ok(availableMapAssignments({...booking,party_size:23},[],'22',{manualTables:true}).some(([g])=>g==='22+23'));
});
test('residual capacity and admission use full units, without temporal turnover',()=>{
 const occupied={...booking,tables:'15+16'};
 const reference={booking_date:booking.booking_date,booking_time:'20:00'};
 const residual=serviceCapacity([occupied],reference);
 assert.equal(residual.occupied,4);
 assert.equal(residual.peopleReserved,3);
 assert.equal(residual.physicalRemaining,residual.total-4);
 assert.equal(residual.peopleRemaining,23);
 assert.equal(residual.remaining,residual.total-4);
 assert.equal(residual.verified,true);
 assert.equal(serviceCapacity([occupied],{...reference,booking_time:'22:00'}).remaining,residual.remaining);
 assert.deepEqual(conflictingTableIds({...booking,tables:'15+16'},[{...occupied,id:99,booking_time:'21:00'}]),['15','16']);
 assert.deepEqual(conflictingTableIds({...booking,tables:'15+16'},[{...occupied,id:99,booking_time:'22:00'}]),['15','16']);
 const full=[occupied,{...booking,id:1,party_size:6,tables:'15+16+17',booking_time:'22:00'}];
 assert.equal(serviceCapacity(full,reference).verified,false);
 const fixed=[occupied,{...booking,id:1,party_size:23,tables:''}];
 assert.equal(canAcceptBooking(fixed,booking.booking_date,2,'20:00'),false);
});

test('residual excludes inactive bookings and the unit being reassigned; invalid units stay unverified',()=>{
 const occupied={...booking,tables:'15+16'};
 const reference={booking_date:booking.booking_date,booking_time:'20:00'};
 const total=serviceCapacity([],reference).total;
 assert.equal(serviceCapacity([occupied],{...reference,id:booking.id}).remaining,26);
 for(const status of ['cancelled','no_show']) assert.equal(serviceCapacity([{...occupied,status}],reference).remaining,26);
 for(const tables of ['unknown','15+16,17,15+16']) assert.equal(serviceCapacity([{...occupied,tables}],reference).verified,false);
 assert.equal(serviceCapacity([{...occupied,party_size:5}],reference).verified,true);
 assert.equal(serviceCapacity([occupied,{...occupied,id:99}],reference).verified,false);
});
