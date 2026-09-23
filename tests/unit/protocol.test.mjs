import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import * as text from '../../.test-build/domain/text.js';import {canonicalJSON} from '../../.test-build/domain/idempotency.js';
// The reference implementation and vectors live outside this repository; skip those cases, not the whole file, when absent.
const reference=await import('../../../tools/contract_reference.mjs').catch(()=>null);
let vectors=[];try{vectors=JSON.parse(readFileSync(new URL('../../../contracts/PROTOCOL_VECTORS_V2.json',import.meta.url),'utf8')).vectors;}catch{}
const externalSkip=reference&&vectors.length?false:'external ../tools/contract_reference.mjs or ../contracts/PROTOCOL_VECTORS_V2.json not present';
if(externalSkip)test('production/reference protocol vectors',{skip:externalSkip},()=>{});
function execute(p,v){const x=v.input;switch(v.op){
 case 'slice':return p.codePointSlice(x.text,x.start,x.end);case 'hash':return p.sha256(x.text);
 case 'validate':return p.validateBody(x.text);case 'utf16':return p.utf16ToCodePoint(x.text,x.offset);
 case 'edit':return p.applyEdits(x.text,x.edits);case 'plan':return p.planBodyChange(x.text,x.hash,x.edits,x.metadataChanged);
 case 'canonical':return p.canonicalJSON(x.value);case 'project':return p.projectAnchor(x.text,x.anchor,x.edits,x.directParent);
 case 'chunk_lengths':return p.chunkBody('\uac00'.repeat(x.length)).map(c=>({start:c.start,end:c.end,length:Array.from(c.text).length}));
 default:throw Error('Not a Stage 02 core vector');}}
const production={...text,canonicalJSON};
for(const v of vectors.filter(v=>!['rrf','vector'].includes(v.op)))test(`production/reference ${v.id} ${v.op}`,()=>{
 if(v.error){assert.throws(()=>execute(production,v),e=>e.code===v.error);assert.throws(()=>execute(reference,v),e=>e.code===v.error);}
 else {assert.deepEqual(execute(production,v),v.expected);if(!v.supersedes_v1_expectation)assert.deepEqual(execute(production,v),execute(reference,v));else assert.throws(()=>execute(reference,v),e=>e.code==='INVALID_LINE_ENDINGS');}
});
test('SHA256 matches Node across padding, Korean, emoji and decomposed scalars',()=>{
 for(const s of ['', 'a','a'.repeat(55),'a'.repeat(56),'a'.repeat(64),'a'.repeat(1000),'\ubc30 \ud83d\ude00 \u1100\u1161\n'])assert.equal(text.sha256(s),createHash('sha256').update(s,'utf8').digest('hex'));
});
test('raw decomposition and LF are never normalized',()=>{const s='\u1100\u1161\n';assert.equal(text.validateBody(s),s);assert.notEqual(text.sha256(s),text.sha256(s.normalize('NFC')));});
test('reject NUL/lone surrogate but allow valid surrogate pair',()=>{
 for(const s of ['\0','\ud800','\udc00'])assert.throws(()=>text.validateBody(s),e=>e.code==='INVALID_TEXT');assert.equal(text.cpLength('\ud83d\ude00'),1);
});
test('twenty edits accepted, twenty-one rejected',()=>{
 const edits=Array.from({length:20},(_,i)=>({start:i*2,end:i*2+1,exact:'a',replacement:'b'}));
 assert.equal(text.applyEdits('a'.repeat(40),edits),'ba'.repeat(20));assert.throws(()=>text.applyEdits('a'.repeat(42),[...edits,{start:40,end:41,exact:'a',replacement:'b'}]));
});
test('edit application does not mutate callers or count UTF16 as codepoints',()=>{
 const edits=[{start:1,end:2,exact:'\ud83d\ude00',replacement:'\ubc30'}];const copy=structuredClone(edits);
 assert.equal(text.applyEdits('a\ud83d\ude00b',edits),'a\ubc30b');assert.deepEqual(edits,copy);
 assert.equal(text.codePointToUtf16('a\ud83d\ude00b',2),3);assert.equal(text.utf16ToCodePoint('a\ud83d\ude00b',3),2);
});
test('canonical hash respects UTF16 key sort, arrays, -0 and exact strings',()=>{
 const x={'\uffff':1,'\ud800\udc00':2,a:-0};assert.equal(canonicalJSON(x),'{"a":0,"\ud800\udc00":2,"\uffff":1}');if(reference)assert.equal(canonicalJSON(x),reference.canonicalJSON(x));
 assert.notEqual(canonicalJSON([1,2]),canonicalJSON([2,1]));assert.notEqual(canonicalJSON('\uac00'),canonicalJSON('\u1100\u1161'));
});
