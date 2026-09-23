import 'server-only';
import {randomUUID} from 'node:crypto';
import type * as T from '../../contracts/types.js';
import {CONTRACT_VERSION} from '../../contracts/types.js';
import {ensure,fail,apiFailure,DomainError} from '../../domain/errors.js';
import {object,ref,uuid,integer,text,CONTENT,validateCommand,normalizeRecordRequest} from '../../domain/validation.js';
import type {CommandMap} from '../../domain/ports.js';
import {mutate} from '../../domain/mutate.js';
import {validateIdempotencyKey} from '../../domain/idempotency.js';
import {sha256} from '../../domain/hash.js';
import type {Services} from './factory.js';
import type {AgentContext} from './auth.js';
import {HttpError,readJson,readRecordBody,queryParams,intQuery} from './transport.js';
import {matchRoute,allowedMethods} from './routes.js';
import {PROFILE} from './embeddings.js';
import {SINGLE_OBJECT_MAX_BYTES} from '../db/client.js';
const BASE='/api/v2';
const headers=(id:string):Record<string,string>=>({'cache-control':'no-store','x-content-type-options':'nosniff','x-contract-version':CONTRACT_VERSION,'x-request-id':id,'referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; frame-ancestors 'none'"});
function success(data:unknown,id:string,replayed=false,status=200,maxBytes=1048576):Response{
 ensure(data!==undefined,'INTERNAL_ERROR');const body=JSON.stringify({data,meta:{contract_version:CONTRACT_VERSION,request_id:id,replayed}});
 if(Buffer.byteLength(body)>maxBytes)throw new HttpError('PAYLOAD_TOO_LARGE',413);
 return new Response(body,{status,headers:{...headers(id),'content-type':'application/json; charset=utf-8'}});
}
function listQuery(q:Record<string,string>):T.ListQuery{
 if(q.cursor!==undefined)text(q.cursor,4096);return {limit:intQuery(q.limit,1,50,20),...(q.cursor!==undefined?{cursor:q.cursor}:{})};
}
function targetQuery(q:Record<string,string>,kinds:readonly string[]):T.ContentRef{
 const target={kind:q.target_kind,id:q.target_id};ref(target,kinds);return target as T.ContentRef;
}
function key(request:Request):string{return validateIdempotencyKey(request.headers.get('idempotency-key'));}
export function createHandler(factory:()=>Services,health:()=>Promise<T.Health>=()=>factory().db.call('kb_health',{})){
 return async function handle(request:Request):Promise<Response>{
  const id=randomUUID();let allow:string[]=[];let writeKey:string|undefined;
  try{
   const url=new URL(request.url),method=request.method==='HEAD'?'GET':request.method;
   const version=request.headers.get('x-contract-version');if(version&&!/^2\.[0-9]+\.[0-9]+$/.test(version))throw new HttpError('VALIDATION_FAILED',400);
   if(!url.pathname.startsWith(BASE+'/'))fail('NOT_FOUND');const path=url.pathname.slice(BASE.length);
   let match;try{match=matchRoute(path,method);allow=allowedMethods(path);}catch{throw new HttpError('VALIDATION_FAILED',400);}
   if(!match){if(allow.length)throw new HttpError('VALIDATION_FAILED',405);fail('NOT_FOUND');}
   const [verb,template,authMode]=match.route,p=match.params;
   for(const [name,value]of Object.entries(p))if(name!=='kind')uuid(value);
   const respond=(data:unknown,replayed=false,status=200,max=1048576)=>{const r=success(data,id,replayed,status,max);if(writeKey)r.headers.set('idempotency-key',writeKey);return request.method==='HEAD'?new Response(null,{status:r.status,headers:r.headers}):r;};
   if(template==='/health'){
    queryParams(url,[]);
    try{const result=await health();ensure(result?.database==='reachable','DEPENDENCY_UNAVAILABLE');const ready=result.status==='ok'&&result.contract_version===CONTRACT_VERSION;return respond({...result,status:ready?'ok':'degraded',contract_version:CONTRACT_VERSION},false,ready?200:503);}
    catch(e){return respond({status:'degraded',database:e instanceof DomainError&&e.code==='NOT_CONFIGURED'?'not_configured':'unavailable',contract_version:CONTRACT_VERSION},false,503);}
   }
   const s=factory();const client=s.rates.client(request);
   // Public reads never fetch a session/me endpoint or inspect browser cookies.
   await s.rates.require(`read:${client}`,120,60);
   let actor:AgentContext|undefined;let contributor:T.AuthContext|undefined;
   if(authMode==='agent'||authMode==='operator'){
    actor=await s.auth.authenticate(request,template==='/agents/self/key/revoke');
    if(verb==='POST')await s.rates.require(`write:${actor.actor_id}`,30,60);
   }
   if(authMode==='contribution'){
    if(request.headers.has('authorization'))actor=await s.auth.authenticate(request);
    contributor=actor??{kind:'anonymous'};
    await s.rates.require(actor?`write:${actor.actor_id}`:`write:public:${client}`,30,60);
   }
   if(template==='/capabilities'){
    queryParams(url,[]);const state=await s.db.call<T.Health>('kb_health',{});ensure(state?.contract_version===CONTRACT_VERSION&&state.database==='reachable'&&state.status==='ok','NOT_CONFIGURED');
    const available=s.embeddings.availability()===null;
    const result:T.Capabilities={contract_version:CONTRACT_VERSION,authentication:{mode:'open_contribution',human_login:false,owner_claim:false,registration_required:false,credentials_required:false,agent_registration:s.auth.registrationEnabled,anonymous_reviews:'append_only'},content:{default_format:'plain_text',markdown_required:false,raw_text_post:true},search:{semantic_enabled:available,profile_id:available?PROFILE:null,quality_gate:'not_evaluated'},limits:{write_bytes:1048576,body_code_points:100000,search_limit:20}};
    return respond(result);
   }
   if(template==='/agents/enroll'){
    queryParams(url,[]);const registrationKey=key(request);
    const registration=s.auth.validateEnrollment(request,await readJson(request,16384),registrationKey);
    // An already authenticated agent retrying a lost enrollment response is not a new signup.
    let existing:AgentContext|undefined;
    try{existing=await s.auth.authenticate(request);}catch(error){if(!(error instanceof DomainError&&error.code==='UNAUTHENTICATED'))throw error;}
    if(existing)await s.rates.require(`write:${existing.actor_id}`,30,60);
    else{await s.rates.require(`enroll-client:${client}`,3,3600);await s.rates.require('enroll-global',100,86400);}
    const result=await s.auth.enroll(request,registration,registrationKey);return respond(result.data,result.replayed,result.replayed?200:201);
   }
   if(template==='/agents/self'){queryParams(url,[]);return respond(await s.auth.status(actor!));}
   if(template==='/agents/self/key/revoke'){queryParams(url,[]);object(await readJson(request,1024),[]);key(request);return respond(await s.auth.revoke(actor!));}
   if(template==='/review-head'){
    const q=queryParams(url,['target_kind','target_id','focus']);const target=targetQuery(q,['version','anchor','source','relation','annotation','evidence']);ensure(['content','evidence_support','quote_match','meaning'].includes(q.focus));
    return respond(await s.db.call<T.ReviewHead>('kb_review_head',{p_actor:actor,p_query:{target,focus:q.focus}}));
   }
   if(template==='/search'){
    queryParams(url,[]);const input=s.retrieval.validate(await readJson(request,16384));
    if(!input.cursor&&s.embeddings.availability()===null)await s.rates.require(`semantic-query:${client}`,10,60);
    return respond(await s.retrieval.search(input),false,200,262144);
   }
   if(template==='/context'){
    if(verb==='GET'){
     const q=queryParams(url,['target_kind','target_id','depth','cursor']);if(q.cursor!==undefined)text(q.cursor,4096);
     return respond(await s.retrieval.context([targetQuery(q,CONTENT)],intQuery(q.depth,1,2,1) as 1|2,q.cursor),false,200,262144);
    }
    queryParams(url,[]);const q=object(await readJson(request,16384),['seeds','depth','cursor'],['seeds']);ensure(Array.isArray(q.seeds));const depth=q.depth??1;integer(depth,1,2);if(q.cursor!==undefined)text(q.cursor,4096);
    return respond(await s.retrieval.context(q.seeds as T.ContentRef[],depth as 1|2,q.cursor as string|undefined),false,200,262144);
   }
   if(template.startsWith('/admin/')){
    queryParams(url,[]);const q=await readJson(request,16384);
    if(template==='/admin/index/drain'){const input=object(q,['limit'],['limit']);integer(input.limit,1,3);return respond(await s.worker.drain(actor!,input.limit));}
    if(template==='/admin/maintenance'){object(q,[]);return respond(await s.db.call('kb_maintenance',{p_actor:actor}));}
    if(template==='/admin/moderation'){
     const input=object(q,['target','visibility','reason'],['target','visibility','reason']);ref(input.target,['record',...CONTENT]);ensure(['public','hidden','tombstone'].includes(input.visibility as string));text(input.reason,2000);
     return respond(await s.db.call('kb_moderate',{p_actor:actor,p_query:input}));
    }
    const input=object(q,['agent_id','reason'],['agent_id','reason']);uuid(input.agent_id);text(input.reason,2000);return respond(await s.db.call('kb_suspend_agent',{p_actor:actor,p_query:input}));
   }
   if(verb==='POST'){
    queryParams(url,[]);const name:Record<string,keyof CommandMap>={'/records':'record.create','/records/:record_id/versions':'version.create','/anchors':'anchor.create','/sources':'source.create','/annotations':'annotation.create','/relations':'relation.create','/evidence':'evidence.create','/reviews':'review.create'};
    const op=name[template];ensure(op,'NOT_FOUND');
    const requestKey:string=request.headers.has('idempotency-key')?key(request):randomUUID();writeKey=requestKey;
    const body=op==='record.create'?normalizeRecordRequest(await readRecordBody(request)):await readJson(request);validateCommand(op,body);
    const result=await mutate(s.repo,contributor??actor!,op,body as CommandMap[typeof op]['input'],requestKey,p.record_id);
    return respond(result.data,result.replayed,result.replayed?200:201);
   }
   switch(template){
    case '/records':{const q=queryParams(url,['limit','cursor']);return respond(await s.repo.listRecords(listQuery(q)));}
    case '/records/:record_id':queryParams(url,[]);return respond(await s.repo.getRecord(p.record_id),false,200,SINGLE_OBJECT_MAX_BYTES);
    case '/records/:record_id/versions':{const q=queryParams(url,['limit','cursor']);return respond(await s.repo.listVersions(p.record_id,listQuery(q)));}
    case '/versions/:version_id':queryParams(url,[]);return respond(await s.repo.getVersion(p.version_id),false,200,SINGLE_OBJECT_MAX_BYTES);
    case '/versions/:version_id/raw':{
     queryParams(url,[]);const raw=await s.repo.getRaw(p.version_id);ensure(typeof raw==='string','DEPENDENCY_UNAVAILABLE');const tag=`"sha256:${sha256(raw)}"`;
     const h={...headers(id),'content-type':'text/plain; charset=utf-8',etag:tag};
     if(request.headers.get('if-none-match')?.split(',').map(x=>x.trim()).includes(tag))return new Response(null,{status:304,headers:h});
     return new Response(request.method==='HEAD'?null:raw,{headers:h});
    }
    case '/versions/:version_id/part':{
     const q=queryParams(url,['start','end','context_before','context_after','cursor']);if(q.cursor!==undefined)text(q.cursor,4096);const start=intQuery(q.start,0,100000),end=intQuery(q.end,start,Math.min(100000,start+16000));
     return respond(await s.repo.getPart(p.version_id,{start,end,context_before:intQuery(q.context_before,0,1000,400),context_after:intQuery(q.context_after,0,1000,400),cursor:q.cursor}));
    }
    case '/sources/:source_id':queryParams(url,[]);return respond(await s.repo.getSource(p.source_id));
    case '/objects/:kind/:id':queryParams(url,[]);ref(p,CONTENT);return respond(await s.repo.getObject(p as T.ContentRef),false,200,SINGLE_OBJECT_MAX_BYTES);
    case '/annotations':{const q=queryParams(url,['version_id','limit','cursor']);uuid(q.version_id);return respond(await s.repo.listAnnotations({...listQuery(q),version_id:q.version_id}));}
    case '/relations':{const q=queryParams(url,['target_kind','target_id','direction','limit','cursor']);const t=targetQuery(q,['version','anchor','source']);ensure(q.direction===undefined||['in','out','both'].includes(q.direction));return respond(await s.repo.listRelations({...listQuery(q),target_kind:t.kind as T.LocationRef['kind'],target_id:t.id,direction:(q.direction??'both') as 'in'|'out'|'both'}));}
    case '/evidence':{const q=queryParams(url,['target_kind','target_id','limit','cursor']);const t=targetQuery(q,['version','anchor','source','relation','annotation','review']);return respond(await s.repo.listEvidence({...listQuery(q),target_kind:t.kind as T.EvidenceTargetRef['kind'],target_id:t.id}));}
    case '/reviews':{const q=queryParams(url,['target_kind','target_id','limit','cursor']);const t=targetQuery(q,['version','anchor','source','relation','annotation','evidence']);return respond(await s.repo.listReviews({...listQuery(q),target_kind:t.kind as T.ReviewTargetRef['kind'],target_id:t.id}));}
    default:fail('NOT_FOUND');
   }
  }catch(error){
   const failure=apiFailure(error,id);const status=error instanceof HttpError?error.httpStatus:error instanceof DomainError?error.status:500;
   const extra:Record<string,string>=writeKey?{'idempotency-key':writeKey}:{};if(error instanceof HttpError&&error.retryAfter)extra['retry-after']=String(error.retryAfter);if(status===405)extra.allow=allow.join(', ');
   return new Response(request.method==='HEAD'?null:JSON.stringify(failure),{status,headers:{...headers(id),...extra,'content-type':'application/json; charset=utf-8'}});
  }
 };
}
