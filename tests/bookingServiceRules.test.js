import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingScheduledAt,isValidBookingTimeForType} from '../src/utils/bookingTime.js';
import {operationalDayInRome} from '../src/utils/calendar.js';
import {conflictingTableIds} from '../src/utils/tableConflicts.js';
import {communicationMessage} from '../supabase/functions/agenda-communications/messages.js';
test('service slots and midnight stay in the selected operational day across DST',()=>{
 for(const day of ['2026-10-24','2026-10-25','2027-03-28']) {
  const base={booking_date:day,booking_type:'dopocena'};
  assert.ok(bookingScheduledAt({...base,booking_time:'00:00'})>bookingScheduledAt({...base,booking_time:'23:30'}));
  assert.ok(isValidBookingTimeForType({...base,booking_time:'00:00'}));
  assert.equal(isValidBookingTimeForType({...base,booking_time:'00:30'}),false);
 }
 for(const [time,valid] of [['18:30',false],['19:00',true],['22:30',true],['23:00',false]]) assert.equal(isValidBookingTimeForType({booking_date:'2026-10-15',booking_type:'normale',booking_time:time}),valid);
 assert.equal(operationalDayInRome(Date.parse('2026-10-10T23:59:00Z')),'2026-10-10');
 assert.equal(operationalDayInRome(Date.parse('2026-10-11T00:00:00Z')),'2026-10-11');
});
test('exact 120-minute program permits a future service, never timed release within dinner',()=>{
 const dinner={id:1,booking_date:'2026-10-15',booking_time:'20:30',booking_type:'normale',tables:'12',status:'arrived'};
 assert.deepEqual(conflictingTableIds({...dinner,id:2,booking_time:'22:30',booking_type:'dopocena'},[dinner]),[]);
 assert.deepEqual(conflictingTableIds({...dinner,id:2,booking_time:'22:30'},[dinner]),['12']);
});
test('separate templates share clear facts and accept only secure possession links',()=>{
 const booking={name:'Cliente',booking_date:'2026-10-15',booking_time:'00:00',party_size:2,tables:'12',management_url:'https://www.makaipigneto.it/prenotazioni/gestisci#token='+'a'.repeat(43),proposal:'Alle 23:30'};
 for(const kind of ['confirmation','updated','cancelled','reminder','reconfirmation','delay','alternative']) {
  const message=communicationMessage(booking,kind);assert.match(message.text,/15\/10\/2026/);assert.match(message.text,/2/);assert.doesNotMatch(message.text,/Tavolo:|assegnazion/i);assert.ok(message.subject);
 }
 assert.match(communicationMessage(booking,'reminder').text,/mancata riconferma non annulla/);
 assert.ok(!communicationMessage({...booking,management_url:'javascript:alert(1)'},'confirmation').text.includes('javascript:'));
});

test('map service follows the real occupied party then the earliest operational arrival',async()=>{
 const {tableBookingService}=await import('../src/utils/tableMap.js');
 const dinner={id:1,booking_date:'2026-10-15',booking_time:'20:00',booking_type:'normale',status:'confirmed'};
 const midnight={...dinner,id:2,booking_time:'00:00',booking_type:'dopocena'};
 assert.equal(tableBookingService([midnight,dinner]),'normale');
 assert.equal(tableBookingService([midnight]),'dopocena');
 assert.equal(tableBookingService([{...midnight,status:'arrived'},dinner]),'dopocena');
});
