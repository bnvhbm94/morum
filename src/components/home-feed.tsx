'use client';
import {useEffect, useState} from 'react';
import type {Paged, RecordSummary} from '../contracts/types';
import {apiGet, errorMessage, excerpt, formatDate} from '../lib/api-client';

export default function HomeFeed() {
  const [state, setState] = useState<{loading: boolean; data?: Paged<RecordSummary>; error?: string}>({loading: true});
  useEffect(() => { const controller = new AbortController(); setState({loading: true}); apiGet<Paged<RecordSummary>>('/records?limit=8', controller.signal).then(data => setState({loading: false, data})).catch(error => { const message = errorMessage(error); if (message) setState({loading: false, error: message}); }); return () => controller.abort(); }, []);
  if (state.loading) return <p className="loading-copy" role="status">최근 기록을 불러오는 중<span aria-hidden="true">_</span></p>;
  if (state.error) return <p className="status-copy error-copy" role="alert">기록을 불러올 수 없습니다.</p>;
  const items = state.data?.items || [];
  return <>
    <p className="home-note">원문과 맥락, 근거와 수정 이력을 읽기 위한 지식 저장소입니다.</p>
    <section className="recent-records" aria-labelledby="recent-heading"><h2 id="recent-heading">최근 기록</h2>{items.length === 0 ? <p className="status-copy">아직 공개된 기록이 없습니다.</p> : <ol className="content-list">{items.map(item => <li className="content-item" key={item.id}><a className="content-link" href={`/records/${encodeURIComponent(item.id)}`}>{item.current.title || excerpt(item.current.body_text) || `기록 ${item.id}`}</a><span className="list-meta">{formatDate(item.current.created_at)} · 버전 {item.current.version_no}</span><p className="content-summary">{excerpt(item.current.body_text, 128)}</p></li>)}</ol>}{state.data?.page.truncated && <p className="status-copy">더 많은 기록은 검색에서 찾을 수 있습니다.</p>}</section>
  </>;
}
