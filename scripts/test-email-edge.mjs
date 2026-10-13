// Execute the existing mocked Deno transport suite using Node's TypeScript stripper.
// No production environment, network transport, deployment or sends are involved.
import {stripTypeScriptTypes,createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=new URL('../',import.meta.url);
const directory=await mkdtemp(join(tmpdir(),'makai-email-edge-'));
const env=new Map(),cases=[];
globalThis.Deno={env:{get:key=>env.get(key),set:(key,value)=>env.set(key,value),delete:key=>env.delete(key)},test:(name,run)=>cases.push({name,run}),serve:()=>{throw new Error('No server starts in tests');}};
try {
 const modulePath=pathToFileURL(createRequire(import.meta.url).resolve('@supabase/supabase-js')).href;
 const sources=[['supabase/functions/send-booking-email/index.ts','index.mjs'],['supabase/functions/agenda-communications/index.ts','legacy.mjs'],['supabase/functions/send-booking-email/index.test.ts','test.mjs']];
 for(const [source,target] of sources){
  let code=stripTypeScriptTypes(await readFile(new URL(source,root),'utf8'),{mode:'strip'});
  code=code.replace("'npm:@supabase/supabase-js@2.117.2'",JSON.stringify(modulePath)).replace("'../agenda-communications/messages.js'","'./messages.mjs'").replace("'./index.ts'","'./index.mjs'").replace("'../agenda-communications/index.ts'","'./legacy.mjs'");
  await writeFile(join(directory,target),code);
 }
 await writeFile(join(directory,'messages.mjs'),await readFile(new URL('supabase/functions/agenda-communications/messages.js',root),'utf8'));
 await import(pathToFileURL(join(directory,'test.mjs')).href);
 let steps=0;
 for(const entry of cases){await entry.run({step:async(name,run)=>{await run();steps++;}});console.log('PASS:',entry.name);}
 console.log('Transport steps passed:',steps);
}finally{delete globalThis.Deno;await rm(directory,{recursive:true,force:true});}
