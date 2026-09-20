/** Explicit synthetic protocol exercise; never run automatically in production. */
export async function protocolFlow(a,b,{legacyKeyed=false}={}){
 const first=legacyKeyed?await a.enroll('SYNTHETIC Stage03 agent A','Protocol test contributor, not a certified model identity'):null;
 const second=legacyKeyed?await b.enroll('SYNTHETIC Stage03 agent B','Independent protocol credential'):null;
 const oldSentence='All conditions produce the result.';
 const body=oldSentence+'\n\ubc30\ub97c \ud0c0\uace0 \uc81c\uc8fc\ub3c4\ub85c \uac14\ub2e4.\nThis is a deliberately incorrect synthetic example, not a research claim.';
 const reasoning={kind:'reasoning',explanation:'SYNTHETIC example for checking preservation and evidence boundaries.'};
 const input={title:'SYNTHETIC Stage03 correction exercise',body_text:body,body_format:'plain_text',attributes:{topic:'protocol-test',free_form:{condition:'X only'}},synthetic_demo:true,reason:'Explicit isolated test data',basis:[reasoning]};
 const made=await a.write('/records',input,'flow-record-v1');const root=made.data.version;
 const replay=await a.write('/records',input,'flow-record-v1');
 const source=(await a.write('/sources',{url:null,title:'SYNTHETIC experiment report',submitted_text:'Only condition X produced this result.\r\nNot a real experiment.',published_at:null,retrieved_at:null,rights_note:'Original synthetic test text',attributes:{},synthetic_demo:true},'flow-source')).data;
 const evidence=(await b.write('/evidence',{target:{kind:'version',id:root.id},basis:{kind:'external',source_id:source.id,quote:'Only condition X produced this result.',explanation:'The example source does not establish an unconditional claim.'}},'flow-evidence')).data;
 const start=Array.from(oldSentence+'\n').length;
 const anchor=(await a.write('/anchors',{version_id:root.id,body_sha256:root.body_sha256,selector:{unit:'unicode_code_point',start,end:start+1,exact:'\ubc30',prefix:'',suffix:''}},'flow-anchor')).data;
 const annotation=(await b.write('/annotations',{anchor_id:anchor.id,meaning:'\uc774 \ubb38\uc7a5\uc5d0\uc11c \ubc30\ub294 \uacfc\uc77c\uc774 \uc544\ub2c8\ub77c \uc120\ubc15\uc744 \ub73b\ud55c\ub2e4.',concept_version_id:null,attributes:{},supersedes_annotation_id:null,basis:[reasoning]},'flow-meaning')).data;
 const target={kind:'version',id:root.id};
 const head=legacyKeyed?(await b.request(`/review-head?target_kind=version&target_id=${root.id}&focus=content`,{authenticate:true})).data:null;
 // This flow only creates its first review; a new run reuses the saved null-head intent.
 const review=(await b.write('/reviews',{target,stance:'disagree',focus:'content',explanation:'SYNTHETIC source supports condition X only, not every condition.',previous_review_id:null,basis:[{kind:'internal',source:{kind:'version',id:root.id},explanation:'The target is the exact old version.'}]},'flow-review')).data;
 const child=(await a.write(`/records/${root.record_id}/versions`,{base_version_id:root.id,base_body_sha256:root.body_sha256,edits:[{start:0,end:Array.from(oldSentence).length,exact:oldSentence,replacement:'In the synthetic example, only condition X produced the result.'}],reason:'Limit the claim to the source condition.',basis:[{kind:'external',source_id:source.id,quote:'Only condition X produced this result.',explanation:'Explicit synthetic support for the narrower claim.'}]},'flow-revision')).data.version;
 const correction=(await a.write('/relations',{from:{kind:'version',id:child.id},to:target,predicate:'corrects',explanation:'SYNTHETIC correction; preserves rather than overwrites the old version.',attributes:{},basis:[reasoning]},'flow-corrects')).data;
 const oldView=(await a.request(`/versions/${root.id}`)).data;
 const childView=(await a.request(`/versions/${child.id}`)).data;
 const context=(await a.request(`/context?target_kind=version&target_id=${root.id}&depth=2`)).data;
 const search=(await a.search('\uc81c\uc8fc\ub3c4',{include_context:true,filters:{record_id:root.record_id,synthetic_demo:true}})).data;
 return {agents:legacyKeyed?[first.data.agent.id,second.data.agent.id]:[],root,child,source,anchor,annotation,evidence,review,correction,replayed:replay.meta.replayed,replay_version_id:replay.data.version.id,head,oldView,childView,context,search};
}
