'use client';
import {useEffect, useState} from 'react';
import type {Paged, Version} from '../contracts/types';
import {apiGet, errorMessage, excerpt, formatDate} from '../lib/api-client';

export default function HistoryView({recordId}: {recordId: string}) {
  const [items, setItems] = useState<Version[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const load = async (next: string | null, signal?: AbortSignal) => {
    setLoading(true); setError('');
    try { const data = await apiGet<Paged<Version>>(`/records/${encodeURIComponent(recordId)}/versions?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ''}`, signal); setItems(previous => next ? [...previous, ...data.items] : data.items); setCursor(data.page.next_cursor); }
    catch (cause) { const message = errorMessage(cause); if (message) setError(message); }
    finally { if (!signal?.aborted) setLoading(false); }
  };
  useEffect(() => { const controller = new AbortController(); load(null, controller.signal); return () => controller.abort(); }, [recordId]);
  return <>{error && <div className="notice error" role="alert">{error}</div>}{loading && items.length === 0 && <p className="status-copy" role="status">이력을 불러오는 중…</p>}<ol className="content-list">{items.map(version => <li className="content-item" key={version.id}><a className="content-link" href={`/versions/${encodeURIComponent(version.id)}`}>버전 {version.version_no}{version.title ? ` · ${version.title}` : ` · ${excerpt(version.body_text, 70)}`}</a><p className="metadata">{formatDate(version.created_at)} · 부모 {version.parent_version_id ? <a href={`/versions/${encodeURIComponent(version.parent_version_id)}`}>{version.parent_version_id}</a> : '없음'}</p><p className="snippet">{version.reason}</p></li>)}</ol>{cursor && <button className="secondary-action load-more" type="button" disabled={loading} onClick={() => load(cursor)}>{loading ? '불러오는 중…' : '이력 더 보기'}</button>}</>;
}
