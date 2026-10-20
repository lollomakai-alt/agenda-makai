import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('rejection panel requires explicit confirmation, cancels without sending and passes the reason to email/WhatsApp',async()=>{
 const previous={window:globalThis.window,fetch:globalThis.fetch,hooks:globalThis.__rejectionHooks,client:globalThis.__rejectionClient};
 const rid='11111111-1111-4111-8111-111111111111';
 const request={request_id:rid,status:'pending',name:'Ada',phone:'+393331234567',booking_date:'2026-10-25',booking_time:'23:00',party_size:2};
 let calls=0,cursor=0;
 const state=[];
 globalThis.__rejectionHooks={
  useState(initial){const index=cursor++;if(!(index in state))state[index]=index===0?[request]:initial;return[state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];},
  useCallback:fn=>fn,useEffect:()=>{},useRef:value=>({current:value}),
 };
 globalThis.__rejectionClient={auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})},rpc:async name=>({data:name==='admin_dopocena_email_outcomes'?[{request_id:rid,status:'failed',rejection_reason:'Siamo al completo.'}]:[{...request,status:'rejected'}]})};
 globalThis.window={confirm:()=>assert.fail('rejection uses the panel, not a browser confirm'),open:()=>assert.fail('no automatic WhatsApp'),dispatchEvent:()=>{}};
 globalThis.fetch=async(url,options)=>{calls++;assert.match(url,/\/decision$/);assert.deepEqual(JSON.parse(options.body),{decision:'rejected',rejection_reason:'Siamo al completo.'});return Response.json({request_id:rid,status:'rejected',booking_id:null,email_status:'failed',rejection_reason:'Siamo al completo.'});};
 const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},plugins:[{name:'test-rejection-hooks',enforce:'pre',transform(code,id){if(id.split('?')[0].endsWith('/src/components/OnlineDopocenaRequests.jsx'))return code.replace("import { useCallback, useEffect, useRef, useState } from 'react';","const { useCallback, useEffect, useRef, useState } = globalThis.__rejectionHooks;").replace("import { supabase } from '../lib/supabase';","const supabase = globalThis.__rejectionClient;");}}]});
 try {
  const {default:Panel}=await server.ssrLoadModule('/src/components/OnlineDopocenaRequests.jsx');
  const render=()=>{cursor=0;return Panel({});};
  const nodes=tree=>{const result=[];function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}result.push(node);visit(node.props?.children);}visit(tree);return result;};
  const find=(tree,label)=>nodes(tree).find(node=>node.type==='button'&&node.props.children===label);
  let tree=render();find(tree,'Rifiuta').props.onClick();
  tree=render();let form=nodes(tree).find(node=>node.type==='form');assert.ok(form);
  let textarea=nodes(tree).find(node=>node.type==='textarea');assert.equal(textarea.props.required,true);assert.equal(textarea.props.maxLength,500);assert.equal(calls,0);
  assert.equal(find(tree,'Conferma rifiuto e invia email').props.disabled,true);
  find(tree,'Annulla').props.onClick();tree=render();assert.equal(nodes(tree).some(node=>node.type==='form'),false);assert.equal(calls,0);
  find(tree,'Rifiuta').props.onClick();tree=render();textarea=nodes(tree).find(node=>node.type==='textarea');textarea.props.onChange({target:{value:'Siamo al completo.'}});
  tree=render();assert.equal(find(tree,'Conferma rifiuto e invia email').props.disabled,false);form=nodes(tree).find(node=>node.type==='form');await form.props.onSubmit({preventDefault(){}});
  tree=render();assert.equal(calls,1);assert.equal(nodes(tree).some(node=>node.type==='form'),false);
  const link=nodes(tree).find(node=>node.type==='a'&&node.props.children==='Apri WhatsApp (email non disponibile)');assert.ok(link);assert.match(new URL(link.props.href).searchParams.get('text'),/Motivazione: Siamo al completo\./);
 }finally{await server.close();globalThis.window=previous.window;globalThis.fetch=previous.fetch;globalThis.__rejectionHooks=previous.hooks;globalThis.__rejectionClient=previous.client;}
});
