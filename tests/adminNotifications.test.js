import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAdminNotifications, markNotificationRead, notificationBookingUrl, sortNotifications, unreadNotificationCount } from '../src/utils/adminNotifications.js';

const rows = [
  {id:'read',priority:'high',read_at:'2026-10-04T10:00:00Z',created_at:'2026-10-04T10:00:00Z'},
  {id:'normal',priority:'normal',read_at:null,created_at:'2026-10-04T10:00:00Z'},
  {id:'high',priority:'high',read_at:null,created_at:'2026-10-04T09:00:00Z'},
];
test('unread badge and ordering keep unread first, then priority and date without mutating input', () => {
  const original = structuredClone(rows);
  assert.equal(unreadNotificationCount(rows),2);
  assert.deepEqual(sortNotifications(rows).map(row=>row.id),['high','normal','read']);
  assert.deepEqual(rows,original);
  assert.equal(unreadNotificationCount([]),0);
});
test('notification link opens exact booking and rejects malformed date/id', () => {
  assert.equal(notificationBookingUrl({booking_id:42,booking_date:'2026-10-04'}),'/prenotazioni/giorno?date=2026-10-04#booking-42');
  for (const row of [{booking_id:'javascript:x',booking_date:'2026-10-04'},{booking_id:42,booking_date:'2026-02-30'},{booking_id:0,booking_date:'2026-10-04'}]) assert.equal(notificationBookingUrl(row),null);
});
test('load uses server feed and surfaces missing SQL/denied reads instead of empty badge', async () => {
  const calls=[];
  const result=await loadAdminNotifications({rpc:async name=>{calls.push(name);return {data:rows};}});
  assert.deepEqual(calls,['admin_list_notifications']);
  assert.deepEqual(result.map(x=>x.id),['high','normal','read']);
  await assert.rejects(loadAdminNotifications({rpc:async()=>({error:{code:'PGRST202'}})}),/admin-notifications.sql/);
  await assert.rejects(loadAdminNotifications({rpc:async()=>({error:{message:'Accesso negato'}})}),/negato/);
  await assert.rejects(loadAdminNotifications({rpc:async()=>({data:null})}),/non confermata/);
});
test('mark read uses only notification RPC; unconfirmed writes and failures never mark locally', async () => {
  const calls=[];
  const result=await markNotificationRead({rpc:async(name,args)=>{calls.push([name,args]);return {data:{id:args.notification_id,read_at:'2026-10-04T10:00:00Z'}};}},'request:9');
  assert.deepEqual(calls,[['admin_mark_notification_read',{notification_id:'request:9'}]]);
  assert.equal(result.id,'request:9');
  for (const data of [{id:'other',read_at:'2026-10-04T10:00:00Z'},{id:'request:9',read_at:null},{id:'request:9',read_at:'bad'}]) await assert.rejects(markNotificationRead({rpc:async()=>({data})},'request:9'),/non confermata/);
  await assert.rejects(markNotificationRead({rpc:async()=>({error:{message:'Non accessibile'}})},'request:9'),/accessibile/);
});
