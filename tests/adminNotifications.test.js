import test from 'node:test';
import assert from 'node:assert/strict';
import { currentDayNotifications, loadAdminNotifications, markNotificationRead, notificationBookingUrl, notificationDayInRome, sortNotifications, unreadNotificationCount } from '../src/utils/adminNotifications.js';

const rows = [
  {id:'read',priority:'high',read_at:'2026-10-04T10:00:00Z',created_at:'2026-10-04T10:00:00Z'},
  {id:'normal',priority:'normal',read_at:null,created_at:'2026-10-04T10:00:00Z'},
  {id:'high',priority:'high',read_at:null,created_at:'2026-10-04T09:00:00Z'},
];
test('notifications are ordered newest first regardless of read status or priority', () => {
  const original = structuredClone(rows);
  assert.equal(unreadNotificationCount(rows),2);
  assert.deepEqual(sortNotifications(rows).map(row=>row.id),['normal','read','high']);
  assert.deepEqual(rows,original);
  assert.equal(unreadNotificationCount([]),0);
});
test('daily filter uses service day for delays and event day for requests and online bookings', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const history = [
    {id:'old-request',kind:'customer_request',booking_date:'2026-10-20',read_at:null,created_at:'2026-10-09T20:00:00Z'},
    {id:'future-request',kind:'customer_request',booking_date:'2026-10-20',read_at:null,created_at:'2026-10-10T11:00:00Z'},
    {id:'future-online',kind:'online_booking',booking_date:'2026-10-21',read_at:null,created_at:'2026-10-10T10:00:00Z'},
    {id:'old-dopocena',kind:'dopocena_request',booking_date:'2026-10-21',read_at:null,created_at:'2026-10-09T10:00:00Z'},
    {id:'today-delay',kind:'delay',booking_date:'2026-10-10',read_at:'2026-10-10T09:30:00Z',created_at:'2026-10-10T09:00:00Z'},
    {id:'old-delay',kind:'delay',booking_date:'2026-10-09',read_at:null,created_at:'2026-10-10T11:30:00Z'},
  ];
  const original = structuredClone(history);
  const active = sortNotifications(currentDayNotifications(history, now));
  assert.deepEqual(active.map(row=>row.id),['future-request','future-online','today-delay','old-request','old-dopocena']);
  assert.equal(unreadNotificationCount(active),4);
  assert.deepEqual(history,original);
});
test('Rome midnight changes event notifications and service-day delays independently of UTC', () => {
  const history = [
    {id:'request-before',kind:'customer_request',booking_date:'2026-10-20',created_at:'2026-10-10T21:59:59Z'},
    {id:'online-after',kind:'online_booking',booking_date:'2026-10-21',created_at:'2026-10-10T22:00:00Z'},
    {id:'delay-before',kind:'delay',booking_date:'2026-10-10',created_at:'2026-10-10T22:00:00Z'},
    {id:'delay-after',kind:'delay',booking_date:'2026-10-11',created_at:'2026-10-10T21:59:59Z'},
  ];
  const beforeMidnight = new Date('2026-10-10T21:59:59Z');
  const afterMidnight = new Date('2026-10-10T22:00:00Z');
  assert.equal(notificationDayInRome(beforeMidnight),'2026-10-10');
  assert.equal(notificationDayInRome(afterMidnight),'2026-10-11');
  assert.deepEqual(currentDayNotifications(history,beforeMidnight).map(row=>row.id),['request-before','delay-before']);
  assert.deepEqual(currentDayNotifications(history,afterMidnight).map(row=>row.id),['request-before','online-after','delay-before']);
});
test('unknown notification kinds use their event day and malformed events stay visible', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const active = currentDayNotifications([
    {id:'unknown-today',kind:'future_kind',booking_date:'2026-11-01',created_at:'2026-10-10T08:00:00Z'},
    {id:'unknown-old',kind:'future_kind',booking_date:'2026-10-10',created_at:'2026-10-09T08:00:00Z'},
    {id:'unknown-malformed',kind:'future_kind',booking_date:'2026-11-01',created_at:'invalid'},
  ],now);
  assert.deepEqual(active.map(row=>row.id),['unknown-today','unknown-malformed']);
});
test('notification link opens exact booking and rejects malformed date/id', () => {
  assert.equal(notificationBookingUrl({booking_id:42,booking_date:'2026-10-04'}),'/prenotazioni/giorno?date=2026-10-04#booking-42');
  for (const row of [{booking_id:'javascript:x',booking_date:'2026-10-04'},{booking_id:42,booking_date:'2026-02-30'},{booking_id:0,booking_date:'2026-10-04'}]) assert.equal(notificationBookingUrl(row),null);
});
test('load filters the server feed to the current Rome day and surfaces failures', async () => {
  const calls=[];
  const result=await loadAdminNotifications({rpc:async name=>{calls.push(name);return {data:rows.map(row=>({...row,booking_date:'2026-10-04'}))};}},new Date('2026-10-04T12:00:00Z'));
  assert.deepEqual(calls,['admin_list_notifications']);
  assert.deepEqual(result.map(x=>x.id),['normal','read','high']);
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

test('online notification opens the booking detail after automatic assignment', () => {
 assert.equal(notificationBookingUrl({kind:'online_booking',booking_id:42,booking_date:'2026-10-04'}),'/prenotazioni/giorno?date=2026-10-04#booking-42');
});

test('pending DOPOCENA notification opens its service day without a booking ID', () => {
  assert.equal(notificationBookingUrl({kind:'dopocena_request',booking_id:null,booking_date:'2026-10-20'}),'/prenotazioni/giorno?date=2026-10-20');
  assert.equal(notificationBookingUrl({kind:'dopocena_request',booking_id:null,booking_date:'2026-02-30'}),null);
});
