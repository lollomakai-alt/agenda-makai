import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingInterval, bookingsOverlap, BOOKING_STAY_MINUTES } from '../src/utils/bookingTime.js';
import { conflictingTableIds, tableConfigurationError } from '../src/utils/tableConflicts.js';
import { availableMapAssignments, preservesUnassignedBookings, tableMapForDate } from '../src/utils/tableMap.js';

const booking={id:42,booking_date:'2026-10-15',booking_time:'20:00',party_size:2,tables:'12',status:'confirmed',booking_type:'normale'};
test('same physical table conflicts only on overlapping intervals, including exact boundary', () => {
 for (const [time, conflict] of [['18:00',false],['18:00:01',true],['19:30',true],['20:00',true],['21:59:59',true],['22:00',false],['22:30',false]]) {
  const other={...booking,id:99,booking_time:time};
  assert.deepEqual(conflictingTableIds(booking,[other]),conflict?['12']:[],time);
 }
 assert.equal(BOOKING_STAY_MINUTES,120);
 assert.equal(bookingInterval(booking).end-bookingInterval(booking).start,120*60000);
});
test('physical group overlap conflicts only during overlapping time windows', () => {
 const grouped={...booking,party_size:6,tables:'15+16+17'};
 assert.deepEqual(conflictingTableIds(grouped,[{...booking,id:99,tables:'15+16',booking_time:'21:00'}]),['15','16']);
 assert.deepEqual(conflictingTableIds(grouped,[{...booking,id:99,tables:'15+16',booking_time:'22:00'}]),[]);
 assert.match(tableConfigurationError(grouped,[{...booking,id:99,tables:'18',booking_time:'21:00'}]),/non è consentita/);
 assert.equal(tableConfigurationError(grouped,[{...booking,id:99,tables:'18',booking_time:'22:00'}]),'');
});
test('configurations are checked simultaneously rather than combining separate windows', () => {
 const middle={...booking,tables:'12',booking_time:'20:00'};
 const early={...booking,id:1,tables:'15+16+17',party_size:6,booking_time:'18:30'};
 const late={...booking,id:2,tables:'18',booking_time:'21:00'};
 assert.equal(tableConfigurationError(middle,[early,late]),'');
});
test('time rules apply across normal/dopocena, midnight and unknown legacy times', () => {
 const after={...booking,id:99,booking_type:'dopocena',booking_time:'22:00'};
 assert.deepEqual(conflictingTableIds({...booking,booking_time:'21:00'},[after]),['12']);
 assert.deepEqual(conflictingTableIds(booking,[after]),[]);
 const late={...booking,booking_time:'23:00'};
 const tomorrow={...booking,id:99,booking_date:'2026-10-16',booking_time:'00:30'};
 assert.equal(bookingsOverlap(late,tomorrow),true);
 assert.deepEqual(conflictingTableIds(late,[tomorrow]),['12']);
 assert.equal(bookingsOverlap(late,{...tomorrow,booking_time:'01:00'}),false);
 assert.deepEqual(conflictingTableIds(booking,[{...booking,id:99,booking_time:''}]),['12']);
 for(const status of ['cancelled','no_show'])assert.deepEqual(conflictingTableIds(booking,[{...booking,id:99,status}]),[]);
});
test('map choices and pending-party protection permit turnover without overbooking overlap', () => {
 const candidate={...booking,tables:''};
 const later={...booking,id:99,booking_time:'22:00'};
 assert.ok(availableMapAssignments(candidate,[later],'12').some(([g])=>g==='12'));
 assert.ok(!availableMapAssignments(candidate,[{...later,booking_time:'21:00'}],'12').length);
 assert.equal(tableMapForDate([later],booking.booking_date,'normale',candidate).find(t=>t.id==='12').status,'free');
 const six={...booking,id:1,party_size:6,tables:'',booking_time:'22:00',source:'booking'};
 const chosen={...booking,tables:'15+16+17'};
 assert.equal(preservesUnassignedBookings(chosen,[six]),true);
 assert.equal(preservesUnassignedBookings(chosen,[{...six,booking_time:'21:00'}]),false);
});
