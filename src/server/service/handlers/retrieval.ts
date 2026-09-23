import 'server-only';
import type * as T from '../../../contracts/types.js';
import {ensure} from '../../../domain/errors.js';
import {object,integer,text,CONTENT} from '../../../domain/validation.js';
import {queryParams,readJson,intQuery} from '../transport.js';
import {targetQuery} from './shared.js';
import type {Handler} from './index.js';

export const reviewHead:Handler=async ({url,services:s,actor,respond})=>{
 const q=queryParams(url,['target_kind','target_id','focus']);const target=targetQuery(q,['version','anchor','source','relation','annotation','evidence']);ensure(['content','evidence_support','quote_match','meaning'].includes(q.focus));
 return respond(await s.db.call<T.ReviewHead>('kb_review_head',{p_actor:actor,p_query:{target,focus:q.focus}}));
};

export const search:Handler=async ({url,request,services:s,client,respond})=>{
 queryParams(url,[]);const input=s.retrieval.validate(await readJson(request,16384));
 if(!input.cursor&&s.embeddings.availability()===null)await s.rates.require(`semantic-query:${client}`,10,60);
 return respond(await s.retrieval.search(input),false,200,262144);
};

export const context:Handler=async (ctx)=>{
 const {url,request,route,services:s,respond}=ctx;
 if(route.method==='GET'){
  const q=queryParams(url,['target_kind','target_id','depth','cursor']);if(q.cursor!==undefined)text(q.cursor,4096);
  return respond(await s.retrieval.context([targetQuery(q,CONTENT)],intQuery(q.depth,1,2,1) as 1|2,q.cursor),false,200,262144);
 }
 queryParams(url,[]);const q=object(await readJson(request,16384),['seeds','depth','cursor'],['seeds']);ensure(Array.isArray(q.seeds));const depth=q.depth??1;integer(depth,1,2);if(q.cursor!==undefined)text(q.cursor,4096);
 return respond(await s.retrieval.context(q.seeds as T.ContentRef[],depth as 1|2,q.cursor as string|undefined),false,200,262144);
};
