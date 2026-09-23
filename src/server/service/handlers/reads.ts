import 'server-only';
import type * as T from '../../../contracts/types.js';
import {ensure} from '../../../domain/errors.js';
import {object,ref,text,uuid,CONTENT} from '../../../domain/validation.js';
import {sha256} from '../../../domain/hash.js';
import {queryParams,readJson,intQuery} from '../transport.js';
import {SINGLE_OBJECT_MAX_BYTES} from '../../db/client.js';
import {checkedRpc,checkLocate} from '../rpc-shapes.js';
import {targetQuery} from './shared.js';
import type {Handler} from './index.js';

function listQuery(q:Record<string,string>):T.ListQuery{
 if(q.cursor!==undefined)text(q.cursor,4096);return {limit:intQuery(q.limit,1,50,20),...(q.cursor!==undefined?{cursor:q.cursor}:{})};
}

export const listRecords:Handler=async ({url,services:s,respond})=>{const q=queryParams(url,['limit','cursor']);return respond(await s.repo.listRecords(listQuery(q)));};

export const listWorkRequests:Handler=async ({url,services:s,respond})=>{const q=queryParams(url,['status','limit','cursor']);if(q.status!==undefined)ensure(['open','in_progress','resolved','closed'].includes(q.status));return respond(await s.repo.listWorkRequests({...listQuery(q),...(q.status!==undefined?{status:q.status as T.WorkStatus}:{})}));};

export const getRecord:Handler=async ({url,params:p,services:s,respond})=>{queryParams(url,[]);return respond(await s.repo.getRecord(p.record_id),false,200,SINGLE_OBJECT_MAX_BYTES);};

export const listVersions:Handler=async ({url,params:p,services:s,respond})=>{const q=queryParams(url,['limit','cursor']);return respond(await s.repo.listVersions(p.record_id,listQuery(q)));};

export const getVersion:Handler=async ({url,params:p,services:s,respond})=>{queryParams(url,[]);return respond(await s.repo.getVersion(p.version_id),false,200,SINGLE_OBJECT_MAX_BYTES);};

export const getRaw:Handler=async (ctx)=>{
 const {url,params:p,services:s,request,rawResponse}=ctx;
 queryParams(url,[]);const raw=await s.repo.getRaw(p.version_id);ensure(typeof raw==='string','DEPENDENCY_UNAVAILABLE');const tag=`"sha256:${sha256(raw)}"`;
 const h={'content-type':'text/plain; charset=utf-8',etag:tag};
 if(request.headers.get('if-none-match')?.split(',').map(x=>x.trim()).includes(tag))return rawResponse(null,h,304);
 return rawResponse(raw,h);
};

export const getPart:Handler=async ({url,params:p,services:s,respond})=>{
 const q=queryParams(url,['start','end','context_before','context_after','cursor']);if(q.cursor!==undefined)text(q.cursor,4096);const start=intQuery(q.start,0,100000),end=intQuery(q.end,start,Math.min(100000,start+16000));
 return respond(await s.repo.getPart(p.version_id,{start,end,context_before:intQuery(q.context_before,0,1000,400),context_after:intQuery(q.context_after,0,1000,400),cursor:q.cursor}));
};

export const getSource:Handler=async ({url,params:p,services:s,respond})=>{queryParams(url,[]);return respond(await s.repo.getSource(p.source_id));};

export const locate:Handler=async ({url,params:p,request,services:s,respond})=>{
 queryParams(url,[]);uuid(p.version_id);
 const body=object(await readJson(request,16384),['exact','prefix','suffix'],['exact']);
 text(body.exact,100000,0);
 const prefix=body.prefix!==undefined?body.prefix:'',suffix=body.suffix!==undefined?body.suffix:'';
 text(prefix,32,0);text(suffix,32,0);
 const result=checkedRpc<T.LocateResult>(await s.db.call('kb_locate',{p_query:{version_id:p.version_id,exact:body.exact,prefix,suffix}}),checkLocate);
 return respond(result,false,200,262144);
};

export const getObject:Handler=async ({url,params:p,services:s,respond})=>{queryParams(url,[]);ref(p,CONTENT);return respond(await s.repo.getObject(p as T.ContentRef),false,200,SINGLE_OBJECT_MAX_BYTES);};

export const listAnnotations:Handler=async ({url,services:s,respond})=>{const q=queryParams(url,['version_id','limit','cursor']);uuid(q.version_id);return respond(await s.repo.listAnnotations({...listQuery(q),version_id:q.version_id}));};

export const listRelations:Handler=async ({url,services:s,respond})=>{const q=queryParams(url,['target_kind','target_id','direction','limit','cursor']);const t=targetQuery(q,['version','anchor','source']);ensure(q.direction===undefined||['in','out','both'].includes(q.direction));return respond(await s.repo.listRelations({...listQuery(q),target_kind:t.kind as T.LocationRef['kind'],target_id:t.id,direction:(q.direction??'both') as 'in'|'out'|'both'}));};

export const listEvidence:Handler=async ({url,services:s,respond})=>{const q=queryParams(url,['target_kind','target_id','limit','cursor']);const t=targetQuery(q,['version','anchor','source','relation','annotation','review']);return respond(await s.repo.listEvidence({...listQuery(q),target_kind:t.kind as T.EvidenceTargetRef['kind'],target_id:t.id}));};

export const listReviews:Handler=async ({url,services:s,respond})=>{const q=queryParams(url,['target_kind','target_id','limit','cursor']);const t=targetQuery(q,['version','anchor','source','relation','annotation','evidence']);return respond(await s.repo.listReviews({...listQuery(q),target_kind:t.kind as T.ReviewTargetRef['kind'],target_id:t.id}));};
