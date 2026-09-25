/** POST /api/v2/check: bundles source.create + record.create (or an existing record's current
 * version) + evidence.create behind one idempotency key. RPC is an explicit double, as in
 * open-contribution.test.mjs; each fake RPC replays by idempotency_key like the real one does. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup} from './helpers.mjs';

const anon={auth:false};

/** A tiny idempotent create fake: same idempotency_key on the same op returns the same row with replayed:true. */
function idempotentCreate(){
 const seen=new Map();
 return (args)=>{
  const key=args.p_context.idempotency_key;
  if(seen.has(key))return {data:seen.get(key),replayed:true};
  const row={id:randomUUID(),...args.p_command};
  seen.set(key,row);
  return {data:row,replayed:false};
 };
}
function recordCreate(){
 const seen=new Map();
 return (args)=>{
  const key=args.p_context.idempotency_key;
  if(seen.has(key))return {data:seen.get(key),replayed:true};
  const recordId=randomUUID(),versionId=randomUUID();
  const data={version:{id:versionId,record_id:recordId,version_no:1,parent_version_id:null,
   title:args.p_command.title,body_text:args.p_command.body_text,body_format:args.p_command.body_format,
   body_sha256:'a'.repeat(64),attributes:args.p_command.attributes,synthetic_demo:false,
   reason:args.p_command.reason,created_by:null,created_at:new Date().toISOString(),visibility:'public'},
   previous_current_version_id:null,branched_from_noncurrent:false,indexing:{lexical:'ready',semantic:'disabled'}};
  seen.set(key,data);
  return {data,replayed:false};
 };
}
const EXCERPT='City records show the bridge opened in 1932 after years of delay.';
function body(overrides={}){
 return {
  claim:'The bridge opened in 1932.',title:null,record_id:null,
  url:'https://source.example/article',excerpt:EXCERPT,
  quote:'the bridge opened in 1930',explanation:'Direct statement of the opening year.', // deliberately wrong year: not_found by default
  published_at:null,retrieved_at:null,archive_url:null,attributes:{},
  ...overrides,
 };
}
function stubs(){
 return {kb_create_record:recordCreate(),kb_create_source:idempotentCreate(),kb_create_evidence:idempotentCreate()};
}

test('creates a new record, source and evidence in one call',async()=>{
 const s=setup(stubs());
 const r=await s.handle(s.req('/check','POST',body(),anon));
 assert.equal(r.status,201);
 const data=(await r.json()).data;
 assert.ok(data.record_id&&data.version_id&&data.source_id&&data.evidence_id);
 assert.deepEqual(data.created,{record:true,source:true,evidence:true});
 assert.equal(data.quote_check.state,'not_found'); // exact-case mismatch against the excerpt above
 const recordCall=s.calls.find(c=>c.name==='kb_create_record');
 assert.equal(recordCall.args.p_command.body_text,'The bridge opened in 1932.');
 assert.equal(recordCall.args.p_command.title,'The bridge opened in 1932.'.slice(0,120));
 const sourceCall=s.calls.find(c=>c.name==='kb_create_source');
 assert.equal(sourceCall.args.p_command.url,body().url);
 assert.equal(sourceCall.args.p_command.submitted_text,body().excerpt);
 const evidenceCall=s.calls.find(c=>c.name==='kb_create_evidence');
 assert.equal(evidenceCall.args.p_command.target.id,data.version_id);
 assert.equal(evidenceCall.args.p_command.basis.source_id,data.source_id);
});

test('quote_check is found_exact when the quote sits verbatim in the excerpt',async()=>{
 const s=setup(stubs());
 const r=await s.handle(s.req('/check','POST',body({quote:'the bridge opened in 1932'}),anon));
 assert.equal(r.status,201);
 assert.equal((await r.json()).data.quote_check.state,'found_exact');
});

