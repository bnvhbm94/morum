import 'server-only';
import type * as T from '../../contracts/types.js';
import type {RpcClient,SearchReadPort} from '../../domain/ports.js';
import {object,text,integer,uuid,ref,CONTENT} from '../../domain/validation.js';
import {ensure} from '../../domain/errors.js';
import {CursorCodec} from '../db/cursor.js';
import {Embeddings,PROFILE} from './embeddings.js';
import {checkedRpc,checkSearchCounts,checkSearchPage,checkContextPage} from './rpc-shapes.js';
interface ContextResult extends Omit<T.ContextPage,'continuation'> {snapshot_id:string;scan_index:number;has_more:boolean;snapshot_at:string;snapshot_expires_at:string;}
/** Only DTO transformations here; ranking and visibility remain on the same database snapshot. */
export class Retrieval implements SearchReadPort {
 constructor(private readonly db:RpcClient,private readonly cursors:CursorCodec,private readonly embeddings:Embeddings){}
 validate(input:unknown):T.SearchRequest{
  const q=object(input,['query','scope','limit','cursor','include_context','filters'],['query','scope']);text(q.query,1000);ensure(q.scope==='current'||q.scope==='all_versions');
  if(q.limit!==undefined)integer(q.limit,1,20);if(q.cursor!==undefined&&q.cursor!==null)text(q.cursor,4096);
  if(q.include_context!==undefined)ensure(typeof q.include_context==='boolean');
  if(q.filters!==undefined){const f=object(q.filters,['synthetic_demo','record_id']);if(f.synthetic_demo!==undefined)ensure(typeof f.synthetic_demo==='boolean');if(f.record_id!==undefined)uuid(f.record_id);}
  return q as unknown as T.SearchRequest;
 }
 async search(input:T.SearchRequest):Promise<T.SearchResponse>{
  const q=this.validate(input);const binding={query:q.query,scope:q.scope,filters:q.filters??{},include_context:q.include_context??true};
  const sql:Record<string,unknown>={query:q.query,scope:q.scope,filters:q.filters??{},limit:q.limit??10};
  let status:T.SearchStatus={mode:'keyword_only',query_embedding:'not_attempted',reason:this.embeddings.availability(),profile_id:null,indexed_units:0,eligible_units:0,quality_gate:'not_evaluated',result_state:'no_match'};
  if(q.cursor){
   const c=this.cursors.decode(q.cursor,'search-v2',binding);uuid(c.snapshot_id);integer(c.scan_index,0,100);ensure(c.profile_id===null||c.profile_id===PROFILE,'CURSOR_INVALID');
   sql._snapshot_id=c.snapshot_id;sql._scan_index=c.scan_index;sql._profile_id=c.profile_id;
  }else{
   const available=this.embeddings.availability()===null;sql._profile_id=available?PROFILE:null;
   // kb_search recounts eligible/indexed units itself; the pre-count only decides whether to embed the query.
   if(available){
    const counts=checkedRpc<{eligible_units:number;indexed_units:number;profile_compatible?:boolean}>(await this.db.call('kb_search_state',{p_query:sql}),value=>checkSearchCounts(value,available));
    status={...status,eligible_units:counts.eligible_units,indexed_units:counts.indexed_units,profile_id:PROFILE};
    if(!counts.profile_compatible)status.reason='profile_mismatch';
    else if(counts.indexed_units>0){const e=await this.embeddings.embed(q.query);sql._vector=e.vector;status={...status,query_embedding:e.vector?'ready':e.attempted?'failed':'not_attempted',reason:e.reason};}
    else if(counts.eligible_units>0)status.reason='index_pending';
   }
   sql._status=status;
  }
  const page=checkedRpc<T.RetrievalPage>(await this.db.call('kb_search',{p_query:sql}),checkSearchPage);
  ensure(Array.isArray(page.candidates)&&page.candidates.length<=20&&typeof page.has_more==='boolean','DEPENDENCY_UNAVAILABLE');uuid(page.snapshot_id);integer(page.scan_index,0,100);
  const hits:T.SearchHit[]=page.candidates.map(c=>({unit_id:c.unit_id,record_id:c.record_id,version_id:c.version_id,locator:c.locator,snippet:c.snippet,snippet_truncated:c.snippet_truncated??false,title:c.title,is_current:c.is_current,synthetic_demo:c.synthetic_demo,ranks:{lexical:c.lexical_rank,semantic:c.semantic_rank},rrf_score:(c.lexical_rank?1/(60+c.lexical_rank):0)+(c.semantic_rank?1/(60+c.semantic_rank):0),review_summary:c.review_summary,links:{version:c.version_id?`/api/v2/versions/${c.version_id}`:null,part:c.locator.kind==='body'?`/api/v2/versions/${c.locator.version_id}/part?start=${c.locator.start}&end=${c.locator.end}`:`/api/v2/objects/${c.target.kind}/${c.target.id}`,source:c.target.kind==='source'?`/api/v2/sources/${c.target.id}`:null}}));
  const next=page.has_more?this.cursors.encode('search-v2',binding,{snapshot_id:page.snapshot_id,scan_index:page.scan_index,profile_id:sql._profile_id??null},page.snapshot_expires_at):null;
  const targets=[...new Map(page.candidates.map(c=>[`${c.target.kind}:${c.target.id}`,c.target])).values()];
  const requested=q.include_context??true,seeds=requested?targets.slice(0,5):[];
  const context=seeds.length?await this.context(seeds,1):null;
  const context_coverage={requested,unique_targets:targets.length,expanded_targets:seeds.length,omitted_targets:targets.slice(seeds.length)};
  return {hits,status:page.stored_status,context,context_coverage,page:{snapshot_at:page.snapshot_at,snapshot_expires_at:page.snapshot_expires_at,next_cursor:next,truncated:page.truncated},suggested_work_request:null};
 }
 getContext(target:T.ContentRef,depth:1|2=1,cursor?:string):Promise<T.ContextBundle>{return this.context([target],depth,cursor);}
 async context(seeds:T.ContentRef[],depth:1|2=1,cursor?:string):Promise<T.ContextPage>{
  ensure(seeds.length>=1&&seeds.length<=5);for(const target of seeds)ref(target,CONTENT);ensure(depth===1||depth===2);
  const binding={seeds,depth};const sql:Record<string,unknown>={...binding};
  if(cursor){const c=this.cursors.decode(cursor,'context-v2',binding);uuid(c.snapshot_id);integer(c.scan_index,0,200);sql._snapshot_id=c.snapshot_id;sql._scan_index=c.scan_index;}
  const p=checkedRpc<ContextResult>(await this.db.call('kb_context',{p_query:sql}),checkContextPage);ensure(Array.isArray(p.items)&&p.items.length<=20&&typeof p.has_more==='boolean','DEPENDENCY_UNAVAILABLE');uuid(p.snapshot_id);integer(p.scan_index,0,200);
  return {items:p.items,relations:p.relations,seeds,truncated:p.truncated,omitted_count:p.omitted_count,continuation:p.has_more?this.cursors.encode('context-v2',binding,{snapshot_id:p.snapshot_id,scan_index:p.scan_index},p.snapshot_expires_at):null};
 }
}
