import type {ApiFailure, ApiSuccess, ContentRef, LocationRef, ReviewTargetRef} from '../contracts/types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v2${path}`, {headers: {'x-contract-version': '2.1.0'}, cache: 'no-store', signal});
  const payload = await response.json().catch(() => null) as ApiSuccess<T> | ApiFailure | null;
  if (!response.ok || !payload || !('data' in payload)) {
    const failure = payload && 'error' in payload ? payload.error : null;
    throw new ApiError(response.status, failure?.code || 'MALFORMED_RESPONSE', failure?.message || '서버 응답을 읽을 수 없습니다.');
  }
  return payload.data;
}

export async function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v2${path}`, {method: 'POST', headers: {'content-type': 'application/json', 'x-contract-version': '2.1.0'}, body: JSON.stringify(body), cache: 'no-store', signal});
  const payload = await response.json().catch(() => null) as ApiSuccess<T> | ApiFailure | null;
  if (!response.ok || !payload || !('data' in payload)) {
    const failure = payload && 'error' in payload ? payload.error : null;
    throw new ApiError(response.status, failure?.code || 'MALFORMED_RESPONSE', failure?.message || '서버 응답을 읽을 수 없습니다.');
  }
  return payload.data;
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('ko-KR', {dateStyle: 'medium', timeStyle: 'short'}).format(date);
}

export function excerpt(text: string, length = 100) {
  const points = Array.from(text.replace(/\s+/g, ' ').trim());
  return points.length > length ? `${points.slice(0, length).join('')}…` : points.join('');
}

export function refHref(ref: ContentRef | LocationRef | ReviewTargetRef) {
  if (ref.kind === 'version') return `/versions/${encodeURIComponent(ref.id)}`;
  if (ref.kind === 'source') return `/sources/${encodeURIComponent(ref.id)}`;
  return `/objects/${encodeURIComponent(ref.kind)}/${encodeURIComponent(ref.id)}`;
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 503 || error.code === 'NOT_CONFIGURED' || error.code === 'DEPENDENCY_UNAVAILABLE') return '지식 저장소에 연결할 수 없습니다. 서버와 데이터베이스 설정을 확인한 뒤 다시 시도해 주세요.';
    if (error.status === 404 || error.code === 'NOT_FOUND') return '요청한 지식을 찾을 수 없습니다.';
    return `${error.message} (${error.code})`;
  }
  if (error instanceof DOMException && error.name === 'AbortError') return '';
  return '네트워크 요청을 완료하지 못했습니다.';
}
