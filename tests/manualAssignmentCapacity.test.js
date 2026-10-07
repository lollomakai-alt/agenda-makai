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
  assert.equal(residual.occupied,capacity);assert.equal(residual.remaining,25-capacity);assert.equal(residual.unused,capacity-3);
 });
}
test('manual choice ignores room-layout recommendations and pending-party preference, never physical conflicts',async()=>{
 const other={...booking,id:99,party_size:6,tables:'15+16+17'};
 const small={...booking,party_size:2};
 assert.ok(availableMapAssignments(small,[other],'18',{manualTables:true}).some(([g])=>g==='18'));
 const pending={...other,tables:'',source:'booking'};
 assert.ok(availableMapAssignments(booking,[pending],'15',{manualTables:true}).some(([g])=>g==='15+16'));
 assert.ok(!availableMapAssignments(booking,[other],'15',{manualTables:true}).length);
 assert.ok(!availableMapAssignments({...booking,party_size:5},[],'15',{manualTables:true}).some(([g])=>g==='15+16'));
});
test('suggestions prioritize smallest waste while retaining larger manual options',()=>{
 const suggestions=rankedMapAssignments(booking,[]);
 assert.equal(suggestions[0][0],'10+11');assert.equal(suggestions[0][1],3);
 assert.ok(suggestions.some(([g])=>g==='15+16'));assert.ok(suggestions.some(([g])=>g==='15+16+17'));
 const waste=suggestions.map(([,capacity])=>capacity-booking.party_size);
 assert.deepEqual(waste,[...waste].sort((a,b)=>a-b));
});
test('residual capacity and admission use full units, without temporal turnover',()=>{
 const occupied={...booking,tables:'15+16'};
 const reference={booking_date:booking.booking_date,booking_time:'20:00'};
 assert.deepEqual(serviceCapacity([occupied],reference),{total:25,occupied:4,unused:1,remaining:21,verified:true});
 assert.equal(serviceCapacity([occupied],{...reference,booking_time:'22:00'}).remaining,21);
 assert.deepEqual(conflictingTableIds({...booking,tables:'15+16'},[{...occupied,id:99,booking_time:'21:00'}]),['15','16']);
 assert.deepEqual(conflictingTableIds({...booking,tables:'15+16'},[{...occupied,id:99,booking_time:'22:00'}]),['15','16']);
 const full=[occupied,{...booking,id:1,party_size:6,tables:'15+16+17',booking_time:'22:00'}];
 assert.equal(serviceCapacity(full,reference).verified,false);
 const fixed=[occupied,{...booking,id:1,party_size:20,tables:''}];
 assert.equal(canAcceptBooking(fixed,booking.booking_date,2,'20:00'),false); // 25 cover quota permits 2, unit capacity leaves only 1.
});

test('residual excludes inactive bookings and the unit being reassigned; invalid units stay unverified',()=>{
 const occupied={...booking,tables:'15+16'};
 const reference={booking_date:booking.booking_date,booking_time:'20:00'};
 assert.equal(serviceCapacity([occupied],{...reference,id:booking.id}).remaining,25);
 for(const status of ['cancelled','no_show']) assert.equal(serviceCapacity([{...occupied,status}],reference).remaining,25);
 for(const tables of ['unknown','15+16,17,15+16']) assert.equal(serviceCapacity([{...occupied,tables}],reference).verified,false);
 assert.equal(serviceCapacity([{...occupied,party_size:5}],reference).verified,false);
 assert.equal(serviceCapacity([occupied,{...occupied,id:99}],reference).verified,false);
});
