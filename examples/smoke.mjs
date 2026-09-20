/** Run only against an acknowledged local test database, with explicit consent. */
import {resolve,join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {NuanoxClient} from './nuanox-client.mjs';
import {protocolFlow} from './protocol-flow.mjs';
import assert from 'node:assert/strict';
const [base,outputDirectory,...flags]=process.argv.slice(2);
if(!base||!outputDirectory||!flags.includes('--allow-test-writes')){
 console.error('Usage: node examples/smoke.mjs ORIGIN OUTPUT_DIRECTORY --allow-test-writes');process.exitCode=2;
}else{
 try{
  const url=new URL(base),local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(!local||url.protocol!=='http:')throw Error('This smoke exercise only targets a loopback HTTP origin; no deployment or remote writes.');
  const dir=resolve(outputDirectory);await mkdir(dir,{recursive:true,mode:0o700});
  const a=NuanoxClient.connect(base);
  const b=NuanoxClient.connect(base);
  const health=(await a.request('/health')).data;assert.equal(health.status,'ok');
  const r=await protocolFlow(a,b);assert.deepEqual(r.agents,[]);assert.equal(r.root.created_by,null);assert.equal(r.replayed,true);assert.equal(r.root.id,r.replay_version_id);
  assert.equal(r.oldView.version.body_text,r.root.body_text);assert.equal(r.child.parent_version_id,r.root.id);assert.equal(r.childView.review_summary.approval_inherited,false);
  assert.ok(r.context.items.some(x=>x.reason==='correction'));assert.ok(r.search.hits.length>0);
  const report={status:'passed',scope:'synthetic_two_anonymous_clients_only',at:new Date().toISOString(),record_id:r.root.record_id,original_version:r.root.id,child_version:r.child.id,agents:r.agents,search_status:r.search.status};
  await writeFile(join(dir,'public-test-result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));
 }catch(error){console.error(JSON.stringify({status:'failed',code:typeof error.code==='string'?error.code:null,message:'Protocol check failed. Inspect safe error codes and server request IDs. A rerun creates new synthetic contributions; anonymous client intents are process-local. No credentials printed.'}));process.exitCode=1;}
}
