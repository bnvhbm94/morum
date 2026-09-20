import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {Retrieval} from '../../.test-build/server/service/retrieval.js';
import {CursorCodec} from '../../.test-build/server/db/cursor.js';
import {Embeddings,normalizeVector,normalizeEmbeddingText,PROFILE} from '../../.test-build/server/service/embeddings.js';
import {RateLimiter} from '../../.test-build/server/service/rate-limit.js';
import {setup,off,CURSOR,summary,expires,now} from './helpers.mjs';
const vector=()=>[1,...Array(1535).fill(0)];
const enabled={provider:'openai',apiKey:'synthetic-provider-key-for-transport-double',budgetApproved:true,dataSharingApproved:true,dailyTokenCap:100000,requestTokenCap:8192,timeoutMs:100};
function candidate(){const version_id=randomUUID();return {unit_id:randomUUID(),target:{kind:'version',id:version_id},record_id:randomUUID(),version_id,locator:{kind:'body',version_id,start:10,end:20,body_sha256:'a'.repeat(64)},snippet:'SYNTHETIC',title:null,is_current:true,synthetic_demo:true,lexical_rank:1,semantic_rank:null,review_summary:summary};}
function searchPage(candidates,status,more=false){return {candidates,snapshot_id:randomUUID(),scan_index:candidates.length||1,has_more:more,snapshot_at:now(),snapshot_expires_at:expires(),truncated:false,indexed_units:status.indexed_units,eligible_units:status.eligible_units,stored_status:status};}
const status={mode:'keyword_only',query_embedding:'not_attempted',reason:'disabled',profile_id:null,indexed_units:0,eligible_units:1,quality_gate:'not_evaluated',result_state:'candidates'};
test('disabled semantic path performs no external calls and retains raw locator',async()=>{
 let providerCalls=0;const hit=candidate();const s=setup({kb_search_state:()=>({eligible_units:1,indexed_units:0}),kb_search:()=>searchPage([hit],status)});
 const embeddings=new Embeddings(off,s.rates,async()=>{providerCalls++;throw Error('not allowed');});const r=new Retrieval(s.db,s.cursors,embeddings);
 const result=await r.search({query:'\uc81c\uc8fc\ub3c4 \ubc30',scope:'current',include_context:false});assert.equal(providerCalls,0);assert.equal(result.status.mode,'keyword_only');assert.equal(result.status.reason,'disabled');assert.equal(result.hits[0].locator.start,10);assert.equal(result.hits[0].rrf_score,1/61);assert.equal(result.suggested_work_request,null);
});
test('hybrid combines explicit ranks, not invented truth scores',async()=>{
 const hit={...candidate(),semantic_rank:2};let outbound;
 const s=setup({kb_search_state:()=>({eligible_units:1,indexed_units:1,profile_compatible:true}),kb_search:({p_query})=>{outbound=p_query;return searchPage([hit],{...status,mode:'hybrid',query_embedding:'ready',reason:null,profile_id:PROFILE,indexed_units:1});}});
 const embeddings=new Embeddings(enabled,s.rates,async()=>new Response(JSON.stringify({model:'text-embedding-3-small',data:[{index:0,embedding:vector()}],usage:{total_tokens:1}}),{headers:{'content-type':'application/json'}}));
 const result=await new Retrieval(s.db,s.cursors,embeddings).search({query:'SYNTHETIC',scope:'current',include_context:false});assert.equal(outbound._vector.length,1536);assert.equal(result.hits[0].rrf_score,1/61+1/62);assert.equal(result.status.quality_gate,'not_evaluated');assert.equal(result.hits[0].review_summary.approval_inherited,false);
});
test('continuation reuses frozen snapshot and never re-embeds query',async()=>{
 let calls=0;const hit=candidate();const s=setup({kb_search_state:()=>({eligible_units:2,indexed_units:0}),kb_search:()=>searchPage([hit],status,true)});
 const embeddings=new Embeddings(off,s.rates,async()=>{calls++;throw Error('not allowed');});const r=new Retrieval(s.db,s.cursors,embeddings);
 const first=await r.search({query:'SYNTHETIC',scope:'current',include_context:false});const before=s.calls.filter(x=>x.name==='kb_search_state').length;
 await r.search({query:'SYNTHETIC',scope:'current',include_context:false,cursor:first.page.next_cursor});assert.equal(s.calls.filter(x=>x.name==='kb_search_state').length,before);assert.equal(calls,0);
 await assert.rejects(()=>r.search({query:'different',scope:'current',include_context:false,cursor:first.page.next_cursor}),e=>e.code==='CURSOR_INVALID');
});
test('empty visible page can still have continuation',async()=>{
 const s=setup({kb_search_state:()=>({eligible_units:1,indexed_units:0}),kb_search:()=>searchPage([],status,true)});const r=await s.services.retrieval.search({query:'SYNTHETIC',scope:'current',include_context:false});assert.equal(r.hits.length,0);assert(r.page.next_cursor);
});
test('context continuation binds seeds and depth, and preserves counterarguments',async()=>{
 const seed={kind:'version',id:randomUUID()};const s=setup({kb_context:()=>({items:[{target:seed,reason:'counterargument',text:'SYNTHETIC dissent',synthetic_demo:true,is_current:false,original_url:null,text_truncated:false}],relations:[],truncated:true,omitted_count:null,snapshot_id:randomUUID(),scan_index:1,has_more:true,snapshot_at:now(),snapshot_expires_at:expires()})});
 const a=await s.services.retrieval.context([seed]);assert.deepEqual(a.seeds,[seed]);assert.equal(a.items[0].reason,'counterargument');assert.equal(a.items[0].is_current,false);assert(a.continuation);
 await assert.rejects(()=>s.services.retrieval.context([seed],2,a.continuation),e=>e.code==='CURSOR_INVALID');
});
for(const overrides of [{provider:'disabled'},{budgetApproved:false},{dataSharingApproved:false},{apiKey:undefined},{dailyTokenCap:0},{requestTokenCap:0}])test(`provider gate ${JSON.stringify(overrides)}`,async()=>{
 let network=0,reservations=0;const rate={reserve:async()=>{reservations++;return {allowed:true,retry_after:1};}};const e=new Embeddings({...enabled,...overrides},rate,async()=>{network++;throw Error('not allowed');});const r=await e.embed('SYNTHETIC');assert.equal(r.vector,null);assert.equal(network,0);assert.equal(reservations,0);
});
test('budget reservation is atomic DB call before provider; refused reservation makes no external call',async()=>{
 let network=0;const s=setup({kb_rate_limit:()=>({allowed:false,retry_after:12})});const e=new Embeddings(enabled,s.rates,async()=>{network++;throw Error('not allowed');});const result=await e.embed('SYNTHETIC');assert.equal(result.reason,'budget_exhausted');assert.equal(network,0);assert.equal(s.calls[0].args.p_query.cost,Buffer.byteLength('SYNTHETIC'));
});
test('successful embedding uses fixed origin, model, dimensions, shared normalization',async()=>{
 let call,reservation;const rates={reserve:async(...args)=>{reservation=args;return {allowed:true,retry_after:60};}};
 const e=new Embeddings(enabled,rates,async(url,init)=>{call={url,init};return new Response(JSON.stringify({model:'text-embedding-3-small',data:[{index:0,embedding:vector()}],usage:{total_tokens:2}}));});
 const r=await e.embed(' e\u0301\r\n\ubc30 ');assert.equal(r.vector.length,1536);assert.equal(call.url,'https://api.openai.com/v1/embeddings');assert.equal(call.init.redirect,'error');assert.equal(JSON.parse(call.init.body).input,'\u00e9\n\ubc30');assert.equal(JSON.parse(call.init.body).dimensions,1536);assert.equal(reservation[3],Buffer.byteLength('\u00e9\n\ubc30'));
});
test('provider failure remains an explicit fallback, not a fabricated vector',async()=>{const s=setup();const e=new Embeddings(enabled,s.rates,async()=>new Response('SYNTHETIC private provider detail',{status:429}));const r=await e.embed('SYNTHETIC');assert.deepEqual(r,{vector:null,reason:'provider_error',attempted:true});});
test('provider malformed dimensions/model are rejected',async()=>{const s=setup();for(const data of [{model:'different',data:[{index:0,embedding:vector()}],usage:{total_tokens:2}},{model:'text-embedding-3-small',data:[{index:0,embedding:[1]}],usage:{total_tokens:2}}]){const e=new Embeddings(enabled,s.rates,async()=>new Response(JSON.stringify(data)));assert.equal((await e.embed('SYNTHETIC')).reason,'provider_error');}});
test('invalid/zero vectors are not stored or ranked',()=>{for(const v of [[],Array(1536).fill(0),[NaN,...Array(1535).fill(1)],[Infinity,...Array(1535).fill(1)]])assert.throws(()=>normalizeVector(v));assert.equal(normalizeVector([2,...Array(1535).fill(0)])[0],1);});
test('normalization is not used to change raw stored text',()=>{const raw=' e\u0301\r\n ';assert.equal(normalizeEmbeddingText(raw),'\u00e9');assert.equal(raw,' e\u0301\r\n ');});
test('untrusted forwarding headers do not create attacker-chosen rate buckets',()=>{const s=setup();const a=new Request('http://localhost',{headers:{'x-forwarded-for':'1.2.3.4'}}),b=new Request('http://localhost',{headers:{'x-forwarded-for':'9.8.7.6'}});assert.equal(s.rates.client(a),s.rates.client(b));assert(!s.rates.client(a).includes('1.2.3.4'));});
test('trusted ingress accepts one valid IP, not arbitrary chains',()=>{const s=setup(),rates=new RateLimiter(s.db,CURSOR,'x-real-ip');const a=new Request('http://localhost',{headers:{'x-real-ip':'1.2.3.4'}}),b=new Request('http://localhost',{headers:{'x-real-ip':'1.2.3.4,5.6.7.8'}}),c=new Request('http://localhost');assert.notEqual(rates.client(a),rates.client(c));assert.equal(rates.client(b),rates.client(c));});
