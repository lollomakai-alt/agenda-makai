import test from 'node:test';
import assert from 'node:assert/strict';
import { availableWaitlistTables, createWaitlistEntry, convertWaitlistEntry, setWaitlistStatus, validateWaitlist } from '../src/utils/waitlist.js';
import { todayInRome } from '../src/utils/calendar.js';
import { historyChanges } from '../src/utils/bookingHistory.js';
const day = new Date(`${todayInRome()}T12:00:00Z`); day.setUTCDate(day.getUTCDate()+1); if(day.getUTCDay()===1)day.setUTCDate(day.getUTCDate()+1);
const values={name:'Mario Rossi',phone:'3331234567',email:'',date:day.toISOString().slice(0,10),time:'20:00',party_size:'2',notes:'Seggiolone'};
const entry={id:9,status:'WAITING',booking_date:values.date,booking_time:'20:00',party_size:2};
test('waitlist validates existing booking fields and accepts telephone or email, without accepting malformed contacts',()=>{
  assert.deepEqual(validateWaitlist(values).errors,{});
  assert.equal(validateWaitlist(values).data.phone,'+393331234567');
  assert.deepEqual(validateWaitlist({...values,phone:'',email:'Mario@Example.com'}).errors,{});
  assert.equal(validateWaitlist({...values,phone:'',email:'Mario@Example.com'}).data.email,'mario@example.com');
  for(const invalid of [{phone:'',email:''},{phone:'foo'},{email:'bad'},{date:'2026-02-30'},{time:'20:15'},{party_size:'7'},{notes:'x'.repeat(301)}]) assert.ok(Object.keys(validateWaitlist({...values,...invalid}).errors).length);
});
test('available tables reuse capacity, physical conflicts, daily configurations and type separation',()=>{
  const occupied=[{id:1,booking_date:entry.booking_date,booking_type:'normale',status:'confirmed',tables:'12,15+16+17,18+19'}];
  const available=availableWaitlistTables(entry,occupied).map(([id])=>id);
  assert.ok(!available.includes('12') && !available.includes('15+16') && !available.includes('17') && !available.includes('18'));
  assert.ok(available.includes('10+11'));
  assert.ok(availableWaitlistTables(entry,[{...occupied[0],status:'cancelled'}]).some(([id])=>id==='12'));
  assert.ok(availableWaitlistTables(entry,[{...occupied[0],booking_type:'dopocena'}]).some(([id])=>id==='12'));
  assert.deepEqual(availableWaitlistTables({...entry,status:'CONVERTED'},[]),[]);
  assert.deepEqual(availableWaitlistTables({...entry,party_size:6},[]).map(([id])=>id),['15+16+17']);
});
test('create sends waitlist RPC only; invalid input never reaches database',async()=>{
  const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:{id:9,status:'WAITING'}};}};
  await createWaitlistEntry(client,values);
  assert.equal(calls[0][0],'admin_create_waitlist_entry');
  assert.equal(calls[0][1].p_phone,'+393331234567');
  assert.ok((await createWaitlistEntry(client,{...values,phone:'bad'})).errors.phone);
  assert.equal(calls.length,1);
});
test('status and conversion use checked RPCs; terminal, unavailable and unconfirmed operations fail',async()=>{
  const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:{id:9,status:args.p_status||'CONVERTED',booking_id:42}};}};
  await setWaitlistStatus(client,entry,'CONTACTED');
  assert.deepEqual(calls[0],['admin_set_waitlist_status',{p_entry_id:9,p_status:'CONTACTED',p_expected_status:'WAITING'}]);
  await convertWaitlistEntry(client,entry,'12',[]);
  assert.deepEqual(calls[1],['admin_convert_waitlist_entry',{p_entry_id:9,p_table_id:'12'}]);
  await assert.rejects(setWaitlistStatus(client,{...entry,status:'CONVERTED'},'CANCELLED'));
  await assert.rejects(convertWaitlistEntry(client,entry,'12',[{id:1,booking_date:entry.booking_date,tables:'12',status:'confirmed'}]));
  await assert.rejects(convertWaitlistEntry({rpc:async()=>({error:{code:'PGRST202'}})},entry,'12',[]),/waitlist.sql/);
  await assert.rejects(convertWaitlistEntry({rpc:async()=>({data:{id:9,status:'CONVERTED'}})},entry,'12',[]),/non confermata/);
  assert.equal(calls.length,2);
  assert.deepEqual(historyChanges({action:'waitlist_converted',new_data:{waitlist_id:9,tables:'12'}}),['Voce lista d’attesa #9','Tavolo: 12']);
});
