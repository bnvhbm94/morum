import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {DomainError} from '../../.test-build/domain/errors.js';
import {createHandler} from '../../.test-build/server/service/http.js';
import {ROUTES,matchRoute} from '../../.test-build/server/service/routes.js';
import {setup,record,token,summary,now,expires} from './helpers.mjs';
const id=randomUUID();
const emptyPage=()=>({items:[],snapshot_id:randomUUID(),scan_index:0,has_more:false,snapshot_at:now(),snapshot_expires_at:expires(),truncated:false});
test('public list needs no session, bearer, claim or me lookup',async()=>{
 const s=setup({kb_list_records:emptyPage});const r=await s.handle(s.req('/records','GET',undefined,{auth:false,headers:{cookie:'irrelevant=browser'}}));assert.equal(r.status,200);assert.deepEqual((await r.json()).data.items,[]);assert(!s.calls.some(x=>/lookup|status|me|claim/.test(x.name)));assert.equal(r.headers.get('set-cookie'),null);
});
test('capabilities truthfully excludes human login and ownership claim',async()=>{const s=setup();const r=await s.handle(s.req('/capabilities','GET',undefined,{auth:false}));const v=await r.json();assert.deepEqual(v.data.authentication,{mode:'open_contribution',human_login:false,owner_claim:false,registration_required:false,credentials_required:false,agent_registration:true,anonymous_reviews:'append_only'});assert.equal(v.data.search.semantic_enabled,false);assert.equal(v.data.search.quality_gate,'not_evaluated');});
test('enrollment is active and response-loss retry has same IDs without any secret echo',async()=>{
 const s=setup(),newToken=token(),key=randomUUID(),body={display_name:'SYNTHETIC Agent',self_description:null};
 const a=await s.handle(s.req('/agents/enroll','POST',body,{token:newToken,headers:{'idempotency-key':key}}));const av=await a.json();assert.equal(a.status,201);assert.equal(av.data.agent.state,'active');
 const b=await s.handle(s.req('/agents/enroll','POST',body,{token:newToken,headers:{'idempotency-key':key}}));const bv=await b.json();assert.equal(b.status,200);assert.equal(bv.data.agent.id,av.data.agent.id);assert.equal(bv.meta.replayed,true);assert(!JSON.stringify(av).includes(newToken));assert(!('claim_url'in av.data));
 const c=await s.handle(s.req('/agents/enroll','POST',{...body,display_name:'changed'},{token:newToken,headers:{'idempotency-key':key}}));assert.equal(c.status,409);
});
test('unknown/unregistered credentials cannot write',async()=>{const s=setup();const r=await s.handle(s.req('/records','POST',record(),{token:token(),headers:{'idempotency-key':randomUUID()}}));assert.equal(r.status,401);assert(!s.calls.some(x=>x.name==='kb_create_record'));});
test('no credentials means anonymous writing, not an implicit account',async()=>{const s=setup({kb_create_record:args=>({data:{version:{id,created_by:null}},replayed:false})});const r=await s.handle(s.req('/records','POST',record(),{auth:false}));assert.equal(r.status,201);assert.deepEqual(s.calls.find(c=>c.name==='kb_create_record').args.p_context.actor,{kind:'anonymous'});});
test('revoked and suspended keys are not active',async()=>{const s=setup();s.keys.get(s.keyId).revoked_at=now();assert.equal((await s.handle(s.req('/agents/self'))).status,401);s.keys.get(s.keyId).revoked_at=null;s.keys.get(s.keyId).state='suspended';assert.equal((await s.handle(s.req('/agents/self'))).status,403);});
test('knowledge mutation identity comes only from the verified key',async()=>{
 let captured;const s=setup({kb_create_record:args=>{captured=args;return {data:{version:{id}},replayed:false};}});const r=await s.handle(s.req('/records','POST',record(),{headers:{'idempotency-key':randomUUID()}}));assert.equal(r.status,201);assert.equal(captured.p_context.actor.actor_id,s.actorId);assert.equal(captured.p_context.actor.kind,'agent');assert(!JSON.stringify(captured).includes(s.credential));
});
for(const field of ['actor_id','created_by','owner_actor_id','role','admin'])test(`mutation refuses client authority ${field}`,async()=>{const s=setup();const r=await s.handle(s.req('/records','POST',{...record(),[field]:id},{headers:{'idempotency-key':randomUUID()}}));assert.equal(r.status,422);assert(!s.calls.some(x=>x.name==='kb_create_record'));});
test('source URL is recorded without any server fetch to that URL',async()=>{
 let input;const s=setup({kb_create_source:args=>{input=args.p_command;return {data:{id,...args.p_command},replayed:false};}});
 const body={url:'https://example.invalid/not-fetched',title:'SYNTHETIC',submitted_text:'A\r\nB',published_at:null,retrieved_at:null,rights_note:null,attributes:{},synthetic_demo:true};
 const r=await s.handle(s.req('/sources','POST',body,{headers:{'idempotency-key':randomUUID()}}));assert.equal(r.status,201);assert.equal(input.submitted_text,'A\r\nB');
});
test('partial version forwards record path and exact base, not current-head assumption',async()=>{
 let input;const s=setup({kb_create_version:args=>{input=args;return {data:{version:{id},branched_from_noncurrent:true},replayed:false};}});
 const body={base_version_id:randomUUID(),base_body_sha256:'a'.repeat(64),edits:[{start:0,end:1,exact:'\ubc30',replacement:'\uc120\ubc15'}],reason:'SYNTHETIC correction',basis:[{kind:'reasoning',explanation:'SYNTHETIC explanation'}]};
 const r=await s.handle(s.req(`/records/${id}/versions`,'POST',body,{headers:{'idempotency-key':randomUUID()}}));assert.equal(r.status,201);assert.equal(input.p_command.record_id,id);assert.equal(input.p_command.base_version_id,body.base_version_id);assert.equal(input.p_context.operation,`version.create:${id}`);
});
test('authenticated review head is independent of public history',async()=>{
 let q;const s=setup({kb_review_head:args=>{q=args;return {actor_id:s.actorId,target:args.p_query.target,focus:args.p_query.focus,review_id:null};}});
 const r=await s.handle(s.req(`/review-head?target_kind=version&target_id=${id}&focus=content`));assert.equal(r.status,200);assert.equal((await r.json()).data.review_id,null);assert.equal(q.p_actor.actor_id,s.actorId);assert(!s.calls.some(x=>x.name==='kb_list_reviews'));
});
test('conflicts are 409 with safe error and request ID, not fake success',async()=>{
 const s=setup({kb_create_record:()=>{throw new DomainError('IDEMPOTENCY_CONFLICT');}});const r=await s.handle(s.req('/records','POST',record(),{headers:{'idempotency-key':randomUUID()}}));const body=await r.json();assert.equal(r.status,409);assert.equal(body.error.code,'IDEMPOTENCY_CONFLICT');assert.equal(body.meta.replayed,false);assert(!('data'in body));assert.equal(r.headers.get('x-request-id'),body.meta.request_id);
});
for(const suffix of ['?limit=01','?limit=1&limit=2','?actor_id=x','?cursor='])test(`invalid list query ${suffix}`,async()=>{const s=setup();const r=await s.handle(s.req('/records'+suffix));assert([400,422].includes(r.status));});
test('transport content-type remains 415 rather than domain 422',async()=>{const s=setup();const r=await s.handle(s.req('/records','POST','{}',{headers:{'content-type':'application/octet-stream','idempotency-key':randomUUID()}}));assert.equal(r.status,415);});
test('duplicate decoded JSON key is 400',async()=>{const s=setup();const r=await s.handle(s.req('/records','POST','{"title":1,"title":2}',{headers:{'idempotency-key':randomUUID()}}));assert.equal(r.status,400);});
test('root array is not an object command',async()=>{const s=setup();assert.equal((await s.handle(s.req('/records','POST',[],{headers:{'idempotency-key':randomUUID()}}))).status,422);});
test('public raw checks DB visibility before conditional 304',async()=>{
 const s=setup({kb_get_raw:()=>{throw new DomainError('NOT_FOUND');}});const r=await s.handle(s.req(`/versions/${id}/raw`,'GET',undefined,{auth:false,headers:{'if-none-match':'*'}}));assert.equal(r.status,404);
});
test('raw is exact Unicode/plain text and successful conditional response is no-store',async()=>{
 const raw='\ubc30 e\u0301 \ud83d\udc1f\n';const s=setup({kb_get_raw:()=>raw});const first=await s.handle(s.req(`/versions/${id}/raw`));assert.equal(await first.text(),raw);const etag=first.headers.get('etag');assert(etag);
 const second=await s.handle(s.req(`/versions/${id}/raw`,'GET',undefined,{headers:{'if-none-match':etag}}));assert.equal(second.status,304);assert.equal(second.headers.get('cache-control'),'no-store');
});
test('part size is bounded; full raw route remains available',async()=>{const s=setup();assert.equal((await s.handle(s.req(`/versions/${id}/part?start=0&end=16001`))).status,400);});
test('HEAD has no body and same metadata',async()=>{const s=setup();const r=await s.handle(s.req('/health','HEAD',undefined,{auth:false}));assert.equal(r.status,200);assert.equal(await r.text(),'');assert.equal(r.headers.get('x-contract-version'),'2.1.0');});
test('unknown methods are 405, unknown routes 404',async()=>{const s=setup();assert.equal((await s.handle(s.req('/records','DELETE'))).status,405);assert.equal((await s.handle(s.req('/does-not-exist'))).status,404);});
for(const path of ['/login','/auth/login','/agents/claim/'+id,'/me'])test(`retired public flow ${path} stays absent`,async()=>{const s=setup();assert.equal((await s.handle(s.req(path))).status,404);});
test('contract-major mismatch is explicit 400',async()=>{const s=setup();assert.equal((await s.handle(s.req('/health','GET',undefined,{headers:{'x-contract-version':'1.0.0'}}))).status,400);});
test('DB outage never becomes empty list',async()=>{const s=setup({kb_list_records:()=>{throw new DomainError('DEPENDENCY_UNAVAILABLE');}});const r=await s.handle(s.req('/records','GET',undefined,{auth:false}));assert.equal(r.status,503);assert.equal((await r.json()).error.code,'DEPENDENCY_UNAVAILABLE');});
test('rate limit has Retry-After and does not continue to storage',async()=>{const s=setup({kb_rate_limit:()=>({allowed:false,retry_after:17})});const r=await s.handle(s.req('/records'));assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'17');assert(!s.calls.some(x=>x.name==='kb_list_records'));});
test('error does not leak thrown stack, API keys, or DB messages',async()=>{const secret='SYNTHETIC_PRIVATE_DRIVER_MESSAGE';const s=setup({kb_health:()=>{throw Error(secret);}});const r=await s.handle(s.req('/capabilities'));assert.equal(r.status,500);assert(!(await r.text()).includes(secret));});
test('health does not pretend unconfigured DB was contacted',async()=>{const h=createHandler(()=>{throw Error('not used');},async()=>{throw new DomainError('NOT_CONFIGURED');});const r=await h(new Request('http://localhost/api/v2/health'));assert.equal(r.status,503);assert.equal((await r.json()).data.database,'not_configured');});
test('every active route has exactly one matching dispatcher signature',()=>{assert.equal(new Set(ROUTES.map(r=>r.method+' '+r.path)).size,ROUTES.length);for(const r of ROUTES){const p=r.path.replace(/:kind/g,'version').replace(/:[a-z_]+/g,id);assert.equal(matchRoute(p,r.method).route.path,r.path);}});

test('known enrollment replay does not consume another new-registration quota',async()=>{
 const s=setup(),newToken=token(),key=randomUUID(),body={display_name:'SYNTHETIC quota replay',self_description:null};
 await s.handle(s.req('/agents/enroll','POST',body,{token:newToken,headers:{'idempotency-key':key}}));
 const n=s.calls.filter(c=>c.name==='kb_rate_limit'&&c.args.p_query.bucket.startsWith('enroll-')).length;
 const r=await s.handle(s.req('/agents/enroll','POST',body,{token:newToken,headers:{'idempotency-key':key}}));
 assert.equal(r.status,200);assert.equal(s.calls.filter(c=>c.name==='kb_rate_limit'&&c.args.p_query.bucket.startsWith('enroll-')).length,n);
});
