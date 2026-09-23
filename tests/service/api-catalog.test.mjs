/** Roadmap 1.6: GET /capabilities advertises the RFC 9727 API catalog via a Link header. */
import test from 'node:test';import assert from 'node:assert/strict';
import {setup} from './helpers.mjs';

test('GET /capabilities carries the api-catalog Link header with no body change',async()=>{
 const s=setup();
 const r=await s.handle(s.req('/capabilities','GET',undefined,{auth:false}));
 assert.equal(r.status,200);
 assert.equal(r.headers.get('link'),'</.well-known/api-catalog>; rel="api-catalog"');
 const v=await r.json();
 assert.deepEqual(v.data.authentication,{mode:'open_contribution',human_login:false,owner_claim:false,registration_required:false,credentials_required:false,agent_registration:true,anonymous_reviews:'append_only'});
});

test('HEAD /capabilities also carries the api-catalog Link header',async()=>{
 const s=setup();
 const r=await s.handle(s.req('/capabilities','HEAD',undefined,{auth:false}));
 assert.equal(r.status,200);
 assert.equal(r.headers.get('link'),'</.well-known/api-catalog>; rel="api-catalog"');
 assert.equal(await r.text(),'');
});
