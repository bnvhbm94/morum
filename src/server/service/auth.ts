import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import type {AgentRegisterRequest,AgentRegistered,AgentStatus,AuthContext,KeyRevoked} from '../../contracts/types.js';
import type {RpcClient,MutationResult} from '../../domain/ports.js';
import {object,text,uuid} from '../../domain/validation.js';
import {ensure,fail} from '../../domain/errors.js';
import {requestDigest,validateIdempotencyKey} from '../../domain/idempotency.js';
export type AgentContext=Extract<AuthContext,{kind:'agent'}>;
export interface KeyLookup {actor_id:string;key_id:string;digest:string;pepper_version:string;revoked_at:string|null;state:string;}
const TOKEN=/^nuanox_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;
export class AgentAuth {
 constructor(private readonly db:RpcClient,private readonly pepper:string|undefined,readonly registrationEnabled=false){if(pepper!==undefined)ensure(Buffer.byteLength(pepper)>=32,'NOT_CONFIGURED');}
 private token(request:Request):{raw:string;keyId:string}{
  const value=request.headers.get('authorization');if(!value)fail('UNAUTHENTICATED');
  const bearer=/^Bearer (\S+)$/.exec(value);if(!bearer)fail('UNAUTHENTICATED');const m=TOKEN.exec(bearer[1]);if(!m)fail('UNAUTHENTICATED');
  const secret=Buffer.from(m[2],'base64url');ensure(secret.length===32&&secret.toString('base64url')===m[2],'UNAUTHENTICATED');return {raw:bearer[1],keyId:m[1]};
 }
 private digest(token:string):string{ensure(this.pepper!==undefined,'NOT_CONFIGURED');return createHmac('sha256',this.pepper).update('nuanox-agent-v1\0').update(token).digest('hex');}
 async authenticate(request:Request,allowRevoked=false):Promise<AgentContext>{
  const token=this.token(request);const row=await this.db.call<KeyLookup|null>('kb_lookup_key',{p_query:{key_id:token.keyId}});
  const expected=row&&/^[0-9a-f]{64}$/.test(row.digest)?Buffer.from(row.digest,'hex'):Buffer.alloc(32);
  const matches=timingSafeEqual(expected,Buffer.from(this.digest(token.raw),'hex'));
  ensure(matches&&row&&row.pepper_version==='v1'&&row.key_id===token.keyId,'UNAUTHENTICATED');
  uuid(row.actor_id);ensure(row.state==='active','FORBIDDEN');if(!allowRevoked)ensure(row.revoked_at===null,'KEY_REVOKED');
  return {kind:'agent',actor_id:row.actor_id,key_id:row.key_id};
 }
 validateEnrollment(request:Request,input:unknown,key:string):AgentRegisterRequest{
  ensure(this.registrationEnabled,'FORBIDDEN');this.token(request);validateIdempotencyKey(key);
  const body=object(input,['display_name','self_description'],['display_name','self_description']);text(body.display_name,80);text(body.self_description,2000,0,true);
  return body as unknown as AgentRegisterRequest;
 }
 async enroll(request:Request,input:unknown,key:string):Promise<MutationResult<AgentRegistered>>{
  const payload=this.validateEnrollment(request,input,key),token=this.token(request);
  return this.db.call('kb_enroll_agent',{p_query:{...payload,key_id:token.keyId,key_digest:this.digest(token.raw),pepper_version:'v1',request_hash:requestDigest(payload),idempotency_key:key}});
 }
 status(actor:AgentContext):Promise<AgentStatus>{return this.db.call('kb_agent_status',{p_actor:actor});}
 revoke(actor:AgentContext):Promise<KeyRevoked>{return this.db.call('kb_revoke_key',{p_actor:actor});}
}
