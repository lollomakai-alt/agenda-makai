import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { COMMUNICATION_STATUSES, loadCommunications, prepareCommunication, openBookingWhatsApp, prepareEmailTemplate, sendEmailTemplate, usesDirectWhatsAppConfirmation } from '../utils/bookingCommunications';
import BookingContacts from './BookingContacts';
import BookingConfirmationEmail, { canSendConfirmationEmail } from './BookingConfirmationEmail';
import { KINDS } from '../../supabase/functions/agenda-communications/messages';
export default function BookingCommunications({ booking, compact = false }) {
 const [template,setTemplate]=useState(booking.status==='cancelled'?'cancelled':'reconfirmation'),[proposal,setProposal]=useState('');
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
  await openBookingWhatsApp(supabase, booking, usesDirectWhatsAppConfirmation(booking, compact));
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
  {!compact && <details><summary>Altre email operative</summary>
   <label>Messaggio<select value={template} onChange={e=>setTemplate(e.target.value)}><option value="reconfirmation">Riconferma</option><option value="reminder">Reminder di domani</option><option value="delay">Ritardo</option><option value="alternative">Proposta alternativa</option><option value="cancelled">Cancellazione</option></select></label>
   {template==='alternative' && <label>Alternativa<textarea maxLength={300} value={proposal} onChange={e=>setProposal(e.target.value)}/></label>}
   <button type="button" className="admin-button admin-button-secondary" disabled={busy||emailBusy||!ready} onClick={()=>action(()=>prepareEmailTemplate(supabase,booking.id,template,proposal))}>Prepara messaggio</button>
  </details>}
  <ul>{rows.filter(row=>!compact || row.channel==='email').map(row=><li key={row.id}>
   <p>{KINDS[row.kind]} · {COMMUNICATION_STATUSES[row.status]} · {new Date(row.created_at).toLocaleString('it-IT')}</p>
   {!compact && ['reminder','reconfirmation','delay','alternative','cancelled'].includes(row.kind) && (row.status==='queued'||(row.status==='failed'&&Date.parse(row.created_at)>Date.now()-23*3600000)) && <button type="button" className="admin-button" disabled={busy||emailBusy||!ready} onClick={()=>action(()=>sendEmailTemplate(supabase,booking.id,row.id))}>Invia email · {KINDS[row.kind]}</button>}
  </li>)}</ul>
 </Container>;
}
