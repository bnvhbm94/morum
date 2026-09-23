import 'server-only';
import type * as T from '../../../contracts/types.js';
import {CONTRACT_VERSION} from '../../../contracts/types.js';
import {ensure,DomainError} from '../../../domain/errors.js';
import {queryParams} from '../transport.js';
import {PROFILE} from '../embeddings.js';
import type {Handler,RespondFn} from './index.js';

export const capabilities:Handler=async ({url,services:s,respond})=>{
 queryParams(url,[]);const state=await s.db.call<T.Health>('kb_health',{});ensure(state?.contract_version===CONTRACT_VERSION&&state.database==='reachable'&&state.status==='ok','NOT_CONFIGURED');
 const available=s.embeddings.availability()===null;
 const result:T.Capabilities={contract_version:CONTRACT_VERSION,authentication:{mode:'open_contribution',human_login:false,owner_claim:false,registration_required:false,credentials_required:false,agent_registration:s.auth.registrationEnabled,anonymous_reviews:'append_only'},content:{default_format:'plain_text',markdown_required:false,raw_text_post:true},search:{semantic_enabled:available,profile_id:available?PROFILE:null,quality_gate:'not_evaluated'},limits:{write_bytes:1048576,body_code_points:100000,search_limit:20},features:['url_report','dossier','attention','work_requests','declared_agent']};
 const response=respond(result);
 // RFC 9727 section 3: the API root discovers the catalog via this Link relation (roadmap 1.6).
 response.headers.set('Link','</.well-known/api-catalog>; rel="api-catalog"');
 return response;
};

/**
 * GET /health only: called directly by http.ts's probe short-circuit, before factory() runs, so an
 * unconfigured database is reported as a friendly 503 rather than a generic dispatch failure. This is
 * why it does not take the standard HandlerContext (there is no Services yet) and is not in HANDLERS.
 */
export async function healthProbe(url:URL,probe:()=>Promise<T.Health>,respond:RespondFn):Promise<Response>{
 queryParams(url,[]);
 try{
  const result=await probe();ensure(result?.database==='reachable','DEPENDENCY_UNAVAILABLE');
  const ready=result.status==='ok'&&result.contract_version===CONTRACT_VERSION;
  return respond({...result,status:ready?'ok':'degraded',contract_version:CONTRACT_VERSION},false,ready?200:503);
 }catch(e){
  return respond({status:'degraded',database:e instanceof DomainError&&e.code==='NOT_CONFIGURED'?'not_configured':'unavailable',contract_version:CONTRACT_VERSION},false,503);
 }
}
