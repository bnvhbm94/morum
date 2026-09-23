import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {ensure,fail} from '../../domain/errors.js';
import {canonicalJSON} from '../../domain/idempotency.js';
import {sha256} from '../../domain/hash.js';
export type CursorPayload={v:1;scope:string;binding:string;exp:number;[key:string]:unknown};
/** Stateless authenticated envelope; snapshot contents live privately in SQL. */
export class CursorCodec {
 constructor(private readonly secret:string,private readonly now:()=>number=Date.now){ensure(Buffer.byteLength(secret)>=32,'NOT_CONFIGURED');}
 bind(scope:string,query:Record<string,unknown>):string{return sha256(canonicalJSON({scope,query}));}
 encode(scope:string,query:Record<string,unknown>,fields:Record<string,unknown>,expiresAt:string):string {
  const exp=Date.parse(expiresAt);ensure(Number.isFinite(exp)&&exp<=this.now()+610000,'INTERNAL_ERROR');
  // The snapshot can expire between the SQL read and this encode; report it the way decode does.
  if(exp<=this.now())fail('CURSOR_EXPIRED');
  const payload={...fields,v:1,scope,binding:this.bind(scope,query),exp};
  const text=Buffer.from(canonicalJSON(payload)).toString('base64url');
  return `${text}.${this.sign(text).toString('base64url')}`;
 }
 decode(cursor:string,scope:string,query:Record<string,unknown>):CursorPayload{
  ensure(typeof cursor==='string'&&cursor.length<=4096,'CURSOR_INVALID');const parts=cursor.split('.');
  ensure(parts.length===2&&parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)),'CURSOR_INVALID');
  const signature=Buffer.from(parts[1],'base64url'),expected=this.sign(parts[0]);
  ensure(signature.toString('base64url')===parts[1]&&signature.length===expected.length&&timingSafeEqual(signature,expected),'CURSOR_INVALID');
  let value:CursorPayload;try{value=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8')) as CursorPayload;}catch{fail('CURSOR_INVALID');}
  ensure(value!==null&&typeof value==='object'&&value.v===1&&value.scope===scope&&value.binding===this.bind(scope,query)&&Number.isSafeInteger(value.exp),'CURSOR_INVALID');
  if(value.exp<=this.now())fail('CURSOR_EXPIRED');return value;
 }
 private sign(text:string):Buffer{return createHmac('sha256',this.secret).update(text,'utf8').digest();}
}
