export { communicationMessage, whatsappCommunicationUrl } from '../../supabase/functions/agenda-communications/messages.js';
export const COMMUNICATION_STATUSES = Object.freeze({ queued:'Da inviare',sending:'Invio in corso',accepted:'Accettata dal servizio email',failed:'Invio fallito',unknown:'Esito incerto: verificare',skipped:'Email assente o non valida',superseded:'Superata da un aggiornamento',opened:'Chat preparata: invio manuale' });
export async function loadCommunications(client, bookingId) {
 const {data,error}=await client.from('booking_communications').select('id,channel,kind,status,snapshot,recipient,created_at,error_code,provider_id,attempts').eq('booking_id',bookingId).order('id',{ascending:false});
 if(error) throw new Error(error.code==='42P01'?'Comunicazioni non configurate: applicare supabase/agenda-communications.sql.':'Impossibile leggere le comunicazioni.');
 return data||[];
}
export async function prepareCommunication(client,bookingId,channel) {
 const {data,error}=await client.rpc('admin_prepare_booking_communication',{p_booking_id:bookingId,p_channel:channel});
 if(error) throw new Error(error.message||'Comunicazione non registrata.');
 if(String(data?.booking_id)!==String(bookingId)||data.channel!==channel) throw new Error('Comunicazione non confermata.');
 return data;
}
export async function sendCommunication(client,id) {
 const {data,error}=await client.functions.invoke('agenda-communications',{body:{communication_id:id}});
 if(error) throw new Error('Invio non confermato. Aggiorna il log prima di riprovare; controlla configurazione e servizio email.');
 if(String(data?.id)!==String(id)||!['accepted','failed','unknown'].includes(data.status)) throw new Error('Esito non confermato. Aggiorna il log.');
 return data;
}
