import type { AuthContext } from '../contracts/types.js';
import { ensure } from './errors.js';
import { uuid, object } from './validation.js';
/** Structural check ONLY. The server constructs anonymous context for open writes,
 * or keyed context after digest verification. Database locks recheck keyed state.
 * Historical human types are retained for reference; active v2 SQL denies them. */
export function assertServerAuthContext(value:unknown):asserts value is AuthContext {
 ensure(value!==null,'UNAUTHENTICATED');const v=object(value);
 if(v.kind==='anonymous'){object(v,['kind'],['kind']);return;}
 if(v.kind==='human'){
  object(v,['kind','actor_id','auth_user_id'],['kind','actor_id','auth_user_id']);uuid(v.auth_user_id);
 }else{
  ensure(v.kind==='agent','UNAUTHENTICATED');object(v,['kind','actor_id','key_id'],['kind','actor_id','key_id']);uuid(v.key_id);
 }
 uuid(v.actor_id);
}
