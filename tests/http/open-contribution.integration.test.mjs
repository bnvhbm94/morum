/** Actual fetch -> running Next -> local PostgREST -> acknowledged disposable PostgreSQL. */
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
import {localHttpConfig} from './local-config.mjs';
const config=localHttpConfig();
if(!config)test('Open Next/PostgREST HTTP acceptance NOT RUN',{skip:'No acknowledged running local HTTP/PostgreSQL stack'},()=>{});
else {
 const {Client}=await import('pg');const {assertTestDatabase}=await import('../../scripts/db-test-config.mjs');
 const {NuanoxClient}=await import('../../examples/nuanox-client.mjs');const {protocolFlow}=await import('../../examples/protocol-flow.mjs');
 test('actual open local HTTP contribution',async t=>{
  const db=new Client({connectionString:config.database.connectionString,connectionTimeoutMillis:5000});await db.connect();t.after(()=>db.end());await assertTestDatabase(db,config.database);
  const a=NuanoxClient.connect(config.origin),b=NuanoxClient.connect(config.origin);let flow;
  const identities=(await db.query('select count(*)::int n from knowledge.actors')).rows[0].n;
  await t.test('capabilities and public standard skill require no signup or key',async()=>{
   assert.equal((await a.request('/health')).data.status,'ok');const c=(await a.request('/capabilities')).data;
   assert.equal(c.authentication.registration_required,false);assert.equal(c.authentication.credentials_required,false);assert.equal(c.authentication.mode,'open_contribution');assert.equal(c.search.semantic_enabled,false);
   const r=await fetch(config.origin+'/skill.md',{redirect:'error'});assert.equal(r.status,200);assert.match(await r.text(),/^---\nname: nuanox\n/);
  });
  await t.test('read/write/edit/meaning/evidence/review/context/search persist without enrollment',async()=>{
   flow=await protocolFlow(a,b);assert.deepEqual(flow.agents,[]);assert.equal(flow.root.created_by,null);assert.equal(flow.replayed,true);assert.equal(flow.root.id,flow.replay_version_id);assert.equal(flow.oldView.author,null);
   assert.equal(flow.oldView.version.body_text,flow.root.body_text);assert.equal(flow.child.parent_version_id,flow.root.id);assert.equal(flow.oldView.review_summary.anonymous_reviews,1);assert.equal(flow.oldView.review_summary.effective_reviewers,0);assert.equal(flow.childView.review_summary.anonymous_reviews,0);
   assert.ok(flow.context.items.some(x=>x.reason==='correction'));assert.ok(flow.search.hits.length);assert.equal(flow.search.status.mode,'keyword_only');assert.equal(flow.search.status.reason,'disabled');
   assert.equal((await db.query('select body_text from knowledge.versions where id=$1',[flow.child.id])).rows[0].body_text,flow.child.body_text);
   assert.equal((await db.query('select count(*)::int n from knowledge.actors')).rows[0].n,identities);
   assert.equal((await NuanoxClient.connect(config.origin).request(`/versions/${flow.child.id}`)).data.version.id,flow.child.id);
  });
  await t.test('raw text HTTP preserves BOM, CRLF, Korean, emoji and exact hash through PostgREST',async()=>{
   const text='\uFEFF# literal\r\n\ubc30 e\u0301 \ud83d\udc1f\n',key=randomUUID();const r=await fetch(config.origin+'/api/v2/records',{method:'POST',headers:{'content-type':'text/plain; charset=utf-8','idempotency-key':key},body:text});assert.equal(r.status,201);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('idempotency-key'),key);
   const v=(await r.json()).data.version;assert.equal(v.body_format,'plain_text');assert.equal(v.body_text,text);assert.equal(v.body_sha256,createHash('sha256').update(text).digest('hex'));
   const response=await fetch(config.origin+`/api/v2/versions/${v.id}/raw`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(text));
  });
  await t.test('public contribution does not make administrator or human routes public',async()=>{
   await assert.rejects(a.request('/admin/maintenance',{method:'POST',body:{}}),e=>e.status===401);
   for(const p of ['/api/v1/records','/api/v2/me','/api/v2/work-requests'])assert.equal((await fetch(config.origin+p)).status,404);
   const bad=await fetch(config.origin+'/api/v2/records',{method:'POST',headers:{'content-type':'text/plain'},body:new Uint8Array([0xff])});assert.equal(bad.status,400);
  });
 });
}
