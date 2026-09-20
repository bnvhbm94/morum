import 'server-only';
import type * as T from '../../contracts/types.js';
import type {CommandMap,CoreReadPort,MutationPort,MutationResult,RpcClient} from '../../domain/ports.js';
import {ensure} from '../../domain/errors.js';
import {validateCommand,normalizeRecordRequest,validateListQuery,uuid,ref,integer,object} from '../../domain/validation.js';
import {assertServerAuthContext} from '../../domain/permissions.js';
import {requestDigest} from '../../domain/idempotency.js';
import {CursorCodec} from './cursor.js';
import {checkedRpc,checkListPage,checkHistoryPage,checkRawText,checkPartPagination} from '../service/rpc-shapes.js';
const writes:Record<keyof CommandMap,string>={
 'record.create':'kb_create_record','version.create':'kb_create_version','anchor.create':'kb_create_anchor',
 'source.create':'kb_create_source','relation.create':'kb_create_relation','annotation.create':'kb_create_annotation',
 'evidence.create':'kb_create_evidence','review.create':'kb_create_review','work_request.create':'kb_create_work_request','work_request.update':'kb_update_work_request'
};
type SnapshotPage<V>={items:{kind:string;value:V}[];snapshot_id:T.UUID;scan_index:number;has_more:boolean;snapshot_at:string;snapshot_expires_at:string;truncated:boolean};
type HistoryPage={items:T.Version[];upper_version_no:number;last_version_no:number|null;has_more:boolean;snapshot_at:string;truncated:boolean};
const id=(value:string)=>{uuid(value);return value.toLowerCase();};
/** Shared real data adapter. No auth/session manufacture, network URL fetching, or search stub. */
export class KnowledgeRepository implements MutationPort,CoreReadPort {
 constructor(private readonly db:RpcClient,private readonly cursors:CursorCodec){}
 async execute<K extends keyof CommandMap>(name:K,context:T.MutationContext,input:CommandMap[K]['input'],pathId?:T.UUID):Promise<MutationResult<CommandMap[K]['output']>>{
  assertServerAuthContext(context.actor);if(name==='record.create')input=normalizeRecordRequest(input) as CommandMap[K]['input'];validateCommand(name,input);
  const path=name==='version.create'?'record_id':name==='work_request.update'?'work_request_id':null;
  if(path)ensure(pathId!==undefined);else ensure(pathId===undefined);
  const operation=path?`${name}:${id(pathId!)}`:name;
  ensure(context.operation===operation&&context.request_hash===requestDigest(input));
  const command=path?{...input,[path]:id(pathId!)}:input;
  return this.db.call(writes[name],{p_context:context,p_command:command});
 }
 getRecord(value:T.UUID):Promise<T.VersionView>{return this.db.call('kb_get_record',{p_query:{id:id(value)}});}
 getVersion(value:T.UUID):Promise<T.VersionView>{return this.db.call('kb_get_version',{p_query:{id:id(value)}});}
 async getRaw(value:T.UUID):Promise<string>{return checkedRpc<string>(await this.db.call('kb_get_raw',{p_query:{id:id(value)}}),checkRawText);}
 getSource(value:T.UUID):Promise<T.Source>{return this.db.call('kb_get_source',{p_query:{id:id(value)}});}
 getObject(target:T.ContentRef):Promise<T.ObjectView>{ref(target,['version','anchor','source','relation','annotation','evidence','review']);return this.db.call('kb_get_object',{p_query:{kind:target.kind,id:id(target.id)}});}
 async listVersions(value:T.UUID,query:T.VersionListQuery={}):Promise<T.Paged<T.Version>>{
  validateListQuery(query);const binding={record_id:id(value)},q:Record<string,unknown>={...binding,limit:query.limit??20};let expires:string|undefined;
  if(query.cursor){const c=this.cursors.decode(query.cursor,'versions',binding);
   integer(c.upper_version_no,0,2147483647);integer(c.last_version_no,1,2147483647);ensure(typeof c.snapshot_at==='string','CURSOR_INVALID');
   q.upper_version_no=c.upper_version_no;q.last_version_no=c.last_version_no;q.snapshot_at=c.snapshot_at;expires=new Date(c.exp).toISOString();
  }
  const page=checkedRpc<HistoryPage>(await this.db.call('kb_list_versions',{p_query:q}),checkHistoryPage);expires??=new Date(Date.parse(page.snapshot_at)+600000).toISOString();
  const next=page.has_more?this.cursors.encode('versions',binding,{upper_version_no:page.upper_version_no,last_version_no:page.last_version_no,snapshot_at:page.snapshot_at},expires):null;
  return {items:page.items,page:{snapshot_at:page.snapshot_at,snapshot_expires_at:expires,next_cursor:next,truncated:page.truncated}};
 }
 listRecords(query:T.ListQuery={}):Promise<T.Paged<T.RecordSummary>>{validateListQuery(query);return this.list('records',{},query);}
 listAnnotations(query:T.AnnotationListQuery):Promise<T.Paged<T.Annotation>>{validateListQuery(query,['version_id']);return this.list('annotations',{version_id:id(query.version_id)},query);}
 listRelations(query:T.LocationTargetListQuery):Promise<T.Paged<T.Relation>>{
  validateListQuery(query,['target_kind','target_id','direction']);ref({kind:query.target_kind,id:query.target_id});
  const direction=query.direction??'both';ensure(['in','out','both'].includes(direction));
  return this.list('relations',{target_kind:query.target_kind,target_id:id(query.target_id),direction},query);
 }
 listEvidence(query:T.EvidenceTargetListQuery):Promise<T.Paged<T.Evidence>>{
  validateListQuery(query,['target_kind','target_id']);ref({kind:query.target_kind,id:query.target_id},['version','anchor','source','relation','annotation','review']);
  return this.list('evidence',{target_kind:query.target_kind,target_id:id(query.target_id)},query);
 }
 listReviews(query:T.ReviewTargetListQuery):Promise<T.Paged<T.Review>>{
  validateListQuery(query,['target_kind','target_id']);ref({kind:query.target_kind,id:query.target_id},['version','anchor','source','relation','annotation','evidence']);
  return this.list('reviews',{target_kind:query.target_kind,target_id:id(query.target_id)},query);
 }
 listWorkRequests(query:T.WorkListQuery={}):Promise<T.Paged<T.WorkRequest>>{
  validateListQuery(query,['status']);if(query.status!==undefined)ensure(['open','in_progress','resolved','closed'].includes(query.status));
  return this.list('work_requests',query.status?{status:query.status}:{},query);
 }
 async getPart(value:T.UUID,query:T.PartQuery):Promise<T.PartView>{
  object(query,['start','end','context_before','context_after','cursor'],['start','end']);integer(query.start,0,100000);integer(query.end,query.start,100000);
  const cb=query.context_before??400,ca=query.context_after??400;integer(cb,0,1000);integer(ca,0,1000);
  if(query.cursor!==undefined&&query.cursor!==null)ensure(typeof query.cursor==='string','CURSOR_INVALID');
  const binding={version_id:id(value),start:query.start,end:query.end,context_before:cb,context_after:ca};
  const q=this.snapshotQuery('part',binding,query.cursor);
  const result=await this.db.call<Omit<T.PartView,'next_cursor'>&{pagination:SnapshotPage<never>}>('kb_get_part',{p_query:q});
  const {pagination,...part}=result;checkedRpc(pagination,checkPartPagination);return {...part,next_cursor:this.snapshotCursor('part',binding,pagination)};
 }
 private snapshotQuery(scope:string,binding:Record<string,unknown>,cursor?:string|null):Record<string,unknown>{
  const q={...binding};if(cursor){const c=this.cursors.decode(cursor,scope,binding);uuid(c.snapshot_id);integer(c.scan_index,0,500);q._snapshot_id=c.snapshot_id;q._scan_index=c.scan_index;}return q;
 }
 private snapshotCursor(scope:string,binding:Record<string,unknown>,page:SnapshotPage<unknown>):string|null{
  return page.has_more?this.cursors.encode(scope,binding,{snapshot_id:page.snapshot_id,scan_index:page.scan_index},page.snapshot_expires_at):null;
 }
 private async list<V>(scope:string,binding:Record<string,unknown>,query:T.ListQuery):Promise<T.Paged<V>>{
  const q={...this.snapshotQuery(scope,binding,query.cursor),limit:query.limit??20};
  const page=checkedRpc<SnapshotPage<V>>(await this.db.call(`kb_list_${scope}`,{p_query:q}),checkListPage);
  return {items:page.items.map(item=>item.value),page:{snapshot_at:page.snapshot_at,snapshot_expires_at:page.snapshot_expires_at,next_cursor:this.snapshotCursor(scope,binding,page),truncated:page.truncated}};
 }
}
