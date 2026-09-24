/** Actual PostgreSQL only. Stage07 read surfaces: canonical URL/quote helpers,
 * kb_url_report, kb_dossier, kb_attention, self-declared provenance and
 * anonymous work_request.create. No DB substitute and no automatic reset. */
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {testDatabaseConfig} from '../../scripts/db-test-config.mjs';
const config=testDatabaseConfig();
if(!config)test('Read-surfaces PostgreSQL acceptance NOT RUN',{skip:'No acknowledged disposable local PostgreSQL database'},()=>{});
else {
 const {openHarness,record,edit,basis,ref,code}=await import('./stage04-support.mjs');
 const {requestDigest}=await import('../../.test-build/domain/idempotency.js');
 const {canonicalSelector}=await import('../../.test-build/domain/text.js');
 const anon={kind:'anonymous'};
 function ctx(actor,operation,command,agent){
  const c={actor,operation,idempotency_key:randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),request_hash:requestDigest(command)};
  if(agent)c.agent=agent;return c;
 }
 test('Stage07 read surfaces on real PostgreSQL',async t=>{
  const h=await openHarness(config);t.after(()=>h.close());const {admin,a,b,rpc,mutate}=h;

  await t.test('canonical_url normalizes scheme/host/port/path/query/fragment',async()=>{
   const q=async u=>(await admin.query('select knowledge.canonical_url($1) v',[u])).rows[0].v;
   assert.equal(await q('HTTPS://Example.com:443/a/b/?utm_source=x&keep=1&fbclid=y#frag'),'https://example.com/a/b?keep=1');
   assert.equal(await q('http://example.com:80/'),'https://example.com/');
   assert.equal(await q('http://example.com/a/'),'https://example.com/a');
   assert.equal(await q('http://example.com/'),'https://example.com/');
   assert.equal(await q('ftp://example.com/'),null);
  });

  await t.test('canonical_url (0115): scheme folds http->https, www/mobile/export/dx host rewrites, arXiv and DOI identity',async()=>{
   const q=async u=>(await admin.query('select knowledge.canonical_url($1) v',[u])).rows[0].v;
   assert.equal(await q('https://fda.gov/x'),'https://fda.gov/x');
   assert.equal(await q('https://www.fda.gov/x'),'https://fda.gov/x');
   assert.equal(await q('http://www.fda.gov/x/'),'https://fda.gov/x');
   assert.equal(await q('https://www2.fda.gov/x'),'https://fda.gov/x');

   assert.equal(await q('https://en.wikipedia.org/wiki/Caffeine'),'https://en.wikipedia.org/wiki/Caffeine');
   assert.equal(await q('https://en.m.wikipedia.org/wiki/Caffeine'),'https://en.wikipedia.org/wiki/Caffeine');

   const arxivForm='https://arxiv.org/abs/2305.17493';
   assert.equal(await q(arxivForm),arxivForm);
   assert.equal(await q('https://arxiv.org/abs/2305.17493v3'),arxivForm);
   assert.equal(await q('https://arxiv.org/pdf/2305.17493'),arxivForm);
   assert.equal(await q('https://arxiv.org/pdf/2305.17493v3'),arxivForm);
   assert.equal(await q('https://arxiv.org/pdf/2305.17493.pdf'),arxivForm);
   assert.equal(await q('https://arxiv.org/pdf/2305.17493v3.pdf'),arxivForm);
   assert.equal(await q('https://export.arxiv.org/abs/2305.17493'),arxivForm);
   assert.equal(await q('https://arxiv.org/abs/2305.17493?context=cs'),arxivForm);
   assert.equal(await q('https://arxiv.org/abs/hep-th/9901001'),'https://arxiv.org/abs/hep-th/9901001');

   const doiForm='https://doi.org/10.1038/s42256-023-00726-1';
   assert.equal(await q(doiForm),doiForm);
   assert.equal(await q('https://dx.doi.org/10.1038/S42256-023-00726-1'),doiForm);

   assert.notEqual(await q('https://example.com/a'),await q('https://example.com/b'));
  });

  await t.test('quote_check covers every state including ellipsis fragments',async()=>{
   const q=async(quote,submitted)=>(await admin.query('select knowledge.quote_check($1,$2) v',[quote,submitted])).rows[0].v;
   assert.equal(await q(null,'abc'),'no_quote');
   assert.equal(await q('   ','abc'),'no_quote');
   assert.equal(await q('abc',null),'no_text');
   assert.equal(await q('hello world','say hello world now'),'found_exact');
   assert.equal(await q('“hello”','say "hello" now'),'found_normalized');
   assert.equal(await q('once upon a time…happily ever after','once upon a time, in a land far away, happily ever after'),'found_fragments');
   assert.equal(await q('zzz not present','abc def'),'not_found');
  });

  let source,version,evidenceId,correctionId;
  await t.test('kb_url_report finds a source by a differently-cased/utm URL and reports citation + correction',async()=>{
   const sourceInput={url:'https://Example.com/story?utm_source=news',title:'S',submitted_text:'The sky is blue today.',published_at:null,retrieved_at:null,rights_note:null,attributes:{},synthetic_demo:true};
   source=(await mutate(a,'source.create',sourceInput,anon)).data;
   const v=record('SYNTHETIC url report target body');
   version=(await mutate(a,'record.create',v,anon)).data.version;
   const evInput={target:ref('version',version.id),basis:{kind:'external',source_id:source.id,quote:'sky is blue',explanation:'SYNTHETIC citation'}};
   const evRes=(await mutate(a,'evidence.create',evInput,anon)).data;evidenceId=evRes.id;
   const v2=(await mutate(a,'version.create',edit(version,'Corrected body'),anon)).data.version;
   const corr=(await mutate(a,'relation.create',{from:ref('version',v2.id),to:ref('version',version.id),predicate:'corrects',explanation:'SYNTHETIC correction',attributes:{},basis:[]},anon)).data;correctionId=corr.id;

   const report=await rpc(a,'kb_url_report',{p_query:{url:'https://example.com/story?utm_source=other&fbclid=z'}});
   assert.equal(report.canonical_url,'https://example.com/story');
   assert.equal(report.counts.sources,1);assert.equal(report.sources[0].id,source.id);assert.equal(report.sources[0].has_text,true);
   assert.equal(report.counts.citations,1);const cite=report.citations[0];
   assert.equal(cite.evidence_id,evidenceId);assert.equal(cite.version_id,version.id);assert.equal(cite.is_current,false);
   assert.equal(cite.quote_check.state,'found_exact');
   assert.equal(report.counts.corrections,1);assert.equal(report.corrections[0].relation_id,correctionId);
   assert.equal(report.corrections[0].corrected.id,version.id);assert.equal(report.corrections[0].correcting.id,v2.id);
   assert.equal(report.truncated.sources,false);
  });

  await t.test('kb_dossier: corrections, counterarguments (anonymous + keyed), evidence quote_check, premises, meanings, omitted, blind',async()=>{
   const agentA=await h.enroll('SYNTHETIC read-surfaces reviewer');
   const target=record('SYNTHETIC dossier target body with enough length');
   const tv=(await mutate(a,'record.create',target,anon)).data.version;
   // Two disagree reviews: one anonymous, one keyed (head).
   const disagreeCmd={target:ref('version',tv.id),stance:'disagree',focus:'content',explanation:'SYNTHETIC disagreement',previous_review_id:null,basis:[]};
   await mutate(a,'review.create',disagreeCmd,anon);
   await mutate(a,'review.create',{...disagreeCmd,explanation:'SYNTHETIC keyed disagreement'},agentA.actor);
   // Evidence with an unfindable quote plus an internal premise via depends_on.
   const src=(await mutate(a,'source.create',{url:null,title:null,submitted_text:'Only this exact text is present here.',published_at:null,retrieved_at:null,rights_note:null,attributes:{},synthetic_demo:true},anon)).data;
   await mutate(a,'evidence.create',{target:ref('version',tv.id),basis:{kind:'external',source_id:src.id,quote:'nothing like this exists anywhere',explanation:'SYNTHETIC unverifiable'}},anon);
   const premiseTarget=(await mutate(a,'record.create',record('SYNTHETIC premise body'),anon)).data.version;
   await mutate(a,'relation.create',{from:ref('version',tv.id),to:ref('version',premiseTarget.id),predicate:'depends_on',explanation:'SYNTHETIC premise link',attributes:{},basis:[]},anon);
   // Corrects the premise, to exercise status.corrected.
   const premiseV2=(await mutate(a,'version.create',edit(premiseTarget,'Corrected premise'),anon)).data.version;
   await mutate(a,'relation.create',{from:ref('version',premiseV2.id),to:ref('version',premiseTarget.id),predicate:'corrects',explanation:'SYNTHETIC premise correction',attributes:{},basis:[]},anon);
   // Meaning annotation.
   const start=Array.from(tv.body_text).indexOf('S'),selector=canonicalSelector(tv.body_text,start,start+1);
   const anchor=(await mutate(a,'anchor.create',{version_id:tv.id,body_sha256:tv.body_sha256,selector},anon)).data;
   await mutate(a,'annotation.create',{anchor_id:anchor.id,meaning:'SYNTHETIC meaning',concept_version_id:null,attributes:{},supersedes_annotation_id:null,basis:[]},anon);

   const dossier=await rpc(a,'kb_dossier',{p_query:{target:ref('version',tv.id)}});
   assert.equal(dossier.version.id,tv.id);assert.equal(dossier.blind,false);
   assert.equal(dossier.counterarguments.reviews.length,2);
   assert.ok(dossier.counterarguments.reviews.every(rv=>rv.stance==='disagree'));
   assert.equal(dossier.counterarguments.groups.keyed_actors,1);assert.equal(dossier.counterarguments.groups.anonymous_reviews,1);
   // record.create also attaches a reasoning-basis evidence row; find the external one among them.
   const external=dossier.evidence.find(e=>e.basis.kind==='external');
   assert.ok(external);assert.equal(external.quote_check.state,'not_found');
   assert.equal(dossier.premises.length,1);assert.equal(dossier.premises[0].version_id,premiseTarget.id);assert.equal(dossier.premises[0].status.corrected,true);
   assert.equal(dossier.meanings.length,1);assert.equal(dossier.meanings[0].anchor_id,anchor.id);
   assert.ok('corrections' in dossier.omitted&&'counterarguments' in dossier.omitted&&'evidence' in dossier.omitted&&'premises' in dossier.omitted&&'meanings' in dossier.omitted&&'related' in dossier.omitted&&'contradicts' in dossier.omitted);
   assert.equal(dossier.omitted.evidence,0);

   const blindView=await rpc(a,'kb_dossier',{p_query:{target:ref('version',tv.id),blind:true}});
   assert.equal(blindView.blind,true);assert.deepEqual(blindView.counterarguments.reviews,[]);
   assert.equal(blindView.counterarguments.groups.keyed_actors,1);assert.equal(blindView.counterarguments.groups.anonymous_reviews,1);
  });

  await t.test('kb_dossier (2.9/0113): agreements.reviews carries individual agree reviews with anchor exact/start/end; a version-kind on stays bare; blind hides the listing but keeps counts/truncated',async()=>{
   const agentB=await h.enroll('SYNTHETIC agreements reviewer');
   const target=record('SYNTHETIC agreements dossier target body with enough length for an anchor');
   const tv=(await mutate(a,'record.create',target,anon)).data.version;
   const start=Array.from(tv.body_text).indexOf('a'),selector=canonicalSelector(tv.body_text,start,start+1);
   const anchor=(await mutate(a,'anchor.create',{version_id:tv.id,body_sha256:tv.body_sha256,selector},anon)).data;

   const agreeAnchorCmd={target:ref('anchor',anchor.id),stance:'agree',focus:'content',explanation:'SYNTHETIC anchor agreement',previous_review_id:null,basis:[]};
   const anonAgree=(await mutate(a,'review.create',agreeAnchorCmd,anon)).data;
   await mutate(a,'review.create',{...agreeAnchorCmd,explanation:'SYNTHETIC keyed anchor agreement'},agentB.actor);
   const disagreeAnchorCmd={target:ref('anchor',anchor.id),stance:'disagree',focus:'content',explanation:'SYNTHETIC anchor disagreement',previous_review_id:null,basis:[]};
   const anonDisagreeOnAnchor=(await mutate(a,'review.create',disagreeAnchorCmd,anon)).data;
   const disagreeVersionCmd={target:ref('version',tv.id),stance:'disagree',focus:'content',explanation:'SYNTHETIC version disagreement',previous_review_id:null,basis:[]};
   await mutate(a,'review.create',disagreeVersionCmd,anon);

   const dossier=await rpc(a,'kb_dossier',{p_query:{target:ref('version',tv.id)}});
   assert.equal(dossier.agreements.agree_keyed,1);assert.equal(dossier.agreements.agree_anonymous,1);
   assert.equal(dossier.agreements.reviews.length,2);
   assert.ok(dossier.agreements.reviews.every(rv=>rv.stance==='agree'));
   assert.equal(typeof dossier.agreements.truncated,'boolean');assert.equal(dossier.agreements.truncated,false);
   const anchoredAgree=dossier.agreements.reviews.find(rv=>rv.id===anonAgree.id);
   assert.ok(anchoredAgree);
   assert.deepEqual(Object.keys(anchoredAgree).sort(),['created_at','created_by','declared','explanation','focus','id','on','stance'].sort());
   assert.equal(anchoredAgree.on.kind,'anchor');assert.equal(anchoredAgree.on.id,anchor.id);
   assert.equal(anchoredAgree.on.exact,'a');assert.equal(anchoredAgree.on.start,start);assert.equal(anchoredAgree.on.end,start+1);

   // The same anchor-ref enrichment applies to counterarguments.reviews' 'on' field.
   const anchoredDisagree=dossier.counterarguments.reviews.find(rv=>rv.id===anonDisagreeOnAnchor.id);
   assert.ok(anchoredDisagree);assert.equal(anchoredDisagree.on.kind,'anchor');
   assert.equal(anchoredDisagree.on.exact,'a');assert.equal(anchoredDisagree.on.start,start);assert.equal(anchoredDisagree.on.end,start+1);
   // A version-kind 'on' ref is unchanged: no exact/start/end keys at all.
   const versionDisagree=dossier.counterarguments.reviews.find(rv=>rv.on.kind==='version');
   assert.ok(versionDisagree);assert.equal(Object.hasOwn(versionDisagree.on,'exact'),false);
   assert.equal(Object.hasOwn(versionDisagree.on,'start'),false);assert.equal(Object.hasOwn(versionDisagree.on,'end'),false);

   const blindView=await rpc(a,'kb_dossier',{p_query:{target:ref('version',tv.id),blind:true}});
   assert.deepEqual(blindView.agreements.reviews,[]);
   assert.equal(blindView.agreements.agree_keyed,1);assert.equal(blindView.agreements.agree_anonymous,1);
   assert.equal(blindView.agreements.truncated,false);
  });

  await t.test('kb_dossier (0114): evidence attached to an anchor of the version is included alongside version-targeted evidence',async()=>{
   const target=record('SYNTHETIC anchor evidence dossier target body with enough length for an anchor');
   const tv=(await mutate(a,'record.create',target,anon)).data.version;
   const start=Array.from(tv.body_text).indexOf('a'),selector=canonicalSelector(tv.body_text,start,start+1);
   const anchor=(await mutate(a,'anchor.create',{version_id:tv.id,body_sha256:tv.body_sha256,selector},anon)).data;
   const src=(await mutate(a,'source.create',{url:null,title:null,submitted_text:'Only this exact text is present here.',published_at:null,retrieved_at:null,rights_note:null,attributes:{},synthetic_demo:true},anon)).data;
   const versionEv=(await mutate(a,'evidence.create',{target:ref('version',tv.id),basis:{kind:'external',source_id:src.id,quote:'nothing like this exists anywhere',explanation:'SYNTHETIC version evidence'}},anon)).data;
   const anchorEv=(await mutate(a,'evidence.create',{target:ref('anchor',anchor.id),basis:{kind:'external',source_id:src.id,quote:'nothing like this exists anywhere',explanation:'SYNTHETIC anchor evidence'}},anon)).data;

   const dossier=await rpc(a,'kb_dossier',{p_query:{target:ref('version',tv.id)}});
   const ids=dossier.evidence.map(e=>e.id);
   assert.ok(ids.includes(versionEv.id),'version-targeted evidence present');
   assert.ok(ids.includes(anchorEv.id),'anchor-targeted evidence present');
   assert.equal(dossier.omitted.evidence,0);
  });

  await t.test('kb_attention: quote_not_found ranks before unreviewed, reasons filter, counts, seed determinism',async()=>{
   const src=(await mutate(a,'source.create',{url:null,title:null,submitted_text:'Sample submitted text for attention.',published_at:null,retrieved_at:null,rights_note:null,attributes:{},synthetic_demo:true},anon)).data;
   const tv=(await mutate(a,'record.create',record('SYNTHETIC attention target'),anon)).data.version;
   await mutate(a,'evidence.create',{target:ref('version',tv.id),basis:{kind:'external',source_id:src.id,quote:'text nowhere present at all',explanation:'SYNTHETIC'}},anon);
   const all=await rpc(a,'kb_attention',{p_query:{limit:50}});
   const qnf=all.items.findIndex(i=>i.reason==='quote_not_found');const unrev=all.items.findIndex(i=>i.reason==='unreviewed');
   if(qnf>=0&&unrev>=0)assert.ok(qnf<unrev);
   assert.ok(all.counts.quote_not_found>=1);

   const filtered=await rpc(a,'kb_attention',{p_query:{reasons:['quote_not_found']}});
   assert.ok(filtered.items.every(i=>i.reason==='quote_not_found'));

   const s1=await rpc(a,'kb_attention',{p_query:{limit:10,seed:'seed-a'}});
   const s1b=await rpc(a,'kb_attention',{p_query:{limit:10,seed:'seed-a'}});
   assert.deepEqual(s1.items.map(i=>i.target.id),s1b.items.map(i=>i.target.id));
  });

  await t.test('anonymous work_request.create succeeds and surfaces via kb_attention; anonymous update is FORBIDDEN',async()=>{
   const cmd={title:'SYNTHETIC anonymous request',description:'SYNTHETIC description',target:null,suggested_query:null};
   const wr=(await rpc(a,'kb_create_work_request',{p_context:ctx(anon,'work_request.create',cmd),p_command:cmd})).data;
   assert.equal(wr.created_by,null);assert.equal(wr.status,'open');
   const seen=await rpc(a,'kb_attention',{p_query:{reasons:['requested'],limit:50}});
   assert.ok(seen.items.some(i=>i.target.id===wr.id&&i.reason==='requested'));

   const upd={work_request_id:wr.id,expected_revision:1,action:'claim',reason:'SYNTHETIC claim',resolution_refs:[]};
   await assert.rejects(rpc(a,'kb_update_work_request',{p_context:ctx(anon,'work_request.update:'+wr.id,upd),p_command:upd}),code('FORBIDDEN'));
  });

  await t.test('provenance recorded only when agent is declared; replay with a different agent still replays',async()=>{
   const input=record('SYNTHETIC provenance body'),key=randomUUID();
   const withAgent=ctx(anon,'record.create',input,{model:'test-model-x'});withAgent.idempotency_key=key;
   const first=await rpc(a,'kb_create_record',{p_context:withAgent,p_command:input});
   const vid=first.data.version.id;
   const provRows=(await admin.query('select declared from knowledge.provenance where result_kind=$1 and result_id=$2',['version',vid])).rows;
   assert.equal(provRows.length,1);assert.equal(provRows[0].declared.model,'test-model-x');

   const noAgentInput=record('SYNTHETIC no provenance body');
   const withoutAgent=ctx(anon,'record.create',noAgentInput);
   const second=await rpc(a,'kb_create_record',{p_context:withoutAgent,p_command:noAgentInput});
   const provRows2=(await admin.query('select declared from knowledge.provenance where result_kind=$1 and result_id=$2',['version',second.data.version.id])).rows;
   assert.equal(provRows2.length,0);

   const replayCtx=ctx(anon,'record.create',input,{model:'different-model'});replayCtx.idempotency_key=key;
   const replay=await rpc(b,'kb_create_record',{p_context:replayCtx,p_command:input});
   assert.equal(replay.replayed,true);assert.equal(replay.data.version.id,vid);
  });
 });
}
