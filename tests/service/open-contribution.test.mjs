/** New public-contribution acceptance at the HTTP/service boundary. RPC is an explicit double. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,record} from './helpers.mjs';
import {createServices} from '../../.test-build/server/service/factory.js';
import {applyEdits,canonicalSelector,sha256} from '../../.test-build/domain/text.js';
const id=randomUUID();
const accept=args=>({data:{version:{id,body_text:args.p_command.body_text,created_by:null}},replayed:false});
const anon={auth:false};
test('public JSON contribution requires neither enrollment, bearer, nor identity cookie',async()=>{
 const s=setup({kb_create_record:accept});
 const r=await s.handle(s.req('/records','POST',record(),anon));
 assert.equal(r.status,201);const c=s.calls.find(c=>c.name==='kb_create_record');
 assert.deepEqual(c.args.p_context.actor,{kind:'anonymous'});
 assert(!s.calls.some(c=>/lookup_key|enroll|agent_status/.test(c.name)));
 assert.match(r.headers.get('idempotency-key'),/^[0-9a-f-]{36}$/);
});
test('body_text alone is a valid JSON record; defaults do not invent a title or evidence',async()=>{
 const raw='Plain natural language. # is a literal symbol.';const s=setup({kb_create_record:accept});
 const r=await s.handle(s.req('/records','POST',{body_text:raw},anon));assert.equal(r.status,201);
 const c=s.calls.find(c=>c.name==='kb_create_record').args.p_command;
 assert.equal(c.body_text,raw);assert.equal(c.body_format,'plain_text');assert.equal(c.title,null);assert.deepEqual(c.basis,[]);assert.deepEqual(c.attributes,{});
});
for(const raw of ['\uFEFF# literal\r\n\ubc30 e\u0301 \ud83d\udc1f\r\n','{"not":"a request envelope"}','<script>do not execute</script>\nhttps://127.0.0.1/private']){
 test('text/plain is stored exactly, not parsed, normalized, fetched or forced to Markdown: '+JSON.stringify(raw),async()=>{
  const s=setup({kb_create_record:accept});const r=await s.handle(s.req('/records','POST',raw,{auth:false,headers:{'content-type':'text/plain; charset=UTF-8'}}));
  assert.equal(r.status,201);const c=s.calls.find(c=>c.name==='kb_create_record');assert.equal(c.args.p_command.body_text,raw);assert.equal(c.args.p_command.body_format,'plain_text');
 });
}
test('explicit Markdown remains optional rather than prohibited',async()=>{
 const s=setup({kb_create_record:accept});const r=await s.handle(s.req('/records','POST',{body_text:'# Optional',body_format:'markdown'},anon));
 assert.equal(r.status,201);assert.equal(s.calls.find(c=>c.name==='kb_create_record').args.p_command.body_format,'markdown');
});
test('anonymous partial edit retains parent, exact text and hash without registering',async()=>{
 const s=setup({kb_create_version:accept});const body={base_version_id:id,base_body_sha256:'a'.repeat(64),edits:[{start:0,end:1,exact:'A',replacement:'B'}],reason:'Correct this one part',basis:[{kind:'reasoning',explanation:'The original overstates its condition.'}]};
 const r=await s.handle(s.req(`/records/${id}/versions`,'POST',body,anon));assert.equal(r.status,201);
 const call=s.calls.find(c=>c.name==='kb_create_version');assert.deepEqual(call.args.p_context.actor,{kind:'anonymous'});assert.deepEqual(call.args.p_command.edits,body.edits);assert.equal(call.args.p_command.base_body_sha256,body.base_body_sha256);
});
test('anonymous review is append-only and never claims another review head',async()=>{
 const body={target:{kind:'version',id},stance:'needs_review',focus:'content',explanation:'Needs a narrower condition.',previous_review_id:null,basis:[]};
 const s=setup({kb_create_review:()=>({data:{id,created_by:null},replayed:false})});
 const r=await s.handle(s.req('/reviews','POST',body,anon));assert.equal(r.status,201);assert(!s.calls.some(c=>c.name==='kb_review_head'));
 const bad=await s.handle(s.req('/reviews','POST',{...body,previous_review_id:randomUUID()},anon));assert.equal(bad.status,422);
 assert.equal(s.calls.filter(c=>c.name==='kb_create_review').length,1);
});
test('provided bad credentials are not silently downgraded to an anonymous write',async()=>{
 const s=setup({kb_create_record:accept});const r=await s.handle(s.req('/records','POST',record(),{auth:false,headers:{authorization:'Bearer invalid'}}));assert.equal(r.status,401);assert(!s.calls.some(c=>c.name==='kb_create_record'));
});
test('caller idempotency identifier is forwarded and echoed, not used as author identity',async()=>{
 const key=randomUUID(),s=setup({kb_create_record:accept});const r=await s.handle(s.req('/records','POST',record(),{auth:false,headers:{'idempotency-key':key}}));
 assert.equal(r.status,201);assert.equal(r.headers.get('idempotency-key'),key);const c=s.calls.find(c=>c.name==='kb_create_record');assert.equal(c.args.p_context.idempotency_key,key);assert.deepEqual(c.args.p_context.actor,{kind:'anonymous'});
});
test('raw input with malformed UTF-8 fails, never substitutes replacement characters',async()=>{
 const s=setup({kb_create_record:accept});const r=await s.handle(new Request('http://localhost/api/v2/records',{method:'POST',headers:{'content-type':'text/plain'},body:new Uint8Array([0xc3,0x28])}));
 assert.equal(r.status,400);assert(!s.calls.some(c=>c.name==='kb_create_record'));
});
test('minimal public service configuration has no agent pepper or enrollment requirement',()=>{
 const s=createServices({NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SECRET_KEY:'synthetic-local-key-not-deployed',CURSOR_SIGNING_KEY:'synthetic-cursor-'.repeat(4)});
 assert.equal(s.auth.registrationEnabled,false);
});
test('CRLF and combining text keep code-point offsets and hash through a local partial edit',()=>{
 const raw='A\r\n\ubc30 e\u0301 \ud83d\udc1f';assert.equal(canonicalSelector(raw,3,4).exact,'\ubc30');
 assert.equal(applyEdits(raw,[{start:3,end:4,exact:'\ubc30',replacement:'\uc120\ubc15'}]),'A\r\n\uc120\ubc15 e\u0301 \ud83d\udc1f');assert.equal(sha256(raw).length,64);
});
test('public client connects and writes JSON and raw natural language without local identity setup',async()=>{
 const {NuanoxClient}=await import('../../examples/nuanox-client.mjs');const s=setup({kb_create_record:accept});const requests=[];
 const c=NuanoxClient.connect('http://localhost',{transport:(url,init)=>{requests.push(init);return s.handle(new Request(url,init));}});
 assert.equal(c.credential,undefined);assert.equal(c.path,undefined);assert.equal(s.calls.length,0);
 assert.equal((await c.write('/records',{body_text:'No required title or Markdown.'})).data.version.created_by,null);
 const raw='\uFEFFplain\r\n\ubc30 e\u0301';assert.equal((await c.writeText(raw,'one-note')).data.version.body_text,raw);
 assert.equal(requests[0].headers.authorization,undefined);assert.equal(requests[1].headers['content-type'],'text/plain; charset=utf-8');
 assert.equal(s.calls.filter(c=>/lookup|enroll/.test(c.name)).length,0);
 assert.equal(await c.intent('retry',{a:1}),await c.intent('retry',{a:1}));await assert.rejects(c.intent('retry',{a:2}));
});
test('anonymous context relations accept a null author without inventing an agent',async()=>{
 const {checkContextPage}=await import('../../.test-build/server/service/rpc-shapes.js');
 const p={snapshot_id:randomUUID(),snapshot_at:new Date().toISOString(),snapshot_expires_at:new Date(Date.now()+590000).toISOString(),scan_index:1,has_more:false,truncated:false,omitted_count:0,items:[],relations:[{id:randomUUID(),created_by:null,created_at:new Date().toISOString(),from:{kind:'version',id},to:{kind:'version',id:randomUUID()},predicate:'corrects',explanation:'A narrower condition',attributes:{}}]};
 assert.doesNotThrow(()=>checkContextPage(p));p.relations[0].created_by='not-a-uuid';assert.throws(()=>checkContextPage(p));
});
test('raw-text client rejects an unpaired surrogate before UTF8 encoding can replace it',async()=>{
 const {NuanoxClient}=await import('../../examples/nuanox-client.mjs');let sent=0;
 const c=NuanoxClient.connect('http://localhost',{transport:()=>{sent++;throw Error('must not call');}});
 await assert.rejects(c.writeText('\ud800'));await assert.rejects(c.writeText('x\0y'));assert.equal(sent,0);
});
test('open write includes retry identifier even on a dependency failure',async()=>{
 const {DomainError}=await import('../../.test-build/domain/errors.js');const s=setup({kb_create_record:()=>{throw new DomainError('DEPENDENCY_UNAVAILABLE');}});
 const r=await s.handle(s.req('/records','POST',{body_text:'Keep this intent for retry'},anon));assert.equal(r.status,503);assert.match(r.headers.get('idempotency-key'),/^[0-9a-f-]{36}$/);assert(!Object.hasOwn(await r.json(),'data'));
});
test('skill mutation examples validate against the actual request contracts',async()=>{
 const {readFile}=await import('node:fs/promises');const {validateCommand}=await import('../../.test-build/domain/validation.js');
 const skill=await readFile(new URL('../../public/skill.md',import.meta.url),'utf8');
 const blocks=[...skill.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m=>JSON.parse(m[1].replaceAll('UUID',id).replaceAll('PARENT_HASH','a'.repeat(64)).replaceAll('64 lowercase hexadecimal characters from the parent','a'.repeat(64))));
 const op=(x)=>x.edits?'version.create':x.selector?'anchor.create':x.meaning?'annotation.create':x.stance?'review.create':Object.hasOwn(x,'submitted_text')?'source.create':Object.hasOwn(x,'body_text')?'record.create':null;
 let n=0;for(const x of blocks){const name=op(x);if(name){assert.doesNotThrow(()=>validateCommand(name,x),name);n++;}if(x.kind&&['external','internal','reasoning'].includes(x.kind))assert.doesNotThrow(()=>validateCommand('evidence.create',{target:{kind:'version',id},basis:x}));}assert.equal(n,6);
});
test('blank optional legacy pepper from .env.example does not block public contributions',()=>{
 const s=createServices({NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SECRET_KEY:'synthetic-local-key-not-deployed',CURSOR_SIGNING_KEY:'synthetic-cursor-'.repeat(4),AGENT_KEY_PEPPER:'',AGENT_REGISTRATION_ENABLED:'false'});
 assert.equal(s.auth.registrationEnabled,false);
});
