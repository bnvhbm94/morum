import 'server-only';
import type {SemanticReason,DrainResult} from '../../contracts/types.js';
import type {RpcClient} from '../../domain/ports.js';
import {ensure,fail} from '../../domain/errors.js';
import {object,integer} from '../../domain/validation.js';
import {boundedResponseJson} from './transport.js';
import type {AgentContext} from './auth.js';
import {RateLimiter} from './rate-limit.js';
import {checkedRpc,checkClaimedJobs,checkFinishedJob} from './rpc-shapes.js';
export const PROFILE='openai-te3s-1536-v1';
export interface EmbeddingConfig {provider:'disabled'|'openai';apiKey?:string;budgetApproved:boolean;dataSharingApproved:boolean;dailyTokenCap:number;requestTokenCap:number;timeoutMs:number;}
export function embeddingConfig(env:NodeJS.ProcessEnv=process.env):EmbeddingConfig{
 const provider=env.EMBEDDING_PROVIDER??'disabled';ensure(provider==='disabled'||provider==='openai','NOT_CONFIGURED');
 const number=(name:string,fallback:number)=>{const raw=env[name];if(raw===undefined)return fallback;ensure(/^[0-9]+$/.test(raw),'NOT_CONFIGURED');const n=Number(raw);ensure(Number.isSafeInteger(n)&&n>=0&&n<=1000000000,'NOT_CONFIGURED');return n;};
 return {provider,apiKey:env.OPENAI_API_KEY,budgetApproved:env.BUDGET_APPROVED==='true',dataSharingApproved:env.EMBEDDING_DATA_SHARING_APPROVED==='true',dailyTokenCap:number('EMBEDDING_DAILY_TOKEN_CAP',0),requestTokenCap:number('EMBEDDING_REQUEST_TOKEN_CAP',0),timeoutMs:Math.min(15000,Math.max(1000,number('EMBEDDING_TIMEOUT_MS',7000)))};
}
export function normalizeEmbeddingText(raw:string):string{return raw.replace(/\r\n?/g,'\n').normalize('NFC').trim();}
export function normalizeVector(value:unknown):number[]{
 ensure(Array.isArray(value)&&value.length===1536,'DEPENDENCY_UNAVAILABLE');let norm=0;
 for(const x of value){ensure(typeof x==='number'&&Number.isFinite(x),'DEPENDENCY_UNAVAILABLE');norm+=x*x;}
 ensure(Number.isFinite(norm)&&norm>0,'DEPENDENCY_UNAVAILABLE');const scale=Math.sqrt(norm);return value.map(x=>x/scale);
}
export interface EmbeddingAttempt {vector:number[]|null;reason:SemanticReason;attempted:boolean;}
/** No provider call unless BOTH budget and data-sharing gates pass. Test injection does not imply a live provider passed. */
export class Embeddings {
 constructor(private readonly config:EmbeddingConfig,private readonly rates:RateLimiter,private readonly transport:typeof fetch=fetch){}
 availability():SemanticReason{
  if(this.config.provider==='disabled')return 'disabled';
  if(!this.config.budgetApproved||!this.config.dataSharingApproved)return 'budget_not_approved';
  if(!this.config.apiKey||this.config.dailyTokenCap<1||this.config.requestTokenCap<1)return 'missing_configuration';
  return null;
 }
 async embed(raw:string):Promise<EmbeddingAttempt>{
  const off=this.availability();if(off)return {vector:null,reason:off,attempted:false};
  const input=normalizeEmbeddingText(raw);const upperBound=Buffer.byteLength(input,'utf8');
  // Conservative byte bound avoids unapproved tokenizer dependencies and underestimated spend.
  if(upperBound===0)return {vector:null,reason:'empty_input',attempted:false};
  // Neither a request nor a whole daily allowance can ever fit this input. Midnight cannot fix it.
  if(upperBound>Math.min(8192,this.config.requestTokenCap,this.config.dailyTokenCap))return {vector:null,reason:'input_too_large',attempted:false};
  const reservation=await this.rates.reserve(`embedding:${PROFILE}:daily`,this.config.dailyTokenCap,86400,upperBound);
  if(!reservation.allowed)return {vector:null,reason:'budget_exhausted',attempted:false};
  // Reservation is NEVER refunded on timeout: the provider may have processed the request.
  const signal=AbortSignal.timeout(this.config.timeoutMs);
  try{
   const response=await this.transport('https://api.openai.com/v1/embeddings',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${this.config.apiKey}`},body:JSON.stringify({model:'text-embedding-3-small',input,dimensions:1536,encoding_format:'float'}),redirect:'error',cache:'no-store',signal});
   if(!response.ok){await response.body?.cancel();return {vector:null,reason:'provider_error',attempted:true};}
   const body=object(await boundedResponseJson(response,262144));
   ensure(body.model==='text-embedding-3-small'&&Array.isArray(body.data)&&body.data.length===1,'DEPENDENCY_UNAVAILABLE');
   const first=object(body.data[0]);ensure(first.index===0,'DEPENDENCY_UNAVAILABLE');const usage=object(body.usage);integer(usage.total_tokens,0,8192);
   return {vector:normalizeVector(first.embedding),reason:null,attempted:true};
  }catch{return {vector:null,reason:signal.aborted?'provider_timeout':'provider_error',attempted:true};}
 }
}
interface Job {id:string;unit_id:string;input_sha256:string;lease_token:string;text:string|null;oversized:boolean;}
export class IndexWorker {
 constructor(private readonly db:RpcClient,private readonly embeddings:Embeddings){}
 async drain(actor:AgentContext,limit:number):Promise<DrainResult>{
  integer(limit,1,3);if(this.embeddings.availability())fail('NOT_CONFIGURED');
  const jobs=checkedRpc<Job[]>(await this.db.call('kb_embedding_claim',{p_actor:actor,p_query:{limit,profile_id:PROFILE}}),value=>checkClaimedJobs(value,limit));
  const out:DrainResult={claimed:jobs.length,ready:0,retry:0,dead:0,remaining:0};
  for(const job of jobs){
   let vector:number[]|null=null;let error:string|null=null;
   if(job.oversized||job.text===null)error='input_too_large';
   else if(normalizeEmbeddingText(job.text).length===0)error='empty_input';
   else{const result=await this.embeddings.embed(job.text);vector=result.vector;error=result.reason;}
   if(!vector&&!['budget_exhausted','provider_timeout','provider_error','input_too_large','empty_input'].includes(error??''))error='provider_error';
   const result=checkedRpc<{accepted:boolean;state:string}>(await this.db.call('kb_embedding_finish',{p_actor:actor,p_query:{job_id:job.id,lease_token:job.lease_token,vector,error}}),checkFinishedJob);
   if(result.accepted&&result.state==='ready')out.ready++;else if(result.accepted&&result.state==='dead')out.dead++;else out.retry++;
  }
  const status=await this.db.call<{remaining:number}>('kb_embedding_status',{p_actor:actor});integer(status.remaining,0,2147483647);out.remaining=status.remaining;return out;
 }
}
