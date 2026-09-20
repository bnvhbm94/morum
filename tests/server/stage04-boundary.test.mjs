/** RPC doubles only: malformed success data must not become an empty successful API response. */
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {KnowledgeRepository} from '../../.test-build/server/db/knowledge-repository.js';
import {CursorCodec} from '../../.test-build/server/db/cursor.js';
const dependency=e=>e.code==='DEPENDENCY_UNAVAILABLE';
const repository=value=>new KnowledgeRepository({call:async()=>value},new CursorCodec('a'.repeat(43)));
const at=new Date().toISOString(),expires=new Date(Date.now()+600000).toISOString();
for(const [name,value] of [
 ['missing snapshot metadata',{items:[],has_more:false}],
 ['non-object list value',{items:[{kind:'record',value:null}],snapshot_id:randomUUID(),scan_index:1,has_more:false,snapshot_at:at,snapshot_expires_at:expires,truncated:false}],
 ['non-advancing continuation',{items:[],snapshot_id:randomUUID(),scan_index:0,has_more:true,snapshot_at:at,snapshot_expires_at:expires,truncated:false}]
])test(`S04 list rejects ${name}`,async()=>{await assert.rejects(repository(value).listRecords(),dependency);});
test('S04 raw body cannot be a non-text successful dependency result',async()=>{await assert.rejects(repository({body:'not raw'}).getRaw(randomUUID()),dependency);});
test('S04 history rejects absent timestamps as dependency error',async()=>{await assert.rejects(repository({items:[],has_more:false}).listVersions(randomUUID()),dependency);});
