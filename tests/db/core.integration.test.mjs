import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {testDatabaseConfig,assertTestDatabase} from '../../scripts/db-test-config.mjs';
const config=testDatabaseConfig();
if(!config){
 test('DB core integration NOT RUN: no TEST_DATABASE_URL; no mock substitute',{skip:'not_run: real disposable PostgreSQL not configured'},()=>{});
}else{
 const {Client}=await import('pg');
 const {requestDigest}=await import('../../.test-build/domain/idempotency.js');
 const p=await import('../../.test-build/domain/text.js');const {mapDatabaseError}=await import('../../.test-build/domain/errors.js');
 const f=JSON.parse(await readFile(new URL('../fixtures/synthetic-core.json',import.meta.url),'utf8'));
 const vectors=JSON.parse(await readFile(new URL('../../../contracts/PROTOCOL_VECTORS.json',import.meta.url),'utf8')).vectors;
 const human=f.actor,agent=f.agent,other={kind:'human',actor_id:'20000000-0000-4000-8000-000000000005',auth_user_id:'20000000-0000-4000-8000-000000000006'};
 const names={'record.create':'kb_create_record','version.create':'kb_create_version','anchor.create':'kb_create_anchor','source.create':'kb_create_source','relation.create':'kb_create_relation','annotation.create':'kb_create_annotation','evidence.create':'kb_create_evidence','review.create':'kb_create_review','work_request.create':'kb_create_work_request','work_request.update':'kb_update_work_request'};
 let admin,a,b,root,childA,childB,anchorOld,anchorNew,source,evidence,firstReview;
 const uid=()=>randomUUID(),ref=(kind,id)=>({kind,id}),baseBasis={kind:'reasoning',explanation:'SYNTHETIC independent argument; not verified'};
 function commandContext(op,command,actor,key){const payload={...command};let operation=op;
  if(op==='version.create'){operation+=`:${payload.record_id}`;delete payload.record_id;}if(op==='work_request.update'){operation+=`:${payload.work_request_id}`;delete payload.work_request_id;}
  return {actor,operation,idempotency_key:key,request_hash:requestDigest(payload)};
 }
 async function rawMutation(c,op,command,actor=human,key=uid()){
  const fn=names[op];assert.ok(fn);const context=commandContext(op,command,actor,key);
  const {rows:[row]}=await c.query(`select public.${fn}($1::jsonb,$2::jsonb) as result`,[JSON.stringify(context),JSON.stringify(command)]);return row.result;
 }
 async function transaction(c,run){await c.query('BEGIN');try{await c.query('SET LOCAL ROLE service_role');const out=await run();await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}}
 const mutate=(c,op,command,actor=human,key=uid())=>transaction(c,()=>rawMutation(c,op,command,actor,key));
 const read=(fn,q={})=>transaction(a,async()=>{assert.ok(/^kb_(get|list)_[a-z_]+$/.test(fn));return (await a.query(`select public.${fn}($1::jsonb) as result`,[JSON.stringify(q)])).rows[0].result;});
 const errorCode=code=>e=>mapDatabaseError(e).code===code;
 const newEdit=(v,text='SYNTHETIC changed')=>({record_id:v.record_id,base_version_id:v.id,base_body_sha256:v.body_sha256,edits:[{start:8,end:10,exact:p.codePointSlice(v.body_text,8,10),replacement:text}],reason:'SYNTHETIC correction',basis:[baseBasis]});
 async function counts(){return (await admin.query(`select (select count(*) from knowledge.records)::int records,(select count(*) from knowledge.versions)::int versions,(select count(*) from knowledge.evidence)::int evidence,(select count(*) from knowledge.search_units)::int units,(select count(*) from knowledge.embedding_jobs)::int jobs,(select count(*) from knowledge.mutation_receipts)::int receipts,(select sum(version_counter) from knowledge.records)::int counter`)).rows[0];}
 async function waitForLock(pid){for(let n=0;n<100;n++){const {rows:[r]}=await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[pid]);if(r?.wait_event_type==='Lock')return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Second real connection did not reach the lock barrier');}
 async function withBarrier(first,second){await a.query('BEGIN');let waiting;try{await a.query('SET LOCAL ROLE service_role');const one=await first();waiting=second();waiting.catch(()=>{});await waitForLock(b.processID);await a.query('COMMIT');return [one,await waiting];}catch(e){await a.query('ROLLBACK');await waiting?.catch(()=>{});throw e;}}
 async function fixtureVisibility(kind,id,visibility){const tables={record:'records',version:'versions',source:'sources',annotation:'annotations'};assert.ok(tables[kind]);await admin.query('BEGIN');try{
  await admin.query('select pg_advisory_xact_lock(2081801,1)');await admin.query("set local knowledge.moderation='on'");await admin.query(`update knowledge.${tables[kind]} set visibility=$1 where id=$2`,[visibility,id]);await admin.query('COMMIT');
 }catch(e){await admin.query('ROLLBACK');throw e;}}
 async function anchor(version,start,end,who=human){return (await mutate(a,'anchor.create',{version_id:version.id,body_sha256:version.body_sha256,selector:p.canonicalSelector(version.body_text,start,end)},who)).data;}
 test('real PostgreSQL core integration (not HTTP, OAuth, live Supabase, or deployment)',async t=>{
  admin=new Client({connectionString:config.connectionString,connectionTimeoutMillis:5000,query_timeout:15000,application_name:'knowledge-stage02-disposable-tests'});a=new Client({connectionString:config.connectionString,connectionTimeoutMillis:5000,query_timeout:15000,application_name:'knowledge-stage02-disposable-tests'});b=new Client({connectionString:config.connectionString,connectionTimeoutMillis:5000,query_timeout:15000,application_name:'knowledge-stage02-disposable-tests'});
  t.after(async()=>{await Promise.allSettled([admin.end(),a.end(),b.end()]);});await Promise.all([admin.connect(),a.connect(),b.connect()]);
  const version=await assertTestDatabase(admin,config);console.log(JSON.stringify({database_version_num:version.version,runtime:process.version,started_at_utc:new Date().toISOString(),scope:'local_disposable_database'}));
  assert.equal((await admin.query("select contract_version from knowledge.schema_info where singleton")).rows[0].contract_version,'1.0.0');
  assert.equal((await admin.query('select count(*)::int n from knowledge.actors')).rows[0].n,0,'Use a fresh migrated database; this suite never deletes existing data.');
  await admin.query(await readFile(new URL('./synthetic-fixture.sql',import.meta.url),'utf8'));
  await t.test('DB01 AC32 exact grants, RLS, search_path and direct writes denied',async()=>{
   const funcs=(await admin.query("select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'kb_%'" )).rows;
   assert.equal(funcs.length,23);for(const fn of funcs){assert.equal(fn.prosecdef,true);assert.ok(fn.proconfig.some(x=>x==='search_path=""'||x==='search_path='));
    const q=(await admin.query("select has_function_privilege('anon',$1::oid,'EXECUTE') anon,has_function_privilege('authenticated',$1::oid,'EXECUTE') authed,has_function_privilege('service_role',$1::oid,'EXECUTE') service",[fn.oid])).rows[0];assert.deepEqual(q,{anon:false,authed:false,service:true});}
   assert.equal((await admin.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='knowledge' and c.relkind='r' and not c.relrowsecurity")).rows[0].n,0);
   for(const role of ['anon','authenticated','service_role']){await a.query('BEGIN');await a.query(`SET LOCAL ROLE ${role}`);await assert.rejects(a.query('select * from knowledge.versions'),e=>e.code==='42501');await a.query('ROLLBACK');}
   for(const role of ['anon','authenticated']){await a.query('BEGIN');await a.query(`SET LOCAL ROLE ${role}`);await assert.rejects(a.query("select public.kb_create_record('{}','{}')"),e=>e.code==='42501');await a.query('ROLLBACK');}
  });
  await t.test('DB02 AC04/05 root and two contending same-base children retained',async()=>{
   root=(await mutate(a,'record.create',f.record)).data.version;const before=root.body_text;
   const [one,two]=await withBarrier(()=>rawMutation(a,'version.create',newEdit(root,'SYNTHETIC A'),human),()=>mutate(b,'version.create',newEdit(root,'SYNTHETIC B'),agent));
   childA=one.data.version;childB=two.data.version;assert.deepEqual([childA.version_no,childB.version_no],[2,3]);assert.equal(childA.parent_version_id,root.id);assert.equal(childB.parent_version_id,root.id);assert.equal(two.data.branched_from_noncurrent,true);
   assert.equal((await read('kb_get_version',{id:root.id})).version.body_text,before);assert.equal((await read('kb_get_record',{id:root.record_id})).version.id,childB.id);assert.equal(childB.created_by,agent.actor_id);
  });
  await t.test('DB03 AC06/07 concurrent replay, lost-response retry, changed payload conflict',async()=>{
   const key=uid(),before=await counts();const [one,two]=await withBarrier(()=>rawMutation(a,'record.create',f.record,human,key),()=>mutate(b,'record.create',f.record,human,key));
   assert.equal(one.data.version.id,two.data.version.id);assert.equal(two.replayed,true);assert.deepEqual((await mutate(a,'record.create',f.record,human,key)).data,one.data);
   const after=await counts();assert.equal(after.versions-before.versions,1);assert.equal(after.receipts-before.receipts,1);
   await assert.rejects(mutate(a,'record.create',{...f.record,title:'DIFFERENT'},human,key),errorCode('IDEMPOTENCY_CONFLICT'));assert.deepEqual(await counts(),after);
  });
  await t.test('DB04 AC08 middle evidence failure rolls back full version, units/jobs and counter',async()=>{
   const before=await counts(),input=newEdit(root);input.basis=[baseBasis,{kind:'external',source_id:uid(),quote:null,explanation:'SYNTHETIC missing FK target'}];
   await assert.rejects(mutate(a,'version.create',input),errorCode('NOT_FOUND'));assert.deepEqual(await counts(),before);
  });
  await t.test('DB05 AC09-14/17 shared text protocol vectors against PostgreSQL',async sub=>{
   for(const v of vectors.filter(v=>!['canonical','rrf','vector'].includes(v.op)))await sub.test(v.id,async()=>{
    const x=v.input;let sql,args;switch(v.op){
     case 'slice':sql='select knowledge.codepoint_slice($1,$2,$3) result';args=[x.text,x.start,x.end];break;
     case 'hash':sql='select knowledge.hash($1) result';args=[x.text];break;
     case 'validate':sql='select knowledge.body($1) result';args=[x.text];break;
     case 'utf16':sql='select knowledge.utf16_to_codepoint($1,$2) result';args=[x.text,x.offset];break;
     case 'edit':sql='select knowledge.apply_edits($1,knowledge.hash($1),$2::jsonb,true) result';args=[x.text,JSON.stringify(x.edits)];break;
     case 'plan':sql="with body as(select knowledge.apply_edits($1,$2,$3::jsonb,$4) val) select jsonb_build_object('body_text',val,'body_sha256',knowledge.hash(val)) result from body";args=[x.text,x.hash,JSON.stringify(x.edits),x.metadataChanged??false];break;
     case 'project':sql='select knowledge.project_anchor($1,$2::jsonb,$3::jsonb,$4) result';args=[x.text,JSON.stringify(x.anchor),JSON.stringify(x.edits),x.directParent];break;
     case 'chunk_lengths':sql="select coalesce(jsonb_agg(jsonb_build_object('start',start_cp,'end',end_cp,'length',length(raw_text))),'[]'::jsonb) result from knowledge.chunk_body($1)";args=['\uac00'.repeat(x.length)];break;
    }
    if(v.error)await assert.rejects(admin.query(sql,args),errorCode(v.error));else assert.deepEqual((await admin.query(sql,args)).rows[0].result,v.expected);
   });
  });
  await t.test('DB06 stored metadata-only change, unsafe/body/hash/no-op rejection and synthetic inheritance',async()=>{
   const before=await counts();for(const [input,code]of [[{...newEdit(root),base_body_sha256:'0'.repeat(64)},'BASE_HASH_MISMATCH'],[{...newEdit(root),edits:[{start:0,end:1,exact:'wrong',replacement:'x'}]},'TEXT_MISMATCH'],[{...newEdit(root),edits:[]},'NO_CHANGE']])await assert.rejects(mutate(a,'version.create',input),errorCode(code));
   assert.deepEqual(await counts(),before);
   const changed=(await mutate(a,'version.create',{...newEdit(root),edits:[],metadata_update:{title:null,attributes_set:{novel:{a:1,nullable:null}}}})).data.version;
   assert.equal(changed.body_text,root.body_text);assert.equal(changed.synthetic_demo,true);assert.equal(changed.title,null);assert.deepEqual(changed.attributes.novel,{a:1,nullable:null});
   await assert.rejects(mutate(a,'version.create',{...newEdit(root),metadata_update:{synthetic_demo:false}}),errorCode('VALIDATION_FAILED'));
  });
  await t.test('DB07 AC19/20/21/48 raw source CRLF, independent argument, typed source and no verification claim',async()=>{
   source=(await mutate(a,'source.create',{url:'http://127.0.0.1/not-fetched',title:'SYNTHETIC source',submitted_text:'raw\r\n\u1100\u1161',published_at:'2026-09-20T00:00:00+09:00',retrieved_at:null,rights_note:null,attributes:{new_field:{value:3.5}},synthetic_demo:true})).data;
   assert.equal(source.submitted_text,'raw\r\n\u1100\u1161');assert.equal(source.published_at,'2026-09-19T15:00:00.000Z');
   evidence=(await mutate(a,'evidence.create',{target:ref('version',root.id),basis:{kind:'external',source_id:source.id,quote:'SYNTHETIC quotation',explanation:'Submitted, not checked'}})).data;assert.equal(evidence.submission_state,'submitted');assert.equal('verified'in evidence,false);
   const reasoning=(await mutate(a,'evidence.create',{target:ref('version',root.id),basis:baseBasis})).data;assert.equal(reasoning.basis.kind,'reasoning');
   const many=Object.fromEntries(Array.from({length:70},(_,i)=>[`field_${i}`,i]));const v=(await mutate(a,'record.create',{...f.record,attributes:many})).data.version;
   const units=(await admin.query("select count(*)::int n,bool_and(lexical_truncated) truncated from knowledge.search_units where version_id=$1 and json_pointer like '/attributes/%'",[v.id])).rows[0];assert.deepEqual(units,{n:64,truncated:true});
  });
  await t.test('DB08 AC09/17/54 anchors disambiguate occurrences; meaning does not certify content',async()=>{
   const first=await anchor(root,0,1);anchorOld=await anchor(root,8,9);anchorNew=await anchor(childA,8,9);
   assert.notEqual(first.id,anchorOld.id);assert.equal(first.selector.exact,anchorOld.selector.exact);assert.equal((await anchor(root,8,9,agent)).id,anchorOld.id);
   const input={anchor_id:anchorOld.id,meaning:'SYNTHETIC contextual sense of the second occurrence',concept_version_id:null,attributes:{condition:'not inferred truth'},supersedes_annotation_id:null,basis:[baseBasis]};
   const an=(await mutate(a,'annotation.create',input)).data;
   const confirmed=(await mutate(a,'annotation.create',{...input,anchor_id:anchorNew.id,supersedes_annotation_id:an.id})).data;assert.equal(confirmed.supersedes_annotation_id,an.id);
   assert.equal((await read('kb_get_object',ref('annotation',an.id))).value.anchor_id,anchorOld.id);assert.equal((await read('kb_get_version',{id:childA.id})).review_summary.approval_inherited,false);
   const object=(await read('kb_get_object',ref('anchor',anchorOld.id)));assert.equal(object.owner_version_id,root.id);
  });
  await t.test('DB09 AC15/21/53 immutable reviews, independent focus counts and no approval inheritance',async()=>{
   const input={target:ref('version',root.id),stance:'agree',focus:'content',explanation:'SYNTHETIC opinion only',previous_review_id:null,basis:[]};
   firstReview=(await mutate(a,'review.create',input)).data;await mutate(a,'review.create',{...input,focus:'meaning'});
   const old=await read('kb_get_version',{id:root.id}),child=await read('kb_get_version',{id:childA.id});assert.equal(old.review_summary.agree,2);assert.equal(old.review_summary.effective_reviewers,1);assert.equal(child.review_summary.review_state,'unreviewed');
   await mutate(a,'review.create',{...input,target:ref('evidence',evidence.id),focus:'quote_match',stance:'disagree'});
   await assert.rejects(mutate(a,'review.create',{...input,target:ref('review',firstReview.id)}),errorCode('VALIDATION_FAILED'));
  });
  await t.test('DB10 AC16 review-slot race preserves history, no NULL head commits',async()=>{
   const input={target:ref('version',root.id),stance:'disagree',focus:'content',explanation:'SYNTHETIC revision A',previous_review_id:firstReview.id,basis:[]};
   await a.query('BEGIN');await a.query('SET LOCAL ROLE service_role');const one=await rawMutation(a,'review.create',input);const pending=mutate(b,'review.create',{...input,explanation:'SYNTHETIC revision B'});pending.catch(()=>{});
   try{await waitForLock(b.processID);await a.query('COMMIT');await assert.rejects(pending,errorCode('REVIEW_HEAD_CHANGED'));}finally{await a.query('ROLLBACK');}
   assert.equal((await admin.query('select count(*)::int n from knowledge.review_heads where review_id is null')).rows[0].n,0);
   assert.equal((await read('kb_get_object',ref('review',firstReview.id))).value.id,firstReview.id);assert.equal(one.data.previous_review_id,firstReview.id);
   await assert.rejects(admin.query("insert into knowledge.review_heads(actor_id,target_kind,target_id,focus,review_id) values($1,'version',$2,'evidence_support',NULL)",[human.actor_id,root.id]),e=>e.code==='23502');
  });
  await t.test('DB11 AC18 correction new-to-old and reverse discoverability',async()=>{
   const relation=(await mutate(a,'relation.create',{from:ref('anchor',anchorNew.id),to:ref('anchor',anchorOld.id),predicate:'corrects',explanation:'SYNTHETIC correction explanation',attributes:{},basis:[baseBasis]})).data;
   const old=await read('kb_get_version',{id:root.id});assert.ok(old.correction_refs.some(r=>r.id===anchorNew.id));
   for(const [target,direction]of [[anchorOld.id,'in'],[anchorNew.id,'out']]){const page=await read('kb_list_relations',{target_kind:'anchor',target_id:target,direction,limit:20});assert.ok(page.items.some(x=>x.value.id===relation.id));}
   assert.equal((await read('kb_get_raw',{id:root.id})),root.body_text);
  });
  await t.test('DB12 AC28 history keyset does not admit versions appended after the upper bound',async()=>{
   const first=await read('kb_list_versions',{record_id:root.record_id,limit:1});const added=(await mutate(a,'version.create',newEdit(root,'SYNTHETIC later'))).data.version;
   const collected=[...first.items];let page=first;
   while(page.has_more){page=await read('kb_list_versions',{record_id:root.record_id,limit:1,upper_version_no:first.upper_version_no,last_version_no:page.last_version_no,snapshot_at:first.snapshot_at});collected.push(...page.items);}
   assert.equal(collected.some(v=>v.id===added.id),false);assert.deepEqual(collected.map(v=>v.version_no),Array.from({length:first.upper_version_no},(_,i)=>first.upper_version_no-i));
  });
  await t.test('DB13 work revision, permissions, resolution refs and idempotent historical response',async()=>{
   const input={title:'SYNTHETIC investigate gap',description:'SYNTHETIC request, not an automated agent job',target:ref('version',root.id),suggested_query:null},createKey=uid();
   const created=(await mutate(a,'work_request.create',input,human,createKey)).data;const claim={work_request_id:created.id,expected_revision:1,action:'claim',reason:'SYNTHETIC self assignment',resolution_refs:[]},claimKey=uid();
   const claimed=(await mutate(a,'work_request.update',claim,agent,claimKey)).data;assert.equal(claimed.assigned_to,agent.actor_id);assert.equal(claimed.revision,2);
   await assert.rejects(mutate(a,'work_request.update',claim,agent),errorCode('TASK_REVISION_CONFLICT'));
   const resolved=(await mutate(a,'work_request.update',{work_request_id:created.id,expected_revision:2,action:'resolve',reason:'SYNTHETIC response attached',resolution_refs:[ref('version',childA.id.toUpperCase())]},human)).data;assert.equal(resolved.status,'resolved');assert.equal(resolved.revision,3);
   assert.deepEqual((await mutate(a,'work_request.create',input,human,createKey)).data,created);assert.deepEqual((await mutate(a,'work_request.update',claim,agent,claimKey)).data,claimed);
   await assert.rejects(mutate(a,'work_request.update',{work_request_id:created.id,expected_revision:3,action:'close',reason:'not owner',resolution_refs:[]},other),errorCode('FORBIDDEN'));
  });
  await t.test('DB14 AC32 forged author/context, pending agent and immutable body refused',async()=>{
   await assert.rejects(mutate(a,'record.create',{...f.record,created_by:other.actor_id}),errorCode('VALIDATION_FAILED'));
   await assert.rejects(mutate(a,'record.create',f.record,{...human,auth_user_id:other.auth_user_id}),errorCode('UNAUTHENTICATED'));
   await assert.rejects(mutate(a,'record.create',f.record,{kind:'agent',actor_id:'20000000-0000-4000-8000-000000000007',key_id:'20000000-0000-4000-8000-000000000008'}),errorCode('AGENT_NOT_APPROVED'));
   await assert.rejects(admin.query('update knowledge.versions set body_text=$1 where id=$2',['OVERWRITE',root.id]),errorCode('FORBIDDEN'));
  });
  await t.test('DB15 hidden/tombstone visibility applies to raw, exact objects, evidence and units',async()=>{
   await fixtureVisibility('source',source.id,'hidden');await assert.rejects(read('kb_get_source',{id:source.id}),errorCode('NOT_FOUND'));await assert.rejects(read('kb_get_object',ref('evidence',evidence.id)),errorCode('NOT_FOUND'));
   assert.equal((await read('kb_get_version',{id:root.id})).basis.some(x=>x.id===evidence.id),false);
   assert.equal((await admin.query('select count(*)::int n from knowledge.search_units where object_source_id=$1 and knowledge.unit_is_public(id)',[source.id])).rows[0].n,0);
   await fixtureVisibility('source',source.id,'public');await fixtureVisibility('version',childB.id,'tombstone');await assert.rejects(read('kb_get_version',{id:childB.id}),errorCode('RESOURCE_GONE'));await fixtureVisibility('version',childB.id,'public');
   await fixtureVisibility('record',root.record_id,'hidden');for(const [fn,q]of [['kb_get_record',{id:root.record_id}],['kb_get_raw',{id:root.id}],['kb_get_object',ref('anchor',anchorOld.id)]])await assert.rejects(read(fn,q),errorCode('NOT_FOUND'));
   await fixtureVisibility('record',root.record_id,'public');
  });
  await t.test('DB16 global snapshot retains IDs/order, skips hidden slots without duplicate pages',async()=>{
   const first=await read('kb_list_records',{limit:1});const stored=(await admin.query('select ordered_entries from knowledge.query_snapshots where id=$1',[first.snapshot_id])).rows[0].ordered_entries;assert.ok(stored.length>2);
   const next=stored[1];await fixtureVisibility('record',next.id,'hidden');const second=await read('kb_list_records',{limit:1,_snapshot_id:first.snapshot_id,_scan_index:first.scan_index});
   assert.deepEqual(second.items,[]);assert.equal(second.scan_index,2);assert.equal(second.has_more,true);
   const third=await read('kb_list_records',{limit:1,_snapshot_id:first.snapshot_id,_scan_index:second.scan_index});assert.equal(third.items[0].value.id,stored[2].id);
   await fixtureVisibility('record',next.id,'public');
  });
  await t.test('DB17 AC48 disabled profile/blocked jobs and derived rebuild do not alter source',async()=>{
   const profile=(await admin.query("select * from knowledge.embedding_profiles where id='openai-te3s-1536-v1'")).rows[0];assert.equal(profile.dimensions,1536);assert.equal(profile.status,'disabled');assert.equal(profile.query_transform,'NFC; LF; trim; no prefix');
   assert.equal((await admin.query("select count(*)::int n from knowledge.embedding_jobs where state<>'blocked' or attempts<>0")).rows[0].n,0);
   const before=await read('kb_get_source',{id:source.id});await admin.query('BEGIN');try{
    await admin.query('delete from knowledge.embedding_jobs where unit_id in(select id from knowledge.search_units where object_source_id=$1)',[source.id]);await admin.query('delete from knowledge.search_units where object_source_id=$1',[source.id]);await admin.query("select knowledge.index_object('source',$1)",[source.id]);
    const after=(await admin.query("select knowledge.dto('source',$1) result",[source.id])).rows[0].result;assert.deepEqual(after,before);
   }finally{await admin.query('ROLLBACK');}
  });
  await t.test('DB18 AC50 equal timestamps still order by version number, never truth',async()=>{
   await a.query('BEGIN');try{await a.query('SET LOCAL ROLE service_role');const one=(await rawMutation(a,'record.create',f.record)).data.version;const two=(await rawMutation(a,'version.create',newEdit(one,'SYNTHETIC same transaction'))).data.version;await a.query('COMMIT');assert.equal(one.created_at,two.created_at);
    await mutate(a,'review.create',{target:ref('version',two.id),stance:'disagree',focus:'content',explanation:'SYNTHETIC disagreement',previous_review_id:null,basis:[]});const view=await read('kb_get_record',{id:one.record_id});assert.equal(view.version.id,two.id);assert.equal(view.review_summary.disagree,1);assert.equal('verified'in view,false);
   }catch(e){await a.query('ROLLBACK');throw e;}
  });
  await t.test('DB20 AC54 separate referent and negated condition anchors do not certify facts',async()=>{
   const body='\ube44\uac00 \uc624\uc9c0 \uc54a\uc73c\uba74 \uadf8 \ubc30\ub294 \ucd9c\ud56d\ud55c\ub2e4.';
   const v=(await mutate(a,'record.create',{...f.record,body_text:body})).data.version;
   const selector=(start,end)=>({unit:'unicode_code_point',start,end,exact:Array.from(body).slice(start,end).join(''),prefix:'',suffix:''});
   const refs=[];
   for(const [start,end,meaning]of [[3,9,'SYNTHETIC negation and conditional scope'],[10,13,'SYNTHETIC ship referent']]){
    const anchor=(await mutate(a,'anchor.create',{version_id:v.id,body_sha256:v.body_sha256,selector:selector(start,end)})).data;
    const annotation=(await mutate(a,'annotation.create',{anchor_id:anchor.id,meaning,concept_version_id:null,supersedes_annotation_id:null,attributes:{},basis:[]})).data;refs.push(annotation);
    await mutate(a,'review.create',{target:ref('annotation',annotation.id),stance:'agree',focus:'meaning',explanation:'SYNTHETIC interpretation only',previous_review_id:null,basis:[]});
   }
   assert.notEqual(refs[0].anchor_id,refs[1].anchor_id);
   const view=await read('kb_get_version',{id:v.id});assert.equal(view.version.body_text,body);assert.equal(view.review_summary.review_state,'unreviewed');
   assert.equal(view.review_summary.agree,0);assert.equal(view.review_summary.approval_inherited,false);
  });
  await t.test('DB19 AC35 core revocation lock contract; real Stage4 revoke API is still separate',async()=>{
   const key=uid();await mutate(a,'record.create',f.record,agent,key);
   await admin.query('BEGIN');await admin.query('select id from knowledge.actors where id=$1 for update',[agent.actor_id]);await admin.query('select id from knowledge.agent_keys where id=$1 for update',[agent.key_id]);
   const pending=mutate(b,'record.create',f.record,agent,key);pending.catch(()=>{});
   try{await waitForLock(b.processID);await admin.query('update knowledge.agent_keys set revoked_at=transaction_timestamp() where id=$1',[agent.key_id]);await admin.query('COMMIT');await assert.rejects(pending,errorCode('KEY_REVOKED'));
    await assert.rejects(mutate(a,'record.create',f.record,agent,key),errorCode('KEY_REVOKED'));
   }finally{await admin.query('ROLLBACK');}
  });
 });
}
