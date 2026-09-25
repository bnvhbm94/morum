import 'server-only';
import {createHmac} from 'node:crypto';
import {isIP,isIPv6} from 'node:net';
import type {RpcClient} from '../../domain/ports.js';
import {ensure} from '../../domain/errors.js';
import {HttpError} from './transport.js';
export interface RateAnswer {allowed:boolean;retry_after:number;}
/**
 * Bucket a client IP for rate limiting. IPv4 addresses pass through unchanged (bucket names for
 * IPv4 must stay stable). IPv6 addresses are normalised to their /64 prefix (the first four
 * hextets, `::` expanded) so a single client with many addresses in the same /64 (common with
 * privacy extensions / SLAAC) shares one bucket instead of getting a fresh one per request.
 */
export function clientBucket(ip:string):string{
 if(!isIPv6(ip))return ip;
 const addr=ip.split('%')[0]; // strip zone id, e.g. fe80::1%eth0
 let head=addr,tail='';
 if(addr.includes('::')){const i=addr.indexOf('::');head=addr.slice(0,i);tail=addr.slice(i+2);}
 const headParts=head?head.split(':'):[];
 const tailParts=tail?tail.split(':'):[];
 const missing=Math.max(0,8-headParts.length-tailParts.length);
 const full=[...headParts,...Array(missing).fill('0'),...tailParts].slice(0,8);
 const hextets=full.map(h=>h.padStart(4,'0'));
 return hextets.slice(0,4).join(':');
}
/** Atomic counters are in PostgreSQL, never per-process memory. IP trust must be configured by the deployment operator. */
export class RateLimiter {
 constructor(private readonly db:RpcClient,private readonly secret:string,private readonly trustedHeader?:string){ensure(Buffer.byteLength(secret)>=32,'NOT_CONFIGURED');}
 client(request:Request):string{
  const raw=this.trustedHeader?request.headers.get(this.trustedHeader):null;
  const ip=raw&&isIP(raw)?clientBucket(raw):'shared-untrusted-ingress';
  return createHmac('sha256',this.secret).update('nuanox-rate-ip-v2\0').update(ip).digest('hex');
 }
 async reserve(bucket:string,capacity:number,seconds:number,cost=1):Promise<RateAnswer>{
  const result=await this.db.call<RateAnswer>('kb_rate_limit',{p_query:{bucket,window_seconds:seconds,capacity,cost}});
  ensure(typeof result?.allowed==='boolean'&&Number.isSafeInteger(result.retry_after)&&result.retry_after>=1,'DEPENDENCY_UNAVAILABLE');return result;
 }
 async require(bucket:string,capacity:number,seconds:number,cost=1):Promise<void>{const r=await this.reserve(bucket,capacity,seconds,cost);if(!r.allowed)throw new HttpError('RATE_LIMITED',429,r.retry_after);}
}
