import 'server-only';
import type {DeclaredAgent} from '../../contracts/types.js';
import {DomainError,ensure,fail} from '../../domain/errors.js';
import {validateScalar} from '../../domain/text.js';
import {validateIdempotencyKey} from '../../domain/idempotency.js';

/** Transport status is separate from domain validation (422). */
export class HttpError extends DomainError {
 constructor(code: 'VALIDATION_FAILED'|'INVALID_JSON'|'PAYLOAD_TOO_LARGE'|'RATE_LIMITED', readonly httpStatus: number, readonly retryAfter?: number) { super(code); }
}
function malformed(): never { throw new HttpError('INVALID_JSON',400); }
/** JSON.parse plus a structural pass: rejects duplicate decoded keys and pathological nesting. */
export function parseJson(text: string): unknown {
 let at=0,nodes=0;
 const ws=()=>{while(/[\x20\t\r\n]/.test(text[at]??'!'))at++;};
 const string=():string=>{
  if(text[at]!== '"')malformed();const start=at++;
  while(at<text.length){const c=text[at++];if(c==='\\'){at++;continue;}if(c==='"'){
   try{return JSON.parse(text.slice(start,at)) as string;}catch{malformed();}
  }}return malformed();
 };
 const visit=(depth:number):void=>{
  if(depth>32||++nodes>100000)throw new HttpError('PAYLOAD_TOO_LARGE',413);
  ws();const c=text[at];
  if(c==='"'){string();return;}
  if(c==='{'){
   at++;ws();const seen=new Set<string>();if(text[at]==='}'){at++;return;}
   for(;;){ws();const key=string();if(seen.has(key))malformed();seen.add(key);ws();if(text[at++]!==':')malformed();visit(depth+1);ws();const sep=text[at++];if(sep==='}')return;if(sep!==',')malformed();}
  }
  if(c==='['){at++;ws();if(text[at]===']'){at++;return;}for(;;){visit(depth+1);ws();const sep=text[at++];if(sep===']')return;if(sep!==',')malformed();}}
  const m=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at));if(!m)malformed();at+=m[0].length;
 };
 try{visit(0);ws();if(at!==text.length)malformed();return JSON.parse(text);}catch(e){if(e instanceof DomainError)throw e;return malformed();}
}
async function readUtf8(request:Request,maxBytes=1048576):Promise<string>{
 const encoding=request.headers.get('content-encoding');if(encoding&&encoding.toLowerCase()!=='identity')throw new HttpError('VALIDATION_FAILED',415);
 const length=request.headers.get('content-length');if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>maxBytes))throw new HttpError('PAYLOAD_TOO_LARGE',413);
 const reader=request.body?.getReader();if(!reader)malformed();const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw new HttpError('PAYLOAD_TOO_LARGE',413);}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let p=0;for(const chunk of chunks){bytes.set(chunk,p);p+=chunk.length;}
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{malformed();}
 // A UTF-8 BOM is not silently removed; all API clients send ordinary UTF-8 JSON.
 return text;
}
function contentType(request:Request):string { return request.headers.get('content-type')??''; }
export async function readJson(request:Request,maxBytes=1048576):Promise<unknown>{
 if(!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType(request)))throw new HttpError('VALIDATION_FAILED',415);
 return parseJson(await readUtf8(request,maxBytes));
}
export async function readRecordBody(request:Request):Promise<unknown>{
 if(/^text\/plain(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType(request)))return {body_text:await readUtf8(request)};
 return readJson(request);
}
/** Shared by every write handler: same idempotency-key header parsing as before the registry split. */
export function readIdempotencyKey(request:Request):string{return validateIdempotencyKey(request.headers.get('idempotency-key'));}
export function queryParams(url:URL,allowed:readonly string[]):Record<string,string>{
 const result:Record<string,string>=Object.create(null);
 for(const [key,value] of url.searchParams){if(!allowed.includes(key)||Object.hasOwn(result,key))throw new HttpError('VALIDATION_FAILED',400);validateScalar(value);result[key]=value;}
 return result;
}
export function intQuery(value:string|undefined,min:number,max:number,fallback?:number):number{
 if(value===undefined){if(fallback===undefined)throw new HttpError('VALIDATION_FAILED',400);return fallback;}
 if(!/^(0|[1-9][0-9]*)$/.test(value))throw new HttpError('VALIDATION_FAILED',400);
 const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new HttpError('VALIDATION_FAILED',400);return n;
}
export async function boundedResponseJson(response:Response,maximum=1048576):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)fail('DEPENDENCY_UNAVAILABLE');let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>maximum){await reader.cancel();fail('DEPENDENCY_UNAVAILABLE');}chunks.push(value);}}finally{reader.releaseLock();}
 const all=new Uint8Array(total);let at=0;for(const c of chunks){all.set(c,at);at+=c.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}catch{fail('DEPENDENCY_UNAVAILABLE');}
}
const DECLARED_FIELDS=['model','harness','operator'] as const;
/** Self-reported provenance only. Any malformed input is ignored wholesale, never a 4xx. */
export function parseDeclaredAgent(value:string|null|undefined):DeclaredAgent|undefined{
 if(!value)return undefined;
 const parts=value.split(/[;,]/).map(part=>part.trim()).filter(part=>part.length>0);
 if(parts.length===0)return undefined;
 const result:DeclaredAgent={};
 for(const part of parts){
  const m=/^(model|harness|operator)\s*=\s*(?:"([^"]*)"|([^"]*))$/.exec(part);
  if(!m)return undefined;
  const field=m[1] as typeof DECLARED_FIELDS[number];
  const raw=(m[2]??m[3]??'').trim();
  if(raw.length===0||raw.length>80)return undefined;
  if(!/^[\x20-\x7e]+$/.test(raw))return undefined; // printable ASCII only
  if(Object.hasOwn(result,field))return undefined;
  result[field]=raw;
 }
 return Object.keys(result).length>0?result:undefined;
}
export function validOrigin(value:string|undefined):string{
 if(!value)fail('NOT_CONFIGURED');let u:URL;try{u=new URL(value);}catch{fail('NOT_CONFIGURED');}
 ensure((u.protocol==='https:'||(['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.protocol==='http:'))&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/','NOT_CONFIGURED');return u.origin;
}
