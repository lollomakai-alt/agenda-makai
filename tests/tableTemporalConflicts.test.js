import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingsOverlap } from '../src/utils/bookingTime.js';
import { conflictingTableIds, tableConfigurationError } from '../src/utils/tableConflicts.js';
import { availableMapAssignments, preservesUnassignedBookings, tableMapForDate } from '../src/utils/tableMap.js';

const booking={id:42,booking_date:'2026-10-15',booking_time:'20:00',party_size:2,tables:'12',status:'confirmed',booking_type:'normale'};
test('assigned physical table stays blocked at every time on the service day', () => {
 for (const [time, conflict] of [['18:00',true],['18:00:01',true],['19:30',true],['20:00',true],['21:59:59',true],['22:00',true],['22:30',true]]) {
  const other={...booking,id:99,booking_time:time};
  assert.deepEqual(conflictingTableIds(booking,[other]),conflict?['12']:[],time);
 }
});
test('physical groups and configurations stay reserved regardless of time', () => {
 const grouped={...booking,party_size:6,tables:'15+16+17'};
 assert.deepEqual(conflictingTableIds(grouped,[{...booking,id:99,tables:'15+16',booking_time:'21:00'}]),['15','16']);
 assert.deepEqual(conflictingTableIds(grouped,[{...booking,id:99,tables:'15+16',booking_time:'22:00'}]),['15','16']);
 assert.match(tableConfigurationError(grouped,[{...booking,id:99,tables:'18',booking_time:'21:00'}]),/non è consentita/);
 assert.match(tableConfigurationError(grouped,[{...booking,id:99,tables:'18',booking_time:'22:00'}]),/non è consentita/);
});
test('configuration checks include every unreleased assignment on the same day', () => {
 const middle={...booking,tables:'12',booking_time:'20:00'};
 const early={...booking,id:1,tables:'15+16+17',party_size:6,booking_time:'18:30'};
 const late={...booking,id:2,tables:'18',booking_time:'21:00'};
 assert.match(tableConfigurationError(middle,[early,late]),/non è consentita/);
});
test('day scope is shared across normal/dopocena, with conservative unknown times', () => {
 const after={...booking,id:99,booking_type:'dopocena',booking_time:'22:00'};
 assert.deepEqual(conflictingTableIds({...booking,booking_time:'21:00'},[after]),['12']);
 assert.deepEqual(conflictingTableIds(booking,[after]),['12']);
 const late={...booking,booking_time:'23:00'};
 const tomorrow={...booking,id:99,booking_date:'2026-10-16',booking_time:'00:30'};
 assert.equal(bookingsOverlap(late,tomorrow),false);
 assert.deepEqual(conflictingTableIds(late,[tomorrow]),[]);
 assert.equal(bookingsOverlap(late,{...tomorrow,booking_time:'01:00'}),false);
 assert.deepEqual(conflictingTableIds(booking,[{...booking,id:99,booking_time:''}]),['12']);
 for(const status of ['cancelled','no_show'])assert.deepEqual(conflictingTableIds(booking,[{...booking,id:99,status}]),[]);
});
test('map choices and pending-party protection never assume timed turnover', () => {
 const candidate={...booking,tables:''};
 const later={...booking,id:99,booking_time:'22:00'};
 assert.equal(availableMapAssignments(candidate,[later],'12').length,0);
 assert.ok(!availableMapAssignments(candidate,[{...later,booking_time:'21:00'}],'12').length);
 assert.equal(tableMapForDate([later],booking.booking_date,'normale',candidate).find(t=>t.id==='12').status,'reserved');
 const six={...booking,id:1,party_size:6,tables:'',booking_time:'22:00',source:'booking'};
 const chosen={...booking,tables:'15+16+17'};
 assert.equal(preservesUnassignedBookings(chosen,[six]),false);
 assert.equal(preservesUnassignedBookings(chosen,[{...six,booking_time:'21:00'}]),false);
});

test('completed stays blocking after hours; only explicit release changes availability', () => {
 const late={...booking,booking_time:'23:59'};
 for(const status of ['confirmed','arrived','completed']) {
  const rows=[{...booking,id:99,status,booking_time:'10:00'}];
  const snapshot=structuredClone(rows);
  assert.deepEqual(conflictingTableIds(late,rows),['12']);
  assert.equal(availableMapAssignments({...late,tables:''},rows,'12').length,0);
  assert.deepEqual(rows,snapshot);
 }
 for(const status of ['cancelled','no_show']) assert.deepEqual(conflictingTableIds(late,[{...booking,id:99,status}]),[]);
 assert.deepEqual(conflictingTableIds(late,[{...booking,id:99,status:'completed',tables:''}]),[]);
});
