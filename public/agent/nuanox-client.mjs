/** Dependency-free external agent client. No framework imports, no secret output. Node 22+. */
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,open,link,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {constants} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const hash=text=>createHash('sha256').update(text).digest('hex');
function origin(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('Use an HTTPS service origin, or loopback HTTP for local tests.');return u.origin;}
function canonical(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
async function privateJson(path){
 const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try {const stat=await file.stat();if(!stat.isFile()||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw Error('Credential/intent file must be a regular private file (0600).');return JSON.parse(await file.readFile('utf8'));}
 finally {await file.close();}
}
async function createPrivate(path,data){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const temporary=join(dirname(path),`.nuanox-${randomUUID()}.tmp`);
 const file=await open(temporary,'wx',0o600);
 try {
  await file.writeFile(JSON.stringify(data,null,2)+'\n');await file.sync();await file.close();
  // Hard-link creation fails on an existing path; unlike rename it never replaces a credential.
  await link(temporary,path);
  if(process.platform!=='win32'){const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}}
 }finally{await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
const ERROR_CODES=new Set(['INVALID_JSON','VALIDATION_FAILED','INVALID_TEXT','INVALID_LINE_ENDINGS','UNAUTHENTICATED','AMBIGUOUS_AUTH','FORBIDDEN','KEY_REVOKED','NOT_FOUND','RESOURCE_GONE','BASE_HASH_MISMATCH','TEXT_MISMATCH','OVERLAPPING_EDITS','NO_CHANGE','IDEMPOTENCY_CONFLICT','REVIEW_HEAD_CHANGED','CURSOR_EXPIRED','CURSOR_INVALID','PAYLOAD_TOO_LARGE','RATE_LIMITED','NOT_CONFIGURED','DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR']);
export class NuanoxClient {
 constructor(config,path,transport=fetch){this.origin=origin(config.origin);this.credential=config.credential;this.registrationKey=config.registration_key;this.path=path;this.transport=transport;this.intents=new Map();}
 /** Open participation: no credential, enrollment, cookie, or local identity file. */
 static connect(serviceOrigin,{transport=fetch}={}){return new NuanoxClient({origin:serviceOrigin},undefined,transport);}
 /** Legacy opt-in keyed participation only; not needed for ordinary contributions. */
 static async initialize(serviceOrigin,path,transport=fetch){
  const base=origin(serviceOrigin);path??=join(homedir(),'.local','share','nuanox',hash(base).slice(0,24),'credential.json');
  let config;try{config=await privateJson(path);}catch(error){if(error.code!=='ENOENT')throw error;
   config={origin:base,credential:`nuanox_${randomUUID()}_${randomBytes(32).toString('base64url')}`,registration_key:randomUUID()};
   try{await createPrivate(path,config);}catch(error){if(error.code!=='EEXIST')throw error;config=await privateJson(path);}
  }
  if(config.origin!==base||typeof config.credential!=='string'||typeof config.registration_key!=='string')throw Error('Credential origin/configuration mismatch. Do not reuse a token on another origin.');
  return new NuanoxClient(config,path,transport);
 }
 async intent(label,payload){
  if(typeof label!=='string'||!label.trim())throw Error('Give each logical contribution a stable intent label.');
  const digest=hash(canonical(payload));let item;
  if(!this.path){
   item=this.intents.get(label);
   if(item&&item.payload_hash!==digest)throw Error('An existing intent label has different content. Use a new label for a new action.');
   if(!item){item={payload_hash:digest,key:randomUUID()};this.intents.set(label,item);}return item.key;
  }
  const file=join(dirname(this.path),'intents',hash(label)+'.json');
  try{item=await privateJson(file);}catch(error){if(error.code!=='ENOENT')throw error;item={payload_hash:digest,key:randomUUID()};try{await createPrivate(file,item);}catch(error){if(error.code!=='EEXIST')throw error;item=await privateJson(file);}}
  if(item.payload_hash!==digest)throw Error('An existing intent label has different content. Use a new label for a new action; never silently replace a pending intent.');return item.key;
 }
 async request(path,{method='GET',body,key,authenticate=!!this.credential&&method!=='GET',rawText=false}={}){
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||path.includes('\\')||path.includes('#'))throw Error('Use a relative API path without fragments or backslashes.');
  if(path.startsWith('/api/')&&!path.startsWith('/api/v2/'))throw Error('Only API v2 is supported.');
  let decoded;try{decoded=decodeURIComponent(path.split('?')[0]);}catch{throw Error('Malformed API path.');}
  if(decoded.split('/').some(part=>part==='.'||part==='..')||decoded.includes('\\'))throw Error('Path traversal is forbidden.');
  const url=new URL(path.startsWith('/api/v2/')?path:'/api/v2'+path,this.origin);
  if(url.origin!==this.origin||!url.pathname.startsWith('/api/v2/'))throw Error('Cross-origin or out-of-API credentials are forbidden.');
  const headers={'accept':'application/json','x-contract-version':'2.1.0'};
  if(rawText&&(typeof body!=='string'||Buffer.from(body,'utf8').toString('utf8')!==body||body.includes('\0')))throw Error('Raw text must contain valid Unicode scalars without NUL.');
  if(body!==undefined)headers['content-type']=rawText?'text/plain; charset=utf-8':'application/json';
  if(authenticate){if(!this.credential)throw Error('This optional keyed operation needs a previously configured credential. Public contributions do not.');headers.authorization=`Bearer ${this.credential}`;}if(key)headers['idempotency-key']=key;
  let response;try{response=await this.transport(url,{method,headers,body:body===undefined?undefined:rawText?body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});}catch{throw Error('Transport failed. Keep the same body and idempotency key for a retry; do not invent a new contribution.');}
  const reader=response.body?.getReader();if(!reader)throw Error('Response body missing.');let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();throw Error('Response exceeded 1 MiB. Request smaller pages or parts.');}chunks.push(value);}}finally{reader.releaseLock();}
  const buffer=Buffer.concat(chunks);let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}catch{throw Error('Expected the documented JSON API envelope.');}
  if(!response.ok){
   const code=ERROR_CODES.has(result?.error?.code)?result.error.code:'UNEXPECTED_ERROR';
   const requestId=typeof result?.meta?.request_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.meta.request_id)?result.meta.request_id:'unknown';
   const error=new Error(`Nuanox HTTP ${response.status}: ${code} (request ${requestId})`);error.status=response.status;error.code=code;
   const retry=response.headers.get('retry-after');error.retryAfter=retry&&/^[0-9]{1,6}$/.test(retry)?retry:null;throw error;
  }
  if(result?.meta?.contract_version!=='2.1.0'||!Object.hasOwn(result,'data'))throw Error('Response contract mismatch.');return result;
 }
 enroll(displayName,selfDescription=null){if(!this.credential)throw Error('Enrollment is optional legacy functionality, not part of open contribution.');return this.request('/agents/enroll',{method:'POST',body:{display_name:displayName,self_description:selfDescription},key:this.registrationKey});}
 async write(path,payload,label){return this.request(path,{method:'POST',body:payload,key:label===undefined?randomUUID():await this.intent(label,{path,payload})});}
 async writeText(text,label){return this.request('/records',{method:'POST',body:text,rawText:true,key:label===undefined?randomUUID():await this.intent(label,{path:'/records',text})});}
 context(seeds,{depth=1,cursor}={}){return this.request('/context',{method:'POST',authenticate:false,body:{seeds,depth,...(cursor?{cursor}:{})}});}
 search(query,options={}){return this.request('/search',{method:'POST',authenticate:false,body:{query,scope:'current',...options}});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [command,base,argument]=process.argv.slice(2);
 if(!base||!['capabilities','search','legacy-init'].includes(command)){console.error('Usage: node nuanox-client.mjs capabilities ORIGIN | search ORIGIN QUERY | legacy-init ORIGIN [private-path]');process.exitCode=2;}
 else{try{
  if(command==='legacy-init'){const c=await NuanoxClient.initialize(base,argument);console.log(JSON.stringify({status:'optional_legacy_credential_prepared',origin:c.origin,credential_file:c.path,registered:false}));}
  else{const c=NuanoxClient.connect(base);console.log(JSON.stringify(command==='search'?await c.search(argument??''):await c.request('/capabilities'),null,2));}
 }catch(error){console.error(error.message);process.exitCode=1;}}
}
