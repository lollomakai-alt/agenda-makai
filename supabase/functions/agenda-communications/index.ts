import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { sendQueuedEmail } from './send.js';
const headers = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Content-Type':'application/json' };
const respond = (body: unknown,status=200) => new Response(JSON.stringify(body),{status,headers});
Deno.serve(async (request: Request) => {
 if(request.method==='OPTIONS') return new Response(null,{headers});
 if(request.method!=='POST') return respond({error:'Metodo non consentito'},405);
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=request.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
 if(!token) return respond({error:'Sessione richiesta'},401);
 const {data,error}=await client.auth.getUser(token);
 if(error||!data.user) return respond({error:'Sessione non valida'},401);
 if(data.user.app_metadata?.role!=='admin') return respond({error:'Accesso riservato allo staff'},403);
 try {
  const raw=await request.text(); if(raw.length>1024) return respond({error:'Richiesta troppo grande'},413);
  const body=JSON.parse(raw);
  if(!Number.isSafeInteger(body?.communication_id)||body.communication_id<1) return respond({error:'Comunicazione non valida'},400);
  const result=await sendQueuedEmail(client,body.communication_id,{apiKey:Deno.env.get('RESEND_API_KEY'),from:Deno.env.get('AGENDA_EMAIL_FROM')});
  return respond(result);
 } catch(error) { return respond({error:error instanceof Error?error.message:'Invio non confermato'},400); }
});
