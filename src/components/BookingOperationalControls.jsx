import { useState } from 'react';
import { supabase } from '../lib/supabase';
export default function BookingOperationalControls({booking,onChanged,disabled}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function freeze(){if(busy)return;setBusy(true);setError('');try{const {data,error}=await supabase.rpc('admin_set_booking_frozen',{booking_id:booking.id,frozen:!booking.operational_frozen});if(error)throw error;if(String(data?.id)!==String(booking.id))throw new Error('Salvataggio non confermato.');onChanged(data);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section aria-label="Gestione operativa"><p>Riconferma: {booking.reconfirmation_status==='reconfirmed'?'RICONFERMATA':booking.reconfirmation_status==='pending'?'IN ATTESA DI RICONFERMA':'Non richiesta'}</p><button type="button" className="admin-button admin-button-secondary" disabled={disabled||busy} onClick={freeze}>{booking.operational_frozen?'Sblocca assegnazione automatica':'Congela assegnazione'}</button>{booking.booking_type==='dopocena'&&booking.status==='arrived'&&!booking.tables&&<p role="alert">DOPOCENA arrivato senza tavolo disponibile.</p>}{error&&<p role="alert">{error}</p>}</section>;
}
