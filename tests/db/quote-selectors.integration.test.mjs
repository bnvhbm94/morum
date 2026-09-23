/** Roadmap 2.1: quote-first selectors. Actual PostgreSQL only. No DB substitute.
 * knowledge.locate_quote/resolve_selector, the quote-resolving anchor.create and
 * version.create edit paths, and the read-only public.kb_locate RPC. */
import test from 'node:test';import assert from 'node:assert/strict';
import {testDatabaseConfig} from '../../scripts/db-test-config.mjs';
const config=testDatabaseConfig();
if(!config)test('Quote-selector PostgreSQL acceptance NOT RUN',{skip:'No acknowledged disposable local PostgreSQL database'},()=>{});
else {
 const {openHarness,record,basis,code}=await import('./stage04-support.mjs');
 const {canonicalSelector}=await import('../../.test-build/domain/text.js');
 const anon={kind:'anonymous'};
 test('Stage08 quote selectors on real PostgreSQL',async t=>{
  const h=await openHarness(config);t.after(()=>h.close());const {admin,a,rpc,mutate}=h;

  await t.test('unique quote resolves to the same range as the position path',async()=>{
   const v=(await mutate(a,'record.create',record('AAA BBB CCC'),anon)).data.version;
   const byQuote=(await mutate(a,'anchor.create',{version_id:v.id,body_sha256:v.body_sha256,selector:{unit:'unicode_code_point',exact:'BBB'}},anon)).data;
   assert.equal(byQuote.selector.start,4);assert.equal(byQuote.selector.end,7);assert.equal(byQuote.selector.exact,'BBB');
   const byPosition=(await mutate(a,'anchor.create',{version_id:v.id,body_sha256:v.body_sha256,selector:canonicalSelector(v.body_text,4,7)},anon)).data;
   assert.equal(byPosition.id,byQuote.id,'the same range on the same version is the same anchor, resolved by quote or by position');
  });

  await t.test('two occurrences is AMBIGUOUS_SELECTOR, then prefix disambiguates',async()=>{
   const v=(await mutate(a,'record.create',record('AAA BBB AAA CCC'),anon)).data.version;
   await assert.rejects(mutate(a,'anchor.create',{version_id:v.id,body_sha256:v.body_sha256,selector:{unit:'unicode_code_point',exact:'AAA'}},anon),code('AMBIGUOUS_SELECTOR'));
   const resolved=(await mutate(a,'anchor.create',{version_id:v.id,body_sha256:v.body_sha256,selector:{unit:'unicode_code_point',exact:'AAA',prefix:'AAA BBB '}},anon)).data;
   assert.equal(resolved.selector.start,8);assert.equal(resolved.selector.end,11);
  });

  await t.test('a quote absent from the body is SELECTOR_NOT_FOUND',async()=>{
   const v=(await mutate(a,'record.create',record('AAA BBB CCC'),anon)).data.version;
   await assert.rejects(mutate(a,'anchor.create',{version_id:v.id,body_sha256:v.body_sha256,selector:{unit:'unicode_code_point',exact:'ZZZ'}},anon),code('SELECTOR_NOT_FOUND'));
  });

  await t.test('an insertion point is located by prefix+suffix with an empty exact',async()=>{
   const v=(await mutate(a,'record.create',record('AAA BBB'),anon)).data.version;
   const cmd={record_id:v.record_id,base_version_id:v.id,base_body_sha256:v.body_sha256,edits:[{exact:'',replacement:'-X-',prefix:'AAA',suffix:' BBB'}],reason:'SYNTHETIC insertion by quote',basis:[basis]};
   const v2=(await mutate(a,'version.create',cmd,anon)).data.version;
   assert.equal(v2.body_text,'AAA-X- BBB');
  });

  await t.test('edits by quote produce the same new body as edits by position, and version_changes stores the resolved range',async()=>{
   const base=(await mutate(a,'record.create',record('cat dog bird'),anon)).data.version;
   const byQuoteCmd={record_id:base.record_id,base_version_id:base.id,base_body_sha256:base.body_sha256,edits:[{exact:'dog',replacement:'wolf'}],reason:'SYNTHETIC edit by quote',basis:[basis]};
   const byQuote=(await mutate(a,'version.create',byQuoteCmd,anon)).data.version;
   const byPositionCmd={record_id:base.record_id,base_version_id:base.id,base_body_sha256:base.body_sha256,edits:[{start:4,end:7,exact:'dog',replacement:'wolf'}],reason:'SYNTHETIC edit by position',basis:[basis]};
   const byPosition=(await mutate(a,'version.create',byPositionCmd,anon)).data.version;
   assert.equal(byQuote.body_text,'cat wolf bird');assert.equal(byQuote.body_text,byPosition.body_text);

   const {rows}=await admin.query('select edits from knowledge.version_changes where version_id=$1',[byQuote.id]);
   assert.equal(rows.length,1);const stored=rows[0].edits;
   assert.deepEqual(stored,[{start:4,end:7,exact:'dog',replacement:'wolf'}]);
  });

  await t.test('the positional path still raises TEXT_MISMATCH on a stale offset (anchor and edit)',async()=>{
   const v=(await mutate(a,'record.create',record('cat dog bird'),anon)).data.version;
   await assert.rejects(mutate(a,'anchor.create',{version_id:v.id,body_sha256:v.body_sha256,selector:{unit:'unicode_code_point',start:0,end:3,exact:'wrong',prefix:'',suffix:''}},anon),code('TEXT_MISMATCH'));
   const staleEdit={record_id:v.record_id,base_version_id:v.id,base_body_sha256:v.body_sha256,edits:[{start:0,end:3,exact:'wrong',replacement:'x'}],reason:'SYNTHETIC stale edit',basis:[basis]};
   await assert.rejects(mutate(a,'version.create',staleEdit,anon),code('TEXT_MISMATCH'));
  });

  await t.test('kb_locate reports unique/ambiguous/not_found and its body_sha256 feeds anchor.create directly',async()=>{
   const v=(await mutate(a,'record.create',record('AAA BBB AAA CCC'),anon)).data.version;
   const ambiguous=await rpc(a,'kb_locate',{p_query:{version_id:v.id,exact:'AAA'}});
   assert.equal(ambiguous.state,'ambiguous');assert.equal(ambiguous.candidates.length,2);assert.equal(ambiguous.truncated,false);assert.equal(ambiguous.body_sha256,v.body_sha256);

   const unique=await rpc(a,'kb_locate',{p_query:{version_id:v.id,exact:'AAA',prefix:'AAA BBB '}});
   assert.equal(unique.state,'unique');assert.equal(unique.candidates.length,1);
   assert.equal(unique.candidates[0].start,8);assert.equal(unique.candidates[0].end,11);

   const notFound=await rpc(a,'kb_locate',{p_query:{version_id:v.id,exact:'ZZZ'}});
   assert.equal(notFound.state,'not_found');assert.deepEqual(notFound.candidates,[]);

   const anchor=(await mutate(a,'anchor.create',{version_id:v.id,body_sha256:unique.body_sha256,selector:{unit:'unicode_code_point',start:unique.candidates[0].start,end:unique.candidates[0].end,exact:'AAA',prefix:'',suffix:''}},anon)).data;
   assert.equal(anchor.selector.start,8);assert.equal(anchor.selector.end,11);
  });

  await t.test('kb_locate on a hidden version is NOT_FOUND',async()=>{
   const v=(await mutate(a,'record.create',record('SYNTHETIC hidden version body'),anon)).data.version;
   await admin.query('begin');
   try{await admin.query("select set_config('knowledge.moderation','on',true)");await admin.query("update knowledge.versions set visibility='hidden' where id=$1",[v.id]);await admin.query('commit');}
   catch(e){await admin.query('rollback');throw e;}
   await assert.rejects(rpc(a,'kb_locate',{p_query:{version_id:v.id,exact:'hidden'}}),code('NOT_FOUND'));
  });

  await t.test('kb_locate truncates at 10 candidates once an 11th occurrence exists',async()=>{
   const v=(await mutate(a,'record.create',record(Array(12).fill('Q').join(' ')),anon)).data.version;
   const result=await rpc(a,'kb_locate',{p_query:{version_id:v.id,exact:'Q'}});
   assert.equal(result.state,'ambiguous');assert.equal(result.candidates.length,10);assert.equal(result.truncated,true);
  });
 });
}
