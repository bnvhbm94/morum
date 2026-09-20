'use client';
import {useEffect, useState} from 'react';
import type {Paged, RecordSummary} from '../contracts/types';
import {apiGet, errorMessage, excerpt, formatDate} from '../lib/api-client';

export default function HomeFeed() {
  const [state, setState] = useState<{loading: boolean; data?: Paged<RecordSummary>; error?: string}>({loading: true});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { const controller = new AbortController(); setState({loading: true}); apiGet<Paged<RecordSummary>>('/records?limit=8', controller.signal).then(data => setState({loading: false, data})).catch(error => { const message = errorMessage(error); if (message) setState({loading: false, error: message}); }); return () => controller.abort(); }, [attempt]);
  if (state.loading) return <p className="status-copy home-status" role="status">최근 기록을 확인하는 중…</p>;
  if (state.error) return <section className="home-status error-state" role="alert"><h2>기록을 불러오지 못했습니다</h2><p className="status-copy error-copy">{state.error}</p><button className="secondary-action" type="button" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></section>;
  const items = state.data?.items || [];
  return <section className="recent-records" aria-labelledby="recent-heading"><h2 id="recent-heading">최근 기록</h2>{items.length === 0 ? <p className="status-copy">아직 공개된 기록이 없습니다.</p> : <ol className="content-list">{items.map(item => <li className="content-item" key={item.id}><a className="content-link" href={`/records/${encodeURIComponent(item.id)}`}>{item.current.title || excerpt(item.current.body_text) || `기록 ${item.id}`}</a><p className="metadata">버전 {item.current.version_no} · {formatDate(item.current.created_at)}</p><span className="card-arrow" aria-hidden="true">↗</span></li>)}</ol>}{state.data?.page.truncated && <p className="status-copy">더 많은 기록은 검색에서 찾을 수 있습니다.</p>}</section>;
}