test('an explicit title is used instead of the claim prefix',async()=>{
 const s=setup(stubs());
 await s.handle(s.req('/check','POST',body({title:'Bridge opening'}),anon));
 assert.equal(s.calls.find(c=>c.name==='kb_create_record').args.p_command.title,'Bridge opening');
});

test('archive_url is folded into the source attributes',async()=>{
 const s=setup(stubs());
 await s.handle(s.req('/check','POST',body({archive_url:'https://web.archive.org/web/2026/https://source.example/article'}),anon));
 const sourceCall=s.calls.find(c=>c.name==='kb_create_source');
 assert.deepEqual(sourceCall.args.p_command.attributes,{archive_url:'https://web.archive.org/web/2026/https://source.example/article'});
});

test('an existing record_id targets that record\'s current version and does not create a record',async()=>{
 const recordId=randomUUID(),versionId=randomUUID();
 const s=setup({...stubs(),kb_get_record:()=>({
  version:{id:versionId,record_id:recordId,version_no:1,parent_version_id:null,title:'Existing',body_text:'x',
   body_format:'plain_text',body_sha256:'a'.repeat(64),attributes:{},synthetic_demo:false,reason:'r',
   created_by:null,created_at:new Date().toISOString(),visibility:'public'},
  author:null,is_current:true,current_version_id:versionId,basis:[],review_summary:null,correction_refs:[],
  related_counts:{annotations:0,relations:0,reviews:0},links:{record:'',version:'',history:'',raw:''},
 })});
 const r=await s.handle(s.req('/check','POST',body({record_id:recordId}),anon));
 assert.equal(r.status,201);
 const data=(await r.json()).data;
 assert.equal(data.record_id,recordId);assert.equal(data.version_id,versionId);
 assert.deepEqual(data.created,{record:false,source:true,evidence:true});
 assert(!s.calls.some(c=>c.name==='kb_create_record'));
});

test('replaying the same idempotency-key returns 200 with identical ids and created:false throughout',async()=>{
 const key=randomUUID(),s=setup(stubs());
 const first=await s.handle(s.req('/check','POST',body(),{auth:false,headers:{'idempotency-key':key}}));
 assert.equal(first.status,201);
 const firstData=(await first.json()).data;
 const second=await s.handle(s.req('/check','POST',body(),{auth:false,headers:{'idempotency-key':key}}));
 assert.equal(second.status,200);
 const secondData=(await second.json()).data;
 assert.deepEqual(secondData,{...firstData,created:{record:false,source:false,evidence:false}});
 assert.equal(s.calls.filter(c=>c.name==='kb_create_record').length,2); // replay still round-trips the same sub-key
});

test('empty quote is rejected',async()=>{
 const s=setup(stubs());
 const r=await s.handle(s.req('/check','POST',body({quote:''}),anon));
 assert.equal(r.status,422);
 assert(!s.calls.some(c=>c.name==='kb_create_source'));
});

test('empty claim is rejected',async()=>{
 const s=setup(stubs());
 const r=await s.handle(s.req('/check','POST',body({claim:''}),anon));
 assert.equal(r.status,422);
});

test('a malformed url is rejected',async()=>{
 const s=setup(stubs());
 const r=await s.handle(s.req('/check','POST',body({url:'not a url'}),anon));
 assert.equal(r.status,422);
});

test('an excerpt over the source submitted_text limit is rejected',async()=>{
 const s=setup(stubs());
 const r=await s.handle(s.req('/check','POST',body({excerpt:'a'.repeat(8001)}),anon));
 assert.equal(r.status,422);
});

test('Morum-Agent is passed through to every sub-command as declared provenance',async()=>{
 const s=setup(stubs());
 await s.handle(s.req('/check','POST',body(),{auth:false,headers:{'morum-agent':'model="synthetic-test"; harness="ci"'}}));
 for(const name of ['kb_create_record','kb_create_source','kb_create_evidence']){
  const call=s.calls.find(c=>c.name===name);
  assert.deepEqual(call.args.p_context.agent,{model:'synthetic-test',harness:'ci'});
 }
});
