'use client';
import {useCallback, useEffect, useState} from 'react';
import type {SearchHit, SearchResponse, SearchScope} from '../contracts/types';
import {ApiError, apiPost, errorMessage, refHref} from '../lib/api-client';

export default function SearchResults({query, scope}: {query: string; scope: SearchScope}) {
  const [hits, setHits] = useState<SearchHit[]>([]), [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [cursorExpired, setCursorExpired] = useState(false);
  const run = useCallback(async (cursor: string | null, signal?: AbortSignal) => {
    if (!query.trim()) { setResult(null); setHits([]); return; }
    setLoading(true); setError(''); setCursorExpired(false);
    try {
      const data = await apiPost<SearchResponse>('/search', {query, scope, limit: 10, include_context: true, ...(cursor ? {cursor} : {})}, signal);
      setResult(data); setHits(previous => cursor ? [...previous, ...data.hits] : data.hits);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'CURSOR_EXPIRED') { setCursorExpired(true); setError('검색 페이지가 만료되었습니다. 같은 조건으로 처음부터 다시 검색할 수 있습니다.'); }
      else { const message = errorMessage(cause); if (message) setError(message); }
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [query, scope]);
  useEffect(() => { const controller = new AbortController(); setHits([]); run(null, controller.signal); return () => controller.abort(); }, [run]);
  return <>
    <form className="search-form" action="/search" method="get"><div className="search-line"><input name="q" defaultValue={query} aria-label="검색어" required/><span className="enter-hint" aria-hidden="true">Enter</span></div><div className="search-options"><label htmlFor="scope">검색 범위</label><select id="scope" name="scope" defaultValue={scope}><option value="current">현재 버전</option><option value="all_versions">모든 버전</option></select></div></form>
    {result && <p className="status-copy">{result.status.mode === 'keyword_only' ? '키워드 검색' : result.status.mode === 'hybrid_partial' ? '부분 혼합 검색' : '혼합 검색'} · {scope === 'current' ? '현재 버전' : '모든 버전'}{result.status.quality_gate === 'not_evaluated' ? ' · 품질 미평가' : ''}</p>}
    {error && <div className="notice error" role="alert">{error}{cursorExpired && <div className="load-more"><button className="secondary-action" type="button" onClick={() => { setHits([]); run(null); }}>처음부터 다시 검색</button></div>}</div>}
    {loading && hits.length === 0 && <p className="status-copy" role="status">검색 중…</p>}
    {!loading && !error && query && hits.length === 0 && <p className="muted">일치하는 지식을 찾지 못했습니다.</p>}
    <ol className="content-list">{hits.map((hit, index) => <li className="content-item" key={`${hit.unit_id}-${index}`}><a className="content-link" href={resultHref(hit)}>{hit.title || hit.snippet || `검색 결과 ${index + 1}`}</a>{hit.title && <p className="snippet">{hit.snippet}</p>}<p className="metadata">{hit.is_current === true ? '현재 버전' : hit.is_current === false ? '이전 버전' : '연결된 객체'}{hit.snippet_truncated ? ' · 발췌' : ''}</p><span className="card-arrow" aria-hidden="true">↗</span></li>)}</ol>
    {result?.page.next_cursor && <button className="secondary-action load-more" type="button" disabled={loading} onClick={() => run(result.page.next_cursor)}>{loading ? '불러오는 중…' : '다음 결과'}</button>}
    {result?.context_coverage.requested && result.context_coverage.omitted_targets.length > 0 && <p className="status-copy">이 페이지의 일부 맥락은 범위 제한으로 펼치지 않았습니다. 각 결과의 원문에서 계속 탐색할 수 있습니다.</p>}
  </>;
}

function resultHref(hit: SearchHit) {
  if (hit.version_id) return `/versions/${encodeURIComponent(hit.version_id)}`;
  if (hit.locator.kind === 'object') return refHref(hit.locator.target);
  if (hit.locator.kind === 'body' || hit.locator.kind === 'field') return `/versions/${encodeURIComponent(hit.locator.version_id)}`;
  return '/search';
}
