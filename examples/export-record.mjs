/** Public, bounded NDJSON export. Not a full database backup or graph closure. */
import {open} from 'node:fs/promises';
const [base,recordId,destination]=process.argv.slice(2);let file;
try{
 if(!base||!destination||!/^[0-9a-f-]{36}$/i.test(recordId??''))throw Error('Usage: node examples/export-record.mjs ORIGIN RECORD_UUID NEW_FILE.ndjson');
 const origin=new URL(base);if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!(origin.protocol==='https:'||origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))throw Error('Invalid trusted origin');
 file=await open(destination,'wx',0o600);let bytes=0,pages=0;
 const emit=async value=>{const text=JSON.stringify(value)+'\n';bytes+=Buffer.byteLength(text);if(bytes>33554432)throw Error('Export exceeded 32 MiB; output is incomplete.');await file.write(text);};
 const get=async path=>{if(++pages>200)throw Error('Export exceeded 200 requests; output is incomplete.');const response=await fetch(new URL(path,origin),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`API status ${response.status}`);const reader=response.body.getReader(),chunks=[];let n=0;try{while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>1048576){await reader.cancel();throw Error('API response too large');}chunks.push(r.value);}}finally{reader.releaseLock();}const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(value.meta?.contract_version!=='2.0.0')throw Error('Contract mismatch');return value.data;};
 await emit({type:'export_header',contract_version:'2.0.0',record_id:recordId,origin:origin.origin,at:new Date().toISOString(),scope:'visible record versions and their direct version-level relations, annotations, evidence and review histories; linked object/source IDs remain pointers',not_database_backup:true});
 let cursor=null;let truncated=false;
 do{const list=await get(`/api/v2/records/${recordId}/versions?limit=10${cursor?'&cursor='+encodeURIComponent(cursor):''}`);truncated||=list.page.truncated;
  for(const version of list.items){await emit({type:'version',value:version});for(const kind of ['annotations','relations','evidence','reviews']){let next=null;do{const query=new URLSearchParams(kind==='annotations'?{version_id:version.id}:{target_kind:'version',target_id:version.id});query.set('limit','10');if(next)query.set('cursor',next);const p=await get(`/api/v2/${kind}?${query}`);truncated||=p.page.truncated;for(const value of p.items)await emit({type:kind,value});next=p.page.next_cursor;}while(next);}}
  cursor=list.page.next_cursor;
 }while(cursor);
 await emit({type:'export_footer',completed_within_declared_scope:true,source_truncation_observed:truncated,requests:pages,graph_closure:false});await file.sync();console.log(JSON.stringify({status:'completed_bounded_public_export',file:destination,source_truncation_observed:truncated,not_database_backup:true}));
}catch(error){console.error(JSON.stringify({status:'failed_or_incomplete',message:typeof error.message==='string'?error.message:'Export failed'}));process.exitCode=1;}finally{await file?.close();}
