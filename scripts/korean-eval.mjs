/** Preserved synthetic cases, measured only against real loopback Next/PostgREST/PostgreSQL. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
import {localHttpConfig} from '../tests/http/local-config.mjs';
import {NuanoxClient} from '../examples/nuanox-client.mjs';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const dataset=JSON.parse(await readFile(join(root,'contracts/KOREAN_SEARCH_EVAL.json'),'utf8'));
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const output=process.env.KOREAN_EVAL_OUTPUT?resolve(process.env.KOREAN_EVAL_OUTPUT):join(root,'reports/stage04_revision/korean-eval-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
if(!output.startsWith(join(root,'reports')+'/'))throw Error('Evaluation reports must be inside the cumulative reports/ directory.');
const result={dataset_version:dataset.dataset_version,started_at_utc:new Date().toISOString(),runtime:process.version,execution_status:'not_run',quality_gate:'not_evaluated',provider:'disabled',basis:'Actual first search page and default bounded context; unit fixtures are not retrieval measurements.',metrics:null,cases:dataset.queries.map(q=>({id:q.id,split:q.split,query:q.query,scope:q.scope,status:'not_run',reason:'No acknowledged local Next/PostgREST/PostgreSQL stack.'}))};
let db;
try{
 const config=localHttpConfig();
 if(!config){result.reason='TEST_DATABASE_URL, ALLOW_TEST_DB_WRITES=1, ACK_DISPOSABLE_POSTGRES=1, TEST_BASE_URL and ACK_LOCAL_HTTP_STACK=1 are required; no HTTP/DB/provider was contacted.';process.exitCode=2;}
 else{
  const {Client}=await import('pg');const {assertTestDatabase}=await import('./db-test-config.mjs');
  db=new Client({connectionString:config.database.connectionString,connectionTimeoutMillis:5000});await db.connect();await assertTestDatabase(db,config.database);
  assert.equal((await db.query('select migration_tag from knowledge.schema_info where singleton')).rows[0].migration_tag,'stage04-open-contribution');
  assert.equal((await db.query('select count(*)::int n from knowledge.records')).rows[0].n,0,'Use a fresh, separately acknowledged evaluation database, not a corpus polluted by regression fixtures. No data is deleted.');
  assert.equal((await db.query('select count(*)::int n from knowledge.sources')).rows[0].n,0);
  const split=process.env.KOREAN_EVAL_SPLIT??'dev';assert.ok(['dev','test'].includes(split),'Choose dev or test explicitly.');
  if(split==='test')assert.equal(process.env.ACK_KOREAN_HOLDOUT,'1','Do not tune with held-out queries. A deliberate test run needs ACK_KOREAN_HOLDOUT=1.');
  const runId=randomUUID(),client=NuanoxClient.connect(config.origin);
  const retry=async action=>{for(let n=0;;n++){try{return await action();}catch(e){if(e.code!=='RATE_LIMITED'||n>=3)throw e;const wait=Number(e.retryAfter);if(!Number.isFinite(wait)||wait<1||wait>65)throw e;await new Promise(r=>setTimeout(r,wait*1000+100));}}};
  const cap=(await retry(()=>client.request('/capabilities'))).data;assert.equal(cap.search.semantic_enabled,false,'This runner never authorizes optional providers.');
  assert.equal(cap.authentication.registration_required,false);
  const versions={},sources={};
  for(const seed of dataset.seed_versions){
   assert.equal(hash(seed.body_text),seed.sha256);assert.equal(seed.synthetic_demo,true);
   const sourceInput={url:null,title:seed.title,submitted_text:seed.body_text,published_at:null,retrieved_at:null,rights_note:seed.source_notice,attributes:{dataset:dataset.dataset_version,slug:seed.slug},synthetic_demo:true};
   sources[seed.slug]=(await retry(()=>client.write('/sources',sourceInput,`source:${seed.slug}`))).data;
   const basis=[{kind:'external',source_id:sources[seed.slug].id,quote:seed.body_text,explanation:'Synthetic evaluation source, not an externally verified fact.'}];
   const meta={title:seed.title,body_format:seed.body_format,attributes_set:seed.attributes};
   let payload,path;
   if(seed.parent_slug){const parent=versions[seed.parent_slug];assert.ok(parent,'Seed parents must precede children.');payload={base_version_id:parent.id,base_body_sha256:parent.body_sha256,edits:[{start:0,end:Array.from(parent.body_text).length,exact:parent.body_text,replacement:seed.body_text}],metadata_update:meta,reason:'Synthetic evaluation revision; preserve parent.',basis};path=`/records/${parent.record_id}/versions`;}
   else{payload={title:seed.title,body_text:seed.body_text,body_format:seed.body_format,attributes:seed.attributes,synthetic_demo:true,reason:'Synthetic Korean evaluation seed.',basis};path='/records';}
   versions[seed.slug]=(await retry(()=>client.write(path,payload,`version:${seed.slug}`))).data.version;
   assert.equal(versions[seed.slug].body_text,seed.body_text);assert.equal(versions[seed.slug].body_sha256,seed.sha256);
   const persisted=(await db.query('select body_text,body_sha256 from knowledge.versions where id=$1',[versions[seed.slug].id])).rows[0];assert.equal(persisted.body_sha256,seed.sha256);assert.equal(persisted.body_text,seed.body_text);
  }
  for(let i=0;i<dataset.relations.length;i++){const rel=dataset.relations[i];await retry(()=>client.write('/relations',{from:{kind:'version',id:versions[rel.from].id},to:{kind:'version',id:versions[rel.to].id},predicate:rel.predicate,explanation:'Synthetic evaluation relation.',attributes:{},basis:[]},`relation:${i}`));}
  for(const seed of dataset.seed_versions){const latest=(await retry(()=>client.request(`/records/${versions[seed.slug].record_id}`))).data;assert.equal(latest.version.id===versions[seed.slug].id,seed.current_expected);}
  result.slug_map=Object.fromEntries(dataset.seed_versions.map(s=>[s.slug,{version_id:versions[s.slug].id,record_id:versions[s.slug].record_id,source_id:sources[s.slug].id,title:s.title,sha256:s.sha256}]));
  result.cases=dataset.queries.map(q=>({id:q.id,split:q.split,query:q.query,scope:q.scope,status:'not_run',reason:q.split===split?'Not reached.':'Other split was deliberately not evaluated.'}));
  const reverse=new Map(Object.entries(versions).map(([slug,v])=>[v.id,slug]));
  for(const q of dataset.queries.filter(q=>q.split===split)){
   const row=result.cases.find(c=>c.id===q.id), response=(await retry(()=>client.search(q.query,{scope:q.scope,filters:{synthetic_demo:q.synthetic_demo_filter},limit:5,include_context:true}))).data;
   assert.equal(response.status.mode,'keyword_only');assert.equal(response.status.query_embedding,'not_attempted');
   const hits=response.hits.slice(0,5),slugs=hits.map(h=>reverse.get(h.version_id)??null),found=new Set(slugs.filter(Boolean));
   const context=new Set((response.context?.items??[]).map(i=>reverse.get(i.target.id)).filter(Boolean));
   let checked=0,exact=0;
   for(const h of hits){if(h.locator.kind!=='body')continue;checked++;const seed=dataset.seed_versions.find(s=>versions[s.slug].id===h.locator.version_id);assert.ok(seed,'Every body locator must resolve to an actual seeded version.');
    const raw=Array.from(seed.body_text).slice(h.locator.start,h.locator.end).join('');if(seed.sha256===h.locator.body_sha256&&(h.snippet_truncated?raw.startsWith(h.snippet):raw===h.snippet))exact++;
   }
   Object.assign(row,{status:'passed',reason:null,retrieval_status:response.status,hit_version_slugs:slugs,context_version_slugs:[...context],context_coverage:response.context_coverage,context_truncated:response.context?.truncated??null,context_has_continuation:!!response.context?.continuation,recall_at_5:q.expected_no_match?null:q.relevant_version_slugs.filter(s=>found.has(s)).length/q.relevant_version_slugs.length,mrr_at_5:q.expected_no_match?null:(()=>{const i=slugs.findIndex(s=>q.relevant_version_slugs.includes(s));return i<0?0:1/(i+1);})(),required_context_recall:q.required_context_slugs.length?q.required_context_slugs.filter(s=>context.has(s)).length/q.required_context_slugs.length:null,negative_abstained:q.expected_no_match?response.hits.length===0:null,body_locators_checked:checked,body_locators_exact:exact,response});
  }
  const rows=result.cases.filter(r=>r.status==='passed'),mean=k=>{const x=rows.map(r=>r[k]).filter(v=>v!==null&&v!==undefined);return x.length?x.reduce((a,b)=>a+Number(b),0)/x.length:null;};
  const checked=rows.reduce((n,r)=>n+r.body_locators_checked,0);
  result.metrics={positive_macro_recall_at_5:mean('recall_at_5'),positive_mrr_at_5:mean('mrr_at_5'),required_context_recall:mean('required_context_recall'),body_locator_exact_accuracy:checked?rows.reduce((n,r)=>n+r.body_locators_exact,0)/checked:null,body_locators_checked:checked,negative_abstention_rate:mean('negative_abstained')};
  result.execution_status='passed';result.quality_gate='not_evaluated';result.quality_note='Measured lexical results only. Per-case passed means request/measurement executed, not retrieval relevance passed. Inspect metrics against preserved thresholds. Field/object locators are not included in body locator accuracy; no semantic/provider acceptance.';result.split=split;
 }
}catch(error){result.execution_status='failed';result.error={code:typeof error?.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:'EVALUATION_FAILED',message:'Execution failed; no empty-list fallback or quality score was substituted. Inspect local redacted command evidence.'};process.exitCode=1;}
finally{await db?.end();result.finished_at_utc=new Date().toISOString();await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({execution_status:result.execution_status,quality_gate:result.quality_gate,report:output,metrics:result.metrics}));}
