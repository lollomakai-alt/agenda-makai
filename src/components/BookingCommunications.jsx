import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { COMMUNICATION_STATUSES, loadCommunications, prepareCommunication, sendCommunication, whatsappCommunicationUrl } from '../utils/bookingCommunications';
import { KINDS } from '../../supabase/functions/agenda-communications/messages';
export default function BookingCommunications({ booking }) {
 const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!open) return;
  let active=true;
  loadCommunications(supabase,booking.id).then(data=>{if(active){setRows(data);}}).catch(failure=>{if(active)setError(failure.message);});
  return ()=>{active=false;};
 },[open,booking.id,booking.status,booking.booking_date,booking.booking_time,booking.party_size,revision]);
 async function action(run) {
  if(busy) return; setBusy(true);setError('');
  try{await run();}catch(failure){setError(failure.message);}finally{setBusy(false);setRevision(n=>n+1);}
 }
 async function whatsapp() {
  // Apri la finestra durante il click: evita blocco popup dopo la chiamata asincrona.
  const chat=window.open('about:blank','_blank');
  if(!chat) throw new Error('Il browser ha bloccato la chat. Consenti l’apertura e riprova.');
  chat.opener=null;
  try {const row=await prepareCommunication(supabase,booking.id,'whatsapp');chat.location.href=whatsappCommunicationUrl(row);}
  catch(failure){chat.close();throw failure;}
 }
 return <details className="booking-communications" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>Comunicazioni e log</summary>
  <p>Le email si inviano dal pulsante. WhatsApp apre una chat pronta: invia il messaggio manualmente.</p>
  {error&&<p role="alert">{error}</p>}
  <button className="admin-button" disabled={busy} onClick={()=>action(async()=>{await prepareCommunication(supabase,booking.id,'email');})}>Prepara email</button>{' '}
  <button className="admin-button admin-button-secondary" disabled={busy||!booking.phone} onClick={()=>action(whatsapp)}>WhatsApp ↗</button>{' '}
  <button className="admin-button admin-button-secondary" disabled={busy} onClick={()=>setRevision(n=>n+1)}>Aggiorna log</button>
  <ul>{rows.map(row=><li key={row.id}>
   <p>{KINDS[row.kind]} · {row.channel} · {COMMUNICATION_STATUSES[row.status]} · {new Date(row.created_at).toLocaleString('it-IT')}{row.error_code&&` · ${row.error_code}`}</p>
   {row.channel==='email'&&(row.status==='queued'||(row.status==='failed'&&Date.parse(row.created_at)>Date.now()-23*3600000))&&<button className="admin-button" disabled={busy} onClick={()=>action(()=>sendCommunication(supabase,row.id))}>{row.status==='failed'?'Riprova email':'Invia email'}</button>}
  </li>)}</ul>
 </details>;
}
