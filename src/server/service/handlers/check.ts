import 'server-only';
import {randomUUID} from 'node:crypto';
import type * as T from '../../../contracts/types.js';
import {validateCheckRequest} from '../../../domain/validation.js';
import {mutate} from '../../../domain/mutate.js';
import {sha256} from '../../../domain/hash.js';
import {readJson,readIdempotencyKey,parseDeclaredAgent,queryParams} from '../transport.js';
import type {Handler} from './index.js';

/** Fallback only: mirrors the first two branches of knowledge.evidence_quote_check (exact
 * substring or not_found). The full six-state check is read back from kb_url_report below
 * whenever the source has a URL; this fallback covers excerpt-only sources and read failures. */
function quoteCheckState(quote:string,excerpt:string):T.QuoteCheckState {
 if(quote.trim().length===0)return 'no_quote';
 if(excerpt.trim().length===0)return 'no_text';
 return excerpt.includes(quote)?'found_exact':'not_found';
}
/** Derives a sub-step idempotency key from the bundle's key. Colons are not in the
 * idempotency-key charset, so the derivation is hashed rather than concatenated raw. */
const subKey=(key:string,part:string):string=>sha256(`${key}:${part}`);
function firstCodePoints(value:string,n:number):string {return Array.from(value).slice(0,n).join('');}

export const check:Handler=async (ctx)=>{
 const {request,url,services:s,contributor,actor,respond,setWriteKey}=ctx;
 queryParams(url,[]);
 const requestKey:string=request.headers.has('idempotency-key')?readIdempotencyKey(request):randomUUID();
 setWriteKey(requestKey);
 const body=validateCheckRequest(await readJson(request));
 const declared=parseDeclaredAgent(request.headers.get('morum-agent'));
 const who=contributor??actor!;

 let recordId:T.UUID,versionId:T.UUID,recordCreated=false,recordReplayed=true;
 if(body.record_id!==null){
  recordId=body.record_id;
  const view=await s.repo.getRecord(recordId);
  versionId=view.version.id;
 }else{
  const recordInput:T.CreateRecordRequest={
   title:body.title??firstCodePoints(body.claim,120),
   body_text:body.claim,body_format:'plain_text',
   attributes:body.attributes,synthetic_demo:false,
   reason:'Recorded via POST /check',basis:[],
  };
  const result=await mutate(s.repo,who,'record.create',recordInput,subKey(requestKey,'record'),undefined,declared);
  recordId=result.data.version.record_id;versionId=result.data.version.id;
  recordCreated=!result.replayed;recordReplayed=result.replayed;
 }

 const sourceInput:T.SourceInput={
  url:body.url,title:null,submitted_text:body.excerpt,
  published_at:body.published_at,retrieved_at:body.retrieved_at,rights_note:null,
  attributes:body.archive_url!==null?{archive_url:body.archive_url}:{},
  synthetic_demo:false,
 };
 const sourceResult=await mutate(s.repo,who,'source.create',sourceInput,subKey(requestKey,'source'),undefined,declared);

 const evidenceInput:T.CreateEvidenceRequest={
  target:{kind:'version',id:versionId},
  basis:{kind:'external',source_id:sourceResult.data.id,quote:body.quote,explanation:body.explanation},
 };
 const evidenceResult=await mutate(s.repo,who,'evidence.create',evidenceInput,subKey(requestKey,'evidence'),undefined,declared);

 // Read the server's own six-state quote check back for this evidence row when the source has a URL.
 let quoteCheck:T.QuoteCheck={state:quoteCheckState(body.quote,body.excerpt),source_id:sourceResult.data.id};
 if(body.url!==null){
  try{
   const report=await s.db.call<T.UrlReport>('kb_url_report',{p_query:{url:body.url}});
   const hit=report?.citations?.find(c=>c.evidence_id===evidenceResult.data.id);
   if(hit)quoteCheck=hit.quote_check;
  }catch{/* keep the fallback */}
 }
 const replayed=recordReplayed&&sourceResult.replayed&&evidenceResult.replayed;
 const data:T.CheckResult={
  record_id:recordId,version_id:versionId,source_id:sourceResult.data.id,evidence_id:evidenceResult.data.id,
  quote_check:quoteCheck,
  created:{record:recordCreated,source:!sourceResult.replayed,evidence:!evidenceResult.replayed},
 };
 return respond(data,replayed,replayed?200:201);
};
