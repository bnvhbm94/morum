import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validateCommand,attributes,parseQueryInteger} from '../../.test-build/domain/validation.js';
import {previewVersion,createVersion} from '../../.test-build/domain/versions.js';import {createRecord} from '../../.test-build/domain/records.js';
import {canonicalJSON,requestDigest,validateIdempotencyKey} from '../../.test-build/domain/idempotency.js';
import {mapDatabaseError,apiFailure,DomainError} from '../../.test-build/domain/errors.js';
const f=JSON.parse(readFileSync(new URL('../fixtures/synthetic-core.json',import.meta.url),'utf8'));
const clone=x=>structuredClone(x),bad=(fn,code='VALIDATION_FAILED')=>assert.throws(fn,e=>e.code===code);
for(const key of ['author_id','created_by','owner_id','role','admin','embedding','actor_id'])test(`forged top-level ${key} rejected`,()=>bad(()=>validateCommand('record.create',{...f.record,[key]:'forged'})));
test('metadata-only is not NO_CHANGE, does not strip synthetic_demo',()=>{
 const input={...f.edit,edits:[],metadata_update:{attributes_set:{novel:{value:42}},title:null}};
 const result=previewVersion(f.version,input);assert.equal(result.body_text,f.version.body_text);assert.equal(result.synthetic_demo,true);assert.equal(result.title,null);assert.deepEqual(result.attributes.novel,{value:42});
});
test('unchanged patch and title cannot create a new version',()=>bad(()=>previewVersion(f.version,{...f.edit,edits:[],metadata_update:{title:f.version.title}}),'NO_CHANGE'));
test('same-body replacement is NO_CHANGE, not a new history entry',()=>bad(()=>previewVersion(f.version,{...f.edit,edits:[{start:0,end:1,exact:'\ubc30',replacement:'\ubc30'}]}),'NO_CHANGE'));
test('cannot remove synthetic flag or send a calculated new body',()=>{
 bad(()=>validateCommand('version.create',{...f.edit,body_text:'forged'}));bad(()=>validateCommand('version.create',{...f.edit,metadata_update:{synthetic_demo:false}}));
});
test('attributes: null is a value; set/remove conflict, unsafe keys, depth and size reject',()=>{
 assert.doesNotThrow(()=>attributes({novel:{n:null,arr:[true,2,'raw']}}));
 bad(()=>validateCommand('version.create',{...f.edit,metadata_update:{attributes_set:{x:1},attributes_remove:['x']}}));
 for(const key of ['__proto__','constructor','prototype'])bad(()=>attributes(JSON.parse(`{"nested":{"${key}":1}}`)));
 let x=1;for(let i=0;i<10;i++)x={x};bad(()=>attributes(x));bad(()=>attributes({x:'x'.repeat(70000)}),'PAYLOAD_TOO_LARGE');
});
test('valid reasoning needs no source URL; empty explanation is rejected',()=>{
 const input={target:{kind:'version',id:f.version.id},basis:{kind:'reasoning',explanation:'Independent synthetic argument'}};
 assert.doesNotThrow(()=>validateCommand('evidence.create',input));bad(()=>validateCommand('evidence.create',{...input,basis:{kind:'reasoning',explanation:' '}}));
});
test('source CRLF is preserved; URL is data, no fetch is performed',()=>{
 const x={url:'http://127.0.0.1/private',title:null,submitted_text:'one\r\ntwo',published_at:null,retrieved_at:null,rights_note:null,attributes:{},synthetic_demo:true};
 const before=JSON.stringify(x);validateCommand('source.create',x);assert.equal(JSON.stringify(x),before);
 for(const url of ['file:///etc/passwd','javascript:alert(1)','https://user:pass@example.invalid/'])bad(()=>validateCommand('source.create',{...x,url}));
});
test('review IDs are exact; review-of-review not in the contract',()=>{
 const input={target:{kind:'review',id:f.version.id},stance:'agree',focus:'content',explanation:'Synthetic',previous_review_id:null,basis:[]};bad(()=>validateCommand('review.create',input));
 assert.doesNotThrow(()=>validateCommand('review.create',{...input,target:{kind:'evidence',id:f.version.id}}));
});
test('work resolve requires refs and integer expected_revision',()=>{
 const x={action:'resolve',expected_revision:1,reason:'Synthetic',resolution_refs:[]};bad(()=>validateCommand('work_request.update',x));
 assert.doesNotThrow(()=>validateCommand('work_request.update',{...x,resolution_refs:[{kind:'version',id:f.version.id}]}));
 bad(()=>validateCommand('work_request.update',{...x,action:'claim',expected_revision:1.1}));
});
test('self relation rejects UUID casing tricks, not meaningful graph cycles',()=>{
 const x={from:{kind:'version',id:'abcdefab-0000-4000-8000-000000000001'},to:{kind:'version',id:'ABCDEFAB-0000-4000-8000-000000000001'},predicate:'corrects',explanation:'Synthetic',attributes:{},basis:[]};bad(()=>validateCommand('relation.create',x));
});
test('idempotency digest ignores object order but not changed text',()=>{
 assert.equal(requestDigest({b:2,a:1}),requestDigest({a:1,b:2}));assert.notEqual(requestDigest({text:'a'}),requestDigest({text:'A'}));
 for(const value of ['short',' '.repeat(20),'x'.repeat(129)])bad(()=>validateIdempotencyKey(value));
 for(const value of [Infinity,NaN,undefined,BigInt(1),[,1]])bad(()=>canonicalJSON(value));
});
test('strict query integers reject floats/exponents/duplicates handled by Stage4 parser',()=>{assert.equal(parseQueryInteger('20'),20);for(const x of ['01','1.1','1e2','-1','NaN','Infinity'])bad(()=>parseQueryInteger(x));});
test('domain sends a single command to its transaction port, no client-calculated body',async()=>{
 const captured=[];const port={async execute(...args){captured.push(args);return {data:f.version,replayed:false};}}; // unit test spy, NOT database proof.
 await createVersion(port,f.actor,f.version.record_id,f.edit,'synthetic-idem-0001');assert.equal(captured.length,1);
 assert.equal(captured[0][0],'version.create');assert.equal(captured[0][1].request_hash,requestDigest(f.edit));assert.equal(captured[0][1].actor.actor_id,f.actor.actor_id);assert.equal('body_text'in captured[0][2],false);
});
test('people and approved-agent contexts use the same domain entrypoint',async()=>{
 const actors=[];const port={async execute(_n,c){actors.push(c.actor.kind);return {data:f.version,replayed:false};}}; // SQL rechecks approval; this is only routing.
 await createRecord(port,f.actor,f.record,'synthetic-idem-0002');await createRecord(port,f.agent,f.record,'synthetic-idem-0003');assert.deepEqual(actors,['human','agent']);
});
test('driver errors map to contract codes without SQL/body/stack/key leakage',()=>{
 for(const code of ['NO_CHANGE','KEY_REVOKED','REVIEW_HEAD_CHANGED'])assert.equal(mapDatabaseError({code:'P0001',message:`KB:${code}`,detail:'SECRET_BODY'}).code,code);
 const value=apiFailure({code:'42601',message:'SELECT SECRET_BODY',stack:'SECRET_STACK'},f.version.id);assert.equal(value.error.code,'INTERNAL_ERROR');assert.equal(JSON.stringify(value).includes('SECRET'),false);assert.equal('stack'in value.error,false);
 assert.equal(mapDatabaseError({code:'40P01'}).retryable,true);assert.equal(new DomainError('TEXT_MISMATCH').status,409);
});

test('sparse arrays cannot hide gaps behind extra properties',()=>{
 const sparse=[];sparse.length=2;sparse[1]='value';sparse.extra='compensating property';
 assert.throws(()=>canonicalJSON(sparse));assert.throws(()=>validateCommand('record.create',{...f.record,attributes:{sparse}}));
});
