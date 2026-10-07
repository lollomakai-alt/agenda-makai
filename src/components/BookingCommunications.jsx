import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { COMMUNICATION_STATUSES, loadCommunications, prepareCommunication, openBookingWhatsApp } from '../utils/bookingCommunications';
import BookingContacts from './BookingContacts';
import BookingConfirmationEmail, { canSendConfirmationEmail } from './BookingConfirmationEmail';
import { KINDS } from '../../supabase/functions/agenda-communications/messages';
export default function BookingCommunications({ booking, compact = false }) {
 const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[ready,setReady]=useState(false),[resetRevision,setResetRevision]=useState(0),[emailBusy,setEmailBusy]=useState(false),[retryAvailable,setRetryAvailable]=useState(false);
 useEffect(()=>{
  if(!open) return;
  let active=true; setReady(false); setError('');
  loadCommunications(supabase,booking.id).then(data=>{if(active){setRows(data);setReady(true);}}).catch(failure=>{if(active)setError(failure.message);});
  return ()=>{active=false;};
 },[open,compact,booking.id,booking.status,booking.booking_date,booking.booking_time,booking.party_size,booking.email,booking.name,booking.tables,revision]);
 async function action(run) {
  if(busy) return; setBusy(true);setError('');
  try{await run();}catch(failure){setError(failure.message);}finally{setBusy(false);setRevision(n=>n+1);}
 }
 async function whatsapp() {
  await openBookingWhatsApp(supabase, booking, compact);
 }
 if (compact) {
  return <div className="booking-communications is-compact">
    <BookingContacts
      booking={booking}
      busy={busy || emailBusy}
      onWhatsApp={() =>
        action(whatsapp)
      }
    />
  </div>;
 }

 const Container = compact ? "div" : "details";
 return <Container className={`booking-communications${compact ? " is-compact" : ""}`} onToggle={compact ? undefined : event=>setOpen(event.currentTarget.open)}>
  {!compact && <summary>Comunicazioni e log</summary>}
  {!compact && <p>Le email si inviano dal pulsante. WhatsApp apre una chat pronta: invia il messaggio manualmente.</p>}
  {!compact && error && <p role="alert">{error}</p>}
  <div className="booking-communication-actions">
  <BookingConfirmationEmail key={`${booking.status}-${booking.email}-${booking.booking_date}-${booking.booking_time}-${booking.party_size}-${booking.tables}-${booking.name}-${resetRevision}`} booking={booking} rows={rows} ready={ready} busy={busy} onBusy={setEmailBusy} onSettled={()=>{setRetryAvailable(true);setRevision(n=>n+1);}} />
  {!compact && canSendConfirmationEmail(booking) && <button className="admin-button admin-button-secondary" disabled={busy||emailBusy||!ready} onClick={()=>action(async()=>{await prepareCommunication(supabase,booking.id,'email');})}>Prepara email</button>}{' '}
  {compact ? <BookingContacts booking={booking} busy={busy||emailBusy} onWhatsApp={()=>action(whatsapp)} /> :
    <button className="admin-button booking-detail-primary" disabled={busy||emailBusy||!booking.phone} onClick={()=>action(whatsapp)}>WhatsApp ↗</button>}{' '}
  {(!compact || rows.length>0 || error || retryAvailable) && <button className="admin-button admin-button-secondary" disabled={busy||emailBusy} onClick={()=>{setResetRevision(n=>n+1);setRevision(n=>n+1);}}>Aggiorna log</button>}
  </div>
  <ul>{rows.filter(row=>!compact || row.channel==='email').map(row=><li key={row.id}>
   <p>{KINDS[row.kind]} · {COMMUNICATION_STATUSES[row.status]} · {new Date(row.created_at).toLocaleString('it-IT')}</p>
  </li>)}</ul>
 </Container>;
}
