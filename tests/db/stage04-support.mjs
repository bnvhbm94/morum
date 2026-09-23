/** Real SQL helper; no production fallback, no implicit database creation/reset. */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {AgentAuth} from '../../.test-build/server/service/auth.js';
import {requestDigest} from '../../.test-build/domain/idempotency.js';
import {mapDatabaseError} from '../../.test-build/domain/errors.js';
import {assertTestDatabase} from '../../scripts/db-test-config.mjs';
import {latestMigrationTag} from '../../scripts/migrations.mjs';
export const ref=(kind,id)=>({kind,id});
export const basis={kind:'reasoning',explanation:'SYNTHETIC independent test reasoning, not an established fact.'};
export function record(body='SYNTHETIC \ubc30 \ud83d\udc1f e\u0301\nexact raw text') {return {title:'SYNTHETIC Stage04',body_text:body,body_format:'plain_text',attributes:{},synthetic_demo:true,reason:'Disposable local regression only',basis:[basis]};}
export function edit(v,replacement='SYNTHETIC changed') {return {record_id:v.record_id,base_version_id:v.id,base_body_sha256:v.body_sha256,edits:[{start:0,end:1,exact:Array.from(v.body_text)[0],replacement}],reason:'SYNTHETIC partial correction',basis:[basis]};}
const operations={'record.create':'kb_create_record','version.create':'kb_create_version','anchor.create':'kb_create_anchor','source.create':'kb_create_source','relation.create':'kb_create_relation','annotation.create':'kb_create_annotation','evidence.create':'kb_create_evidence','review.create':'kb_create_review'};
export const code=expected=>e=>mapDatabaseError(e).code===expected;
export async function openHarness(config){
 const {Client}=await import('pg');
 const clients=Array.from({length:3},()=>new Client({connectionString:config.connectionString,connectionTimeoutMillis:5000,query_timeout:20000,application_name:'nuanox-stage04-disposable'}));
 const [admin,a,b]=clients;
 try{await Promise.all(clients.map(c=>c.connect()));}catch(error){await Promise.allSettled(clients.map(c=>c.end()));throw error;}
 let runtime;try{runtime=await assertTestDatabase(admin,config);
 assert.equal((await admin.query('select migration_tag from knowledge.schema_info where singleton')).rows[0].migration_tag,await latestMigrationTag());}catch(error){await Promise.allSettled(clients.map(c=>c.end()));throw error;}
 console.log(JSON.stringify({scope:'real_disposable_local_postgresql',node:process.version,postgres_version_num:runtime.version,encoding:runtime.encoding,at_utc:new Date().toISOString()}));
 async function raw(c,name,args={}){
  assert.match(name,/^kb_[a-z_]+$/);const entries=Object.entries(args);for(const[k]of entries)assert.match(k,/^p_[a-z_]+$/);
  return (await c.query(`select public.${name}(${entries.map(([k],i)=>`${k} => $${i+1}::jsonb`).join(',')}) result`,entries.map(([,v])=>JSON.stringify(v)))).rows[0].result;
 }
 async function tx(c,fn){await c.query('begin');try{await c.query('set local role service_role');await c.query("set local statement_timeout='15s'");const r=await fn();await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}}
 const rpc=(c,name,args={})=>tx(c,()=>raw(c,name,args));
 async function rawMutation(c,op,input,actor,key=randomUUID()){
  const payload={...input};let operation=op;if(op==='version.create'){operation+=`:${payload.record_id}`;delete payload.record_id;}
  return raw(c,operations[op],{p_context:{actor,operation,idempotency_key:key,request_hash:requestDigest(payload)},p_command:input});
 }
 const mutate=(c,op,input,actor,key)=>tx(c,()=>rawMutation(c,op,input,actor,key));
 async function enroll(label){
  const credential=`nuanox_${randomUUID()}_${randomBytes(32).toString('base64url')}`;let args;
  const db={call:async(name,value)=>{args=value;return rpc(a,name,value);}};
  const auth=new AgentAuth(db,'synthetic-local-database-pepper-'.repeat(2),true);
  const result=await auth.enroll(new Request('http://127.0.0.1',{headers:{authorization:`Bearer ${credential}`}}),{display_name:label,self_description:'SYNTHETIC keyed agent, no human owner'},randomUUID());
  return {actor:{kind:'agent',actor_id:result.data.agent.id,key_id:result.data.key_id},enrollment:args,credential};
 }
 async function waitLock(pid){for(let i=0;i<200;i++){if((await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error('A real second connection did not reach the expected lock barrier.');}
 async function barrier(first,second){let waiting;await a.query('begin');try{await a.query('set local role service_role');const one=await first();waiting=second();waiting.catch(()=>{});await waitLock(b.processID);await a.query('commit');return [one,await waiting];}catch(e){await a.query('rollback');await waiting?.catch(()=>{});throw e;}}
 async function counts(){const tables=['records','versions','version_changes','evidence','search_units','embedding_jobs','mutation_receipts'];const out={};for(const name of tables)out[name]=(await admin.query(`select count(*)::int n from knowledge.${name}`)).rows[0].n;return out;}
 return {admin,a,b,raw,rpc,tx,rawMutation,mutate,enroll,waitLock,barrier,counts,close:()=>Promise.allSettled(clients.map(c=>c.end()))};
}
