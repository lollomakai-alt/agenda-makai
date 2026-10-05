import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { COMMUNICATION_STATUSES, loadCommunications, prepareCommunication, sendCommunication, openBookingWhatsApp } from '../utils/bookingCommunications';
import BookingContacts from './BookingContacts';
import { KINDS } from '../../supabase/functions/agenda-communications/messages';
export default function BookingCommunications({ booking, compact = false }) {
 const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!open && !compact) return;
  let active=true;
  loadCommunications(supabase,booking.id).then(data=>{if(active){setRows(data);}}).catch(failure=>{if(active)setError(failure.message);});
  return ()=>{active=false;};
 },[open,compact,booking.id,booking.status,booking.booking_date,booking.booking_time,booking.party_size,revision]);
 async function action(run) {
  if(busy) return; setBusy(true);setError('');
  try{await run();}catch(failure){setError(failure.message);}finally{setBusy(false);setRevision(n=>n+1);}
 }
 async function whatsapp() {
  await openBookingWhatsApp(supabase, booking, compact);
 }
 const Container = compact ? "div" : "details";
 return <Container className={`booking-communications${compact ? " is-compact" : ""}`} onToggle={compact ? undefined : event=>setOpen(event.currentTarget.open)}>
  {!compact && <summary>Comunicazioni e log</summary>}
  {!compact && <p>Le email si inviano dal pulsante. WhatsApp apre una chat pronta: invia il messaggio manualmente.</p>}
  {error&&<p role="alert">{error}</p>}
  <div className="booking-communication-actions">
  <button className="admin-button admin-button-secondary" disabled={busy} onClick={()=>action(async()=>{await prepareCommunication(supabase,booking.id,'email');})}>Prepara email</button>{' '}
  {compact ? <BookingContacts booking={booking} busy={busy} onWhatsApp={()=>action(whatsapp)} /> :
    <button className="admin-button booking-detail-primary" disabled={busy||!booking.phone} onClick={()=>action(whatsapp)}>WhatsApp ↗</button>}{' '}
  {!compact && <button className="admin-button admin-button-secondary" disabled={busy} onClick={()=>setRevision(n=>n+1)}>Aggiorna log</button>}
  </div>
  <ul>{rows.filter(row=>!compact || (row.channel==='email'&&(row.status==='queued'||(row.status==='failed'&&Date.parse(row.created_at)>Date.now()-23*3600000)))).map(row=><li key={row.id}>
   {!compact && <p>{KINDS[row.kind]} · {row.channel} · {COMMUNICATION_STATUSES[row.status]} · {new Date(row.created_at).toLocaleString('it-IT')}{row.error_code&&` · ${row.error_code}`}</p>}
   {row.channel==='email'&&(row.status==='queued'||(row.status==='failed'&&Date.parse(row.created_at)>Date.now()-23*3600000))&&<button className="admin-button" disabled={busy} onClick={()=>action(()=>sendCommunication(supabase,row.id))}>{row.status==='failed'?'Riprova email':'Invia email'}</button>}
  </li>)}</ul>
 </Container>;
}
