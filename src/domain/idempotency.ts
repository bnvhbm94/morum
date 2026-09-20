import type { AuthContext, MutationContext } from '../contracts/types.js';
import {ensure,fail} from './errors.js';
import {sha256} from './hash.js';
import {validateScalar} from './text.js';
export function canonicalJSON(value:unknown,depth=0):string {
 ensure(depth<=32);
 if(value===null)return 'null';
 if(typeof value==='string'){validateScalar(value);return JSON.stringify(value);}
 if(typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){ensure(Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER);return JSON.stringify(value);}
 if(Array.isArray(value)){
  ensure(Object.keys(value).length===value.length&&Object.keys(value).every((k,i)=>k===String(i))); // reject sparse/non-JSON arrays
  return '['+value.map(x=>canonicalJSON(x,depth+1)).join(',')+']';
 }
 if(typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
  const v=value as Record<string,unknown>,keys=Object.keys(v).sort();
  ensure(!Object.getOwnPropertySymbols(v).length);
  for(const key of keys){validateScalar(key);ensure(!['__proto__','prototype','constructor'].includes(key));}
  return '{'+keys.map(k=>JSON.stringify(k)+':'+canonicalJSON(v[k],depth+1)).join(',')+'}';
 }
 return fail('VALIDATION_FAILED');
}
export function validateIdempotencyKey(value:unknown):string {
 ensure(typeof value==='string'&&/^[A-Za-z0-9._~-]{16,128}$/.test(value));return value;
}
export const requestDigest=(value:unknown)=>sha256(canonicalJSON(value));
export function mutationContext(actor:AuthContext,operation:string,key:string,payload:unknown):MutationContext {
 return {actor,operation,idempotency_key:validateIdempotencyKey(key),request_hash:requestDigest(payload)};
}
