/** Roadmap 2.1: quote-first selectors. Validation matrix for the optional
 * start/end/prefix/suffix fields, and the /locate read route against a fake db. */
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {setup} from './helpers.mjs';

const id=randomUUID();
const hash64='a'.repeat(64);
const bad=(fn,code='VALIDATION_FAILED')=>assert.throws(fn,e=>e.code===code);

// --- validation matrix: anchor.create selector ---
test('anchor.create: quote-only selector (no start/end) validates',async()=>{
 const {validateCommand}=await import('../../.test-build/domain/validation.js');
 assert.doesNotThrow(()=>validateCommand('anchor.create',{version_id:id,body_sha256:hash64,selector:{unit:'unicode_code_point',exact:'hello'}}));
});
test('anchor.create: positional selector (start and end, no change) still validates',async()=>{
 const {validateCommand}=await import('../../.test-build/domain/validation.js');
 assert.doesNotThrow(()=>validateCommand('anchor.create',{version_id:id,body_sha256:hash64,selector:{unit:'unicode_code_point',start:0,end:5,exact:'hello',prefix:'',suffix:''}}));
});
test('anchor.create: start without end (or end without start) is rejected',async()=>{
 const {validateCommand}=await import('../../.test-build/domain/validation.js');
 bad(()=>validateCommand('anchor.create',{version_id:id,body_sha256:hash64,selector:{unit:'unicode_code_point',start:0,exact:'hello'}}));
 bad(()=>validateCommand('anchor.create',{version_id:id,body_sha256:hash64,selector:{unit:'unicode_code_point',end:5,exact:'hello'}}));
});
test('anchor.create: empty exact without start/end requires non-empty prefix and suffix',async()=>{
 const {validateCommand}=await import('../../.test-build/domain/validation.js');
 bad(()=>validateCommand('anchor.create',{version_id:id,body_sha256:hash64,selector:{unit:'unicode_code_point',exact:''}}));
 bad(()=>validateCommand('anchor.create',{version_id:id,body_sha256:hash64,selector:{unit:'unicode_code_point',exact:'',prefix:'a'}}));
 bad(()=>validateCommand('anchor.create',{version_id:id,body_sha256:hash64,selector:{unit:'unicode_code_point',exact:'',suffix:'b'}}));
 assert.doesNotThrow(()=>validateCommand('anchor.create',{version_id:id,body_sha256:hash64,selector:{unit:'unicode_code_point',exact:'',prefix:'a',suffix:'b'}}));
});
test('anchor.create: prefix/suffix over 32 code points are rejected',async()=>{
 const {validateCommand}=await import('../../.test-build/domain/validation.js');
 bad(()=>validateCommand('anchor.create',{version_id:id,body_sha256:hash64,selector:{unit:'unicode_code_point',exact:'hello',prefix:'a'.repeat(33)}}));
 bad(()=>validateCommand('anchor.create',{version_id:id,body_sha256:hash64,selector:{unit:'unicode_code_point',exact:'hello',suffix:'a'.repeat(33)}}));
 assert.doesNotThrow(()=>validateCommand('anchor.create',{version_id:id,body_sha256:hash64,selector:{unit:'unicode_code_point',exact:'hello',prefix:'a'.repeat(32),suffix:'a'.repeat(32)}}));
});

// --- validation matrix: version.create edits ---
const editsBase={base_version_id:id,base_body_sha256:hash64,reason:'SYNTHETIC reason for the validation matrix.',basis:[{kind:'reasoning',explanation:'SYNTHETIC independent reasoning, not an established fact.'}]};
test('version.create: quote-only edit (no start/end) validates',async()=>{
 const {validateCommand}=await import('../../.test-build/domain/validation.js');
 assert.doesNotThrow(()=>validateCommand('version.create',{...editsBase,edits:[{exact:'hello',replacement:'world'}]}));
});
test('version.create: positional edit (start and end, no change) still validates',async()=>{
 const {validateCommand}=await import('../../.test-build/domain/validation.js');
 assert.doesNotThrow(()=>validateCommand('version.create',{...editsBase,edits:[{start:0,end:0,exact:'',replacement:'insert'}]}));
});
test('version.create: start without end (or end without start) is rejected',async()=>{
 const {validateCommand}=await import('../../.test-build/domain/validation.js');
 bad(()=>validateCommand('version.create',{...editsBase,edits:[{start:0,exact:'hello',replacement:'world'}]}));
 bad(()=>validateCommand('version.create',{...editsBase,edits:[{end:5,exact:'hello',replacement:'world'}]}));
});
test('version.create: empty exact without start/end requires non-empty prefix and suffix',async()=>{
 const {validateCommand}=await import('../../.test-build/domain/validation.js');
 bad(()=>validateCommand('version.create',{...editsBase,edits:[{exact:'',replacement:'x'}]}));
 assert.doesNotThrow(()=>validateCommand('version.create',{...editsBase,edits:[{exact:'',replacement:'x',prefix:'a',suffix:'b'}]}));
});
test('version.create: edit prefix/suffix over 32 code points are rejected',async()=>{
 const {validateCommand}=await import('../../.test-build/domain/validation.js');
 bad(()=>validateCommand('version.create',{...editsBase,edits:[{exact:'hello',replacement:'world',prefix:'a'.repeat(33)}]}));
});

