import type { ApiFailure, Attributes, ErrorCode, UUID } from '../contracts/types.js';
import { CONTRACT_VERSION } from '../contracts/types.js';
export const STATUS: Record<ErrorCode, number> = {
 INVALID_JSON:400, VALIDATION_FAILED:422, INVALID_TEXT:422, INVALID_LINE_ENDINGS:422,
 UNAUTHENTICATED:401, AMBIGUOUS_AUTH:400, FORBIDDEN:403, AGENT_NOT_APPROVED:403,
 KEY_REVOKED:401, NOT_FOUND:404, RESOURCE_GONE:410, CLAIM_EXPIRED:410, CLAIM_TAKEN:409,
 BASE_HASH_MISMATCH:409, TEXT_MISMATCH:409, OVERLAPPING_EDITS:422, NO_CHANGE:409,
 IDEMPOTENCY_CONFLICT:409, REVIEW_HEAD_CHANGED:409, TASK_REVISION_CONFLICT:409,
 CURSOR_EXPIRED:410, CURSOR_INVALID:400, PAYLOAD_TOO_LARGE:413, RATE_LIMITED:429,
 NOT_CONFIGURED:503, DEPENDENCY_UNAVAILABLE:503, INTERNAL_ERROR:500,
};
export class DomainError extends Error {
 readonly code: ErrorCode;
 readonly status: number;
 readonly retryable: boolean;
 readonly details: Attributes | null;
 constructor(code: ErrorCode, details: Attributes | null = null) {
  super(code); this.name='DomainError'; this.code=code; this.status=STATUS[code];
  this.retryable=code==='DEPENDENCY_UNAVAILABLE'||code==='RATE_LIMITED'; this.details=details;
 }
}
export function fail(code: ErrorCode, details: Attributes | null = null): never { throw new DomainError(code,details); }
export function ensure(ok: unknown, code: ErrorCode = 'VALIDATION_FAILED'): asserts ok { if(!ok) fail(code); }
/** Only allowlisted codes cross the DB boundary; never expose driver details/stack. */
export function mapDatabaseError(error: unknown): DomainError {
 if(error instanceof DomainError) return error;
 const e = error as {code?:unknown;message?:unknown};
 if(typeof e?.message==='string' && e.message.startsWith('KB:')) {
  const code=e.message.slice(3);
  if(Object.hasOwn(STATUS,code)) return new DomainError(code as ErrorCode);
 }
 if(e?.code==='22P05'||e?.code==='22021') return new DomainError('INVALID_TEXT');
 if(e?.code==='22P02'||e?.code==='23514'||e?.code==='22003') return new DomainError('VALIDATION_FAILED');
 if(['42P01','42883','3F000','PGRST202'].includes(String(e?.code))) return new DomainError('NOT_CONFIGURED');
 if(e?.code==='23503') return new DomainError('NOT_FOUND');
 if(e?.code==='40001'||e?.code==='40P01'||e?.code==='57014'||e?.code==='53300'||e?.code==='08006'||e?.code==='55P03')
  return new DomainError('DEPENDENCY_UNAVAILABLE');
 if(e?.code==='42501') return new DomainError('FORBIDDEN');
 return new DomainError('INTERNAL_ERROR');
}
export function apiFailure(error: unknown, requestId: UUID): ApiFailure {
 const e=mapDatabaseError(error);
 // Driver messages, SQL, object bodies and arbitrary error.details are NOT serialized.
 const message=e.code==='NOT_FOUND' ? '\uc790\ub8cc\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.' :
  e.status===503 ? '\uc11c\ube44\uc2a4 \uc5f0\uacb0 \uc0c1\ud0dc\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.' :
  e.status===409 ? '\ubcc0\uacbd \ucda9\ub3cc\uc785\ub2c8\ub2e4. \uc785\ub825\uc744 \ubcf4\uc874\ud558\uace0 \uc6d0\ubcf8\uc744 \ub2e4\uc2dc \ud655\uc778\ud574 \uc8fc\uc138\uc694.' :
  '\uc694\uccad\uc744 \ucc98\ub9ac\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4. \uc624\ub958 \ucf54\ub4dc\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.';
 return {error:{code:e.code,message,details:null,retryable:e.retryable},
  meta:{contract_version:CONTRACT_VERSION,request_id:requestId,replayed:false}};
}
