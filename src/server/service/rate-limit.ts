import 'server-only';
import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import type {RpcClient} from '../../domain/ports.js';
import {ensure} from '../../domain/errors.js';
import {HttpError} from './transport.js';
export interface RateAnswer {allowed:boolean;retry_after:number;}
/** Atomic counters are in PostgreSQL, never per-process memory. IP trust must be configured by the deployment operator. */
export class RateLimiter {
 constructor(private readonly db:RpcClient,private readonly secret:string,private readonly trustedHeader?:string){ensure(Buffer.byteLength(secret)>=32,'NOT_CONFIGURED');}
 client(request:Request):string{
  const raw=this.trustedHeader?request.headers.get(this.trustedHeader):null;
  const ip=raw&&isIP(raw)?raw:'shared-untrusted-ingress';
  return createHmac('sha256',this.secret).update('nuanox-rate-ip-v2\0').update(ip).digest('hex');
 }
 async reserve(bucket:string,capacity:number,seconds:number,cost=1):Promise<RateAnswer>{
  const result=await this.db.call<RateAnswer>('kb_rate_limit',{p_query:{bucket,window_seconds:seconds,capacity,cost}});
  ensure(typeof result?.allowed==='boolean'&&Number.isSafeInteger(result.retry_after)&&result.retry_after>=1,'DEPENDENCY_UNAVAILABLE');return result;
 }
 async require(bucket:string,capacity:number,seconds:number,cost=1):Promise<void>{const r=await this.reserve(bucket,capacity,seconds,cost);if(!r.allowed)throw new HttpError('RATE_LIMITED',429,r.retry_after);}
}