// --- POST /versions/:version_id/locate ---
test('POST /versions/:version_id/locate forwards exact/prefix/suffix and returns the RPC result',async()=>{
 let captured;
 const result={version_id:id,body_sha256:hash64,state:'unique',candidates:[{start:5,end:10,prefix:'pre',suffix:'suf'}],truncated:false};
 const s=setup({kb_locate:args=>{captured=args;return result;}});
 const r=await s.handle(s.req(`/versions/${id}/locate`,'POST',{exact:'hello',prefix:'pre',suffix:'suf'},{auth:false}));
 assert.equal(r.status,200);
 assert.equal(captured.p_query.version_id,id);assert.equal(captured.p_query.exact,'hello');
 assert.equal(captured.p_query.prefix,'pre');assert.equal(captured.p_query.suffix,'suf');
 assert.deepEqual((await r.json()).data,result);
});
test('POST /versions/:version_id/locate defaults prefix/suffix to "" when omitted',async()=>{
 let captured;
 const s=setup({kb_locate:args=>{captured=args;return {version_id:id,body_sha256:hash64,state:'not_found',candidates:[],truncated:false};}});
 const r=await s.handle(s.req(`/versions/${id}/locate`,'POST',{exact:'hello'},{auth:false}));
 assert.equal(r.status,200);assert.equal(captured.p_query.prefix,'');assert.equal(captured.p_query.suffix,'');
});
test('POST /versions/:version_id/locate is public: no authentication required',async()=>{
 const s=setup({kb_locate:()=>({version_id:id,body_sha256:hash64,state:'ambiguous',candidates:[{start:0,end:1,prefix:'',suffix:''},{start:2,end:3,prefix:'',suffix:''}],truncated:false})});
 const r=await s.handle(s.req(`/versions/${id}/locate`,'POST',{exact:'a'},{auth:false}));
 assert.equal(r.status,200);assert.equal((await r.json()).data.state,'ambiguous');
});
test('POST /versions/:version_id/locate requires exact and rejects an unknown body field, without reaching the DB',async()=>{
 const s=setup();
 const missing=await s.handle(s.req(`/versions/${id}/locate`,'POST',{},{auth:false}));assert.equal(missing.status,422);
 const extra=await s.handle(s.req(`/versions/${id}/locate`,'POST',{exact:'hello',bogus:1},{auth:false}));assert.equal(extra.status,422);
 assert(!s.calls.some(c=>c.name==='kb_locate'));
});
test('POST /versions/:version_id/locate rejects prefix/suffix over 32 code points before reaching the DB',async()=>{
 const s=setup();
 const r=await s.handle(s.req(`/versions/${id}/locate`,'POST',{exact:'hello',prefix:'a'.repeat(33)},{auth:false}));
 assert.equal(r.status,422);assert(!s.calls.some(c=>c.name==='kb_locate'));
});
test('POST /versions/:version_id/locate rejects a non-UUID version_id before reaching the DB',async()=>{
 const s=setup();
 const r=await s.handle(s.req('/versions/not-a-uuid/locate','POST',{exact:'hello'},{auth:false}));
 assert.equal(r.status,422);assert(!s.calls.some(c=>c.name==='kb_locate'));
});
test('POST /versions/:version_id/locate reports DEPENDENCY_UNAVAILABLE on a malformed dependency response',async()=>{
 const s=setup({kb_locate:()=>({version_id:id,state:'unique'})});
 const r=await s.handle(s.req(`/versions/${id}/locate`,'POST',{exact:'hello'},{auth:false}));
 assert.equal(r.status,503);assert.equal((await r.json()).error.code,'DEPENDENCY_UNAVAILABLE');
});
