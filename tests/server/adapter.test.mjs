import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {readFileSync} from 'node:fs';
import {CursorCodec} from '../../.test-build/server/db/cursor.js';import {KnowledgeRepository} from '../../.test-build/server/db/knowledge-repository.js';
import {SupabaseRpcClient,databaseConfig} from '../../.test-build/server/db/client.js';import {mutationContext} from '../../.test-build/domain/idempotency.js';
const f=JSON.parse(readFileSync(new URL('../fixtures/synthetic-core.json',import.meta.url),'utf8'));
const now=Date.parse('2026-09-20T00:00:00.000Z'),expires=new Date(now+600000).toISOString(),at=new Date(now).toISOString();
const codec=()=>new CursorCodec(randomBytes(32).toString('base64url'),()=>now);
const snapshot=(extra={})=>({items:[],snapshot_id:'30000000-0000-4000-8000-000000000001',scan_index:2,has_more:true,snapshot_at:at,snapshot_expires_at:expires,truncated:false,...extra});
const rejected=(p,code)=>assert.rejects(p,e=>e.code===code);
// All transports below are explicit UNIT doubles. None are DB/integration evidence.
test('cursor authenticates query/scope and expires, never silently restarts',()=>{
 const c=codec(),q={record_id:f.version.record_id},token=c.encode('versions',q,{upper_version_no:3,last_version_no:2},expires);
 assert.equal(c.decode(token,'versions',q).upper_version_no,3);
 for(const [t,s,b]of [[token,'records',q],[token,'versions',{record_id:f.version.id}],[`A${token.slice(1)}`,'versions',q]])assert.throws(()=>c.decode(t,s,b),e=>e.code==='CURSOR_INVALID');
 const secret=randomBytes(32).toString('base64url');let time=now;const later=new CursorCodec(secret,()=>time),old=later.encode('records',{}, {},expires);time+=600001;
 assert.throws(()=>later.decode(old,'records',{}),e=>e.code==='CURSOR_EXPIRED');
});
test('server does not synthesize a signing key when not configured',()=>assert.throws(()=>new CursorCodec('short'),e=>e.code==='NOT_CONFIGURED'));
test('global page advances scanned index through hidden rows, not returned count',async()=>{
 const calls=[],c=codec(),db={async call(n,a){calls.push([n,a]);return snapshot();}},repo=new KnowledgeRepository(db,c);
 const p=await repo.listRecords({limit:2});assert.deepEqual(p.items,[]);assert.equal(c.decode(p.page.next_cursor,'records',{}).scan_index,2);
 await repo.listRecords({limit:1,cursor:p.page.next_cursor});assert.equal(calls[1][1].p_query._scan_index,2);assert.equal(calls[1][1].p_query.limit,1);
});
test('changing target or relation direction invalidates cursor before a read',async()=>{
 const repo=new KnowledgeRepository({async call(){return snapshot();}},codec());const q={target_kind:'version',target_id:f.version.id};const p=await repo.listRelations(q);
 await rejected(repo.listRelations({...q,direction:'in',cursor:p.page.next_cursor}),'CURSOR_INVALID');
});
test('version keyset fixes upper number and parent-record binding',async()=>{
 const calls=[],db={async call(n,a){calls.push(a.p_query);return {items:[f.version],upper_version_no:3,last_version_no:2,has_more:true,snapshot_at:at,truncated:false};}},repo=new KnowledgeRepository(db,codec());
 const p=await repo.listVersions(f.version.record_id);await repo.listVersions(f.version.record_id,{cursor:p.page.next_cursor});
 assert.equal(calls[1].upper_version_no,3);assert.equal(calls[1].last_version_no,2);await rejected(repo.listVersions(f.version.id,{cursor:p.page.next_cursor}),'CURSOR_INVALID');
});
test('part preserves exact raw range and binds contextual bounds to the cursor',async()=>{
 const db={async call(){return {version_id:f.version.id,body_sha256:f.version.body_sha256,start:8,end:9,exact:'\ubc30',context_start:0,context_end:20,context_text:f.version.body_text,annotations:[],relations:[],review_summary:{agree:0,disagree:0,needs_review:0,effective_reviewers:0,anonymous_reviews:0,anonymous_stances:{agree:0,disagree:0,needs_review:0},review_state:'unreviewed',approval_inherited:false},truncated:true,pagination:snapshot()};}},repo=new KnowledgeRepository(db,codec());
 const p=await repo.getPart(f.version.id,{start:8,end:9});assert.equal(p.exact,'\ubc30');assert.equal('pagination'in p,false);
 await rejected(repo.getPart(f.version.id,{start:0,end:1,cursor:p.next_cursor}),'CURSOR_INVALID');
});
test('raw read uses narrow raw RPC rather than loading all evidence',async()=>{
 let name;const repo=new KnowledgeRepository({async call(n){name=n;return f.version.body_text;}},codec());assert.equal(await repo.getRaw(f.version.id),f.version.body_text);assert.equal(name,'kb_get_raw');
});
test('repository rejects altered digest and forwards server context to one atomic RPC',async()=>{
 let calls=0;const repo=new KnowledgeRepository({async call(name,a){calls++;assert.equal(name,'kb_create_version');assert.equal(a.p_command.record_id,f.version.record_id);assert.equal(a.p_context.actor.actor_id,f.actor.actor_id);return {data:f.version,replayed:false};}},codec());
 const c=mutationContext(f.actor,`version.create:${f.version.record_id}`,'synthetic-idempotency',f.edit);
 await repo.execute('version.create',c,f.edit,f.version.record_id);assert.equal(calls,1);
 await rejected(repo.execute('version.create',{...c,request_hash:'0'.repeat(64)},f.edit,f.version.record_id),'VALIDATION_FAILED');assert.equal(calls,1);
});
test('RPC transport pins trusted origin, no-store, redirects denied, secret key not in body',async()=>{
 const secret=randomBytes(32).toString('base64url');let calls=0;
 const client=new SupabaseRpcClient({url:'https://project.example.invalid',secretKey:secret},async(url,init)=>{
  calls++;assert.equal(url,'https://project.example.invalid/rest/v1/rpc/kb_create_source');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.headers.apikey,secret);assert.equal(init.headers.authorization,undefined);assert.equal(init.body.includes(secret),false);
  return new Response(JSON.stringify({data:{id:f.version.id},replayed:false}),{status:200});
 });
 await client.call('kb_create_source',{p_command:{url:'http://127.0.0.1/private'}});assert.equal(calls,1);
 await rejected(client.call('kb_set_visibility',{}),'FORBIDDEN');assert.equal(calls,1);
});
test('only serialization/deadlock errors retry (at most two retries), identical body',async()=>{
 let calls=0,previous;const c=new SupabaseRpcClient({url:'https://project.example.invalid',secretKey:randomBytes(32).toString('hex')},async(_url,init)=>{calls++;if(previous)assert.equal(init.body,previous);previous=init.body;
  return calls<3?new Response(JSON.stringify({code:'40P01',message:'private SQL body'}),{status:400}):new Response('{"data":1}',{status:200});});
 assert.deepEqual(await c.call('kb_create_record',{p_command:{synthetic_demo:true}}),{data:1});assert.equal(calls,3);
});
test('validation SQL error is not retried or reflected',async()=>{
 let calls=0;const c=new SupabaseRpcClient({url:'https://project.example.invalid',secretKey:randomBytes(32).toString('hex')},async()=>{calls++;return new Response('{"code":"P0001","message":"KB:TEXT_MISMATCH","detail":"PRIVATE_BODY"}',{status:400});});
 await rejected(c.call('kb_create_version',{}),'TEXT_MISMATCH');assert.equal(calls,1);
});
test('RPC response byte cap cancels oversized data rather than truncating a success DTO',async()=>{
 const c=new SupabaseRpcClient({url:'https://project.example.invalid',secretKey:randomBytes(32).toString('hex'),maxResponseBytes:10},async()=>new Response(JSON.stringify('x'.repeat(40))));await rejected(c.call('kb_get_raw',{}),'PAYLOAD_TOO_LARGE');
});
test('missing configuration and explicit legacy mode remain distinct',()=>{
 assert.throws(()=>databaseConfig({}),e=>e.code==='NOT_CONFIGURED');
 const x=databaseConfig({NEXT_PUBLIC_SUPABASE_URL:'http://localhost:54321',SUPABASE_KEY_MODE:'legacy',SUPABASE_SERVICE_ROLE_KEY:randomBytes(32).toString('hex')});assert.equal(x.keyMode,'legacy');
 assert.throws(()=>databaseConfig({NEXT_PUBLIC_SUPABASE_URL:'http://localhost',SUPABASE_KEY_MODE:'invented',SUPABASE_SECRET_KEY:'not-used'}),e=>e.code==='NOT_CONFIGURED');
});
test('encoding a cursor for a snapshot that just expired reports CURSOR_EXPIRED, not an internal error',()=>{
 const c=new CursorCodec(randomBytes(32).toString('base64url'),()=>now);
 assert.throws(()=>c.encode('search-v2',{q:1},{snapshot_id:'x'},new Date(now-1).toISOString()),e=>e.code==='CURSOR_EXPIRED');
 assert.throws(()=>c.encode('search-v2',{q:1},{snapshot_id:'x'},new Date(now+700000).toISOString()),e=>e.code==='INTERNAL_ERROR');
});
test('single-object reads get a larger byte cap so attached evidence cannot make a version unreadable',async()=>{
 const big=JSON.stringify({pad:'x'.repeat(1200000)}),transport=async()=>new Response(big);
 const c=new SupabaseRpcClient({url:'https://project.example.invalid',secretKey:randomBytes(32).toString('hex')},transport);
 assert.equal((await c.call('kb_get_version',{})).pad.length,1200000);
 await rejected(c.call('kb_list_records',{}),'PAYLOAD_TOO_LARGE');
});
