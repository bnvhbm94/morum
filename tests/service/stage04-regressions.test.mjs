/** Independent Stage04 regressions. RPC/provider doubles only, not live DB/provider evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Embeddings,IndexWorker,PROFILE} from '../../.test-build/server/service/embeddings.js';
import {Retrieval} from '../../.test-build/server/service/retrieval.js';
import {AgentAuth} from '../../.test-build/server/service/auth.js';
import {NuanoxClient} from '../../examples/nuanox-client.mjs';
import {setup,token,off,summary,now,expires,PEPPER} from './helpers.mjs';
const enabled={provider:'openai',apiKey:'synthetic-only-never-contact-provider',budgetApproved:true,dataSharingApproved:true,dailyTokenCap:100000,requestTokenCap:8,timeoutMs:100};
const status={mode:'keyword_only',query_embedding:'not_attempted',reason:'disabled',profile_id:null,indexed_units:0,eligible_units:1,quality_gate:'not_evaluated',result_state:'candidates'};
function candidate(target={kind:'version',id:randomUUID()}) {return {unit_id:randomUUID(),target,record_id:randomUUID(),version_id:target.id,locator:{kind:'body',version_id:target.id,start:0,end:1,body_sha256:'a'.repeat(64)},snippet:'x',snippet_truncated:false,title:null,is_current:true,synthetic_demo:true,lexical_rank:1,semantic_rank:null,review_summary:summary};}
function page(candidates=[],stored_status=status){return {candidates,stored_status,snapshot_id:randomUUID(),scan_index:candidates.length,has_more:false,snapshot_at:now(),snapshot_expires_at:expires(),truncated:false};}
function contextPage(){return {items:[],relations:[],truncated:false,omitted_count:null,snapshot_id:randomUUID(),scan_index:0,has_more:false,snapshot_at:now(),snapshot_expires_at:expires()};}
const dependency=e=>e.code==='DEPENDENCY_UNAVAILABLE';
for(const [input,reason] of [['123456789','input_too_large'],['  \r\n ','empty_input']])test(`S04-01 permanent embedding rejection: ${reason}`,async()=>{
 let reservations=0,network=0;const embeddings=new Embeddings(enabled,{reserve:async()=>{reservations++;return {allowed:true};}},async()=>{network++;throw Error('forbidden');});
 assert.deepEqual(await embeddings.embed(input),{vector:null,reason,attempted:false});assert.equal(reservations,0);assert.equal(network,0);
});
test('S04-02 over-cap worker input is dead, not a next-day budget retry',async()=>{
 let finish;const job={id:randomUUID(),unit_id:randomUUID(),input_sha256:'a'.repeat(64),lease_token:randomUUID(),text:'123456789',oversized:false};
 const s=setup({kb_embedding_claim:()=>[job],kb_embedding_finish:({p_query})=>{finish=p_query;return {accepted:true,state:p_query.error==='input_too_large'?'dead':'retry'};},kb_embedding_status:()=>({remaining:1})});
 const e=new Embeddings(enabled,s.rates,()=>{throw Error('No network');});const result=await new IndexWorker(s.db,e).drain({kind:'agent',actor_id:s.actorId,key_id:s.keyId},1);
 assert.equal(finish.error,'input_too_large');assert.equal(result.dead,1);assert.equal(result.retry,0);
});
test('S04-03 malformed claimed job fails closed before provider or completion',async()=>{
 let network=0;const s=setup({kb_embedding_claim:()=>[{id:'not-uuid',text:'x',oversized:false}],kb_embedding_finish:()=>({accepted:true,state:'ready'}),kb_embedding_status:()=>({remaining:0})});
 const e=new Embeddings(enabled,s.rates,async()=>{network++;throw Error('No network');});
 await assert.rejects(new IndexWorker(s.db,e).drain({kind:'agent',actor_id:s.actorId,key_id:s.keyId},1),dependency);assert.equal(network,0);assert(!s.calls.some(x=>x.name==='kb_embedding_finish'));
});
test('S04-04 absent search status cannot be successful empty knowledge',async()=>{
 const s=setup({kb_search_state:()=>({eligible_units:0,indexed_units:0}),kb_search:()=>{const p=page();delete p.stored_status;return p;}});
 await assert.rejects(s.services.retrieval.search({query:'x',scope:'current',include_context:false}),dependency);
});
for(const [name,patch] of [['negative rank',{lexical_rank:-1}],['wrong raw snippet',{snippet:[]}],['bad body bounds',{locator:{kind:'body',version_id:randomUUID(),start:10,end:1,body_sha256:'a'.repeat(64)}}]])test(`S04-05 malformed search candidate ${name}`,async()=>{
 const s=setup({kb_search_state:()=>({eligible_units:1,indexed_units:0}),kb_search:()=>page([{...candidate(),...patch}])});
 await assert.rejects(s.services.retrieval.search({query:'x',scope:'current',include_context:false}),dependency);
});
test('S04-06 malformed context relations cannot be silently accepted',async()=>{
 const s=setup({kb_context:()=>({...contextPage(),relations:null})});await assert.rejects(s.services.retrieval.context([{kind:'version',id:randomUUID()}]),dependency);
});
test('S04-07 duplicate version hits do not spend all context seeds; omitted targets disclosed',async()=>{
 const targets=Array.from({length:7},()=>({kind:'version',id:randomUUID()}));let seeds;
 const s=setup({kb_search_state:()=>({eligible_units:9,indexed_units:0}),kb_search:()=>page([candidate(targets[0]),candidate(targets[0]),candidate(targets[0]),...targets.slice(1).map(x=>candidate(x))]),kb_context:({p_query})=>{seeds=p_query.seeds;return contextPage();}});
 const r=await s.services.retrieval.search({query:'x',scope:'current'});
 assert.deepEqual(seeds,targets.slice(0,5));assert.deepEqual(r.context_coverage,{requested:true,unique_targets:7,expanded_targets:5,omitted_targets:targets.slice(5)});
});
test('S04-08 disabled context explicitly discloses unexpanded targets',async()=>{
 const c=candidate(),s=setup({kb_search_state:()=>({eligible_units:1,indexed_units:0}),kb_search:()=>page([c])});
 const r=await s.services.retrieval.search({query:'x',scope:'current',include_context:false});assert.deepEqual(r.context_coverage,{requested:false,unique_targets:1,expanded_targets:0,omitted_targets:[c.target]});
});
test('S04-09 incompatible stored embedding profile prevents even query provider call',async()=>{
 let network=0,query;const s=setup({kb_search_state:()=>({eligible_units:1,indexed_units:0,profile_compatible:false}),kb_search:({p_query})=>{query=p_query;return page([],p_query._status);}});
 const e=new Embeddings(enabled,s.rates,async()=>{network++;throw Error('No provider');});const r=await new Retrieval(s.db,s.cursors,e).search({query:'x',scope:'current',include_context:false});
 assert.equal(r.status.reason,'profile_mismatch');assert.equal(query._vector,undefined);assert.equal(network,0);
});
test('S04-10 invalid enrollment body does not consume scarce signup quotas',async()=>{
 const s=setup();const r=await s.handle(s.req('/agents/enroll','POST',{display_name:'x',self_description:null,owner_actor_id:randomUUID()},{token:token(),headers:{'idempotency-key':randomUUID()}}));
 assert.equal(r.status,422);assert(!s.calls.some(x=>x.name==='kb_rate_limit'&&x.args.p_query.bucket.startsWith('enroll-')));
});
test('S04-11 disabled enrollment does not consume scarce signup quotas',async()=>{
 const s=setup();s.services.auth=new AgentAuth(s.db,PEPPER,false);
 const r=await s.handle(s.req('/agents/enroll','POST',{display_name:'x',self_description:null},{token:token(),headers:{'idempotency-key':randomUUID()}}));assert.equal(r.status,403);
 assert(!s.calls.some(x=>x.name==='kb_rate_limit'&&x.args.p_query.bucket.startsWith('enroll-')));
});
test('S04-12 client never reflects untrusted response code/request id into logs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nuanox-safe-error-'));try{
 const secret='SYNTHETIC_SECRET_DO_NOT_LOG';const c=await NuanoxClient.initialize('http://localhost',join(dir,'credential.json'),async()=>new Response(JSON.stringify({error:{code:secret},meta:{request_id:secret}}),{status:500}));
 await assert.rejects(c.request('/health'),e=>!e.message.includes(secret)&&e.code==='UNEXPECTED_ERROR');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('S04-13 concurrent initialization publishes only complete private credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nuanox-atomic-'));try{
 for(let round=0;round<4;round++){
  const path=join(dir,String(round),'credential.json');const results=await Promise.all(Array.from({length:24},()=>NuanoxClient.initialize('http://localhost',path)));
  assert.equal(new Set(results.map(c=>c.credential)).size,1);assert.equal(JSON.parse(await readFile(path,'utf8')).credential,results[0].credential);
 }
 }finally{await rm(dir,{recursive:true,force:true});}
});
