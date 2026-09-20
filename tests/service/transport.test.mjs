import test from 'node:test';import assert from 'node:assert/strict';
import {parseJson,readJson,queryParams,intQuery} from '../../.test-build/server/service/transport.js';
const rejects=['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"x":{"k":1,"k":2}}','[1,]','{"a":true,}','true false','01','+2','NaN','{"a":1}junk','{"x":"\u0001"}','\ufeff{}'];
for(const value of rejects)test(`strict JSON rejects ${JSON.stringify(value).slice(0,65)}`,()=>assert.throws(()=>parseJson(value)));
for(const value of ['{}','[]','true','null','{"x":[1,2,"a\\\"b"]}','{"\ubc30":"\uc120\ubc15"}','-1.25e+2'])test(`strict JSON accepts ${value}`,()=>assert.deepEqual(parseJson(value),JSON.parse(value)));
test('JSON nesting is bounded before recursive JSON tree processing',()=>assert.throws(()=>parseJson('['.repeat(40)+'0'+']'.repeat(40)),e=>e.httpStatus===413));
test('decoded duplicate keys, not raw spelling, are rejected',()=>assert.throws(()=>parseJson('{"a":1,"\\u0061":2}'),e=>e.httpStatus===400));
test('streaming body size limit does not trust Content-Length',async()=>{
 const r=new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json','content-length':'2'},body:'{"x":"'+'a'.repeat(100)+'"}'});
 await assert.rejects(()=>readJson(r,20),e=>e.httpStatus===413);
});
test('invalid UTF-8 is not replaced',async()=>{
 const r=new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:new Uint8Array([123,34,120,34,58,34,255,34,125])});await assert.rejects(()=>readJson(r),e=>e.httpStatus===400);
});
for(const [header,value] of [['content-type','text/plain'],['content-type','application/json; charset=latin1'],['content-encoding','gzip']])test(`unsupported ${header} ${value}`,async()=>{
 const r=new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json',[header]:value},body:'{}'});await assert.rejects(()=>readJson(r),e=>e.httpStatus===415);
});
test('queries reject duplicate and unknown fields',()=>{assert.throws(()=>queryParams(new URL('http://localhost/?a=1&a=2'),['a']));assert.throws(()=>queryParams(new URL('http://localhost/?actor_id=1'),['a']));});
for(const value of ['1e2','01','-1','1.0',' 2','Infinity','9007199254740992'])test(`strict query integer ${value}`,()=>assert.throws(()=>intQuery(value,0,100)));
