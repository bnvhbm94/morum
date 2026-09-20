'use client';
import {useEffect, useState} from 'react';
import type {Annotation, Evidence, Paged, Relation, Review, VersionView} from '../contracts/types';
import {apiGet, errorMessage, formatDate, refHref} from '../lib/api-client';

type Related = {annotations: Paged<Annotation>; relations: Paged<Relation>; evidence: Paged<Evidence>; reviews: Paged<Review>};
const emptyPage = {items: [], page: {snapshot_at: null, next_cursor: null, snapshot_expires_at: null, truncated: false}};

export default function VersionReader({kind, id}: {kind: 'record' | 'version'; id: string}) {
  const [view, setView] = useState<VersionView | null>(null), [related, setRelated] = useState<Related | null>(null);
  const [loading, setLoading] = useState(true), [relatedLoading, setRelatedLoading] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setView(null); setRelated(null);
    apiGet<VersionView>(`/${kind === 'record' ? 'records' : 'versions'}/${encodeURIComponent(id)}`, controller.signal).then(setView).catch(cause => { const message = errorMessage(cause); if (message) setError(message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, kind]);
  useEffect(() => {
    if (!view) return;
    const controller = new AbortController(); const versionId = view.version.id, target = `target_kind=version&target_id=${encodeURIComponent(versionId)}&limit=20`;
    setRelatedLoading(true); setRelated(null);
    Promise.allSettled([
      apiGet<Paged<Annotation>>(`/annotations?version_id=${encodeURIComponent(versionId)}&limit=20`, controller.signal),
      apiGet<Paged<Relation>>(`/relations?${target}&direction=both`, controller.signal),
      apiGet<Paged<Evidence>>(`/evidence?${target}`, controller.signal),
      apiGet<Paged<Review>>(`/reviews?${target}`, controller.signal),
    ]).then(settled => {
      if (controller.signal.aborted) return;
      setRelated({annotations: settled[0].status === 'fulfilled' ? settled[0].value : emptyPage, relations: settled[1].status === 'fulfilled' ? settled[1].value : emptyPage, evidence: settled[2].status === 'fulfilled' ? settled[2].value : emptyPage, reviews: settled[3].status === 'fulfilled' ? settled[3].value : emptyPage});
    }).finally(() => { if (!controller.signal.aborted) setRelatedLoading(false); });
    return () => controller.abort();
  }, [view]);
  if (loading) return <main className="reading-column"><p className="status-copy" role="status">기록을 불러오는 중…</p></main>;
  if (error || !view) return <main className="reading-column"><h1 className="page-heading" tabIndex={-1}>기록을 열지 못했습니다</h1><div className="notice error" role="alert">{error}</div><a href="/">홈으로 돌아가기</a></main>;
  const {version} = view;
  return <main className="reading-column">
    <p className="eyebrow">{kind === 'record' ? `기록 · 버전 ${version.version_no}${view.is_current ? ' · 최신' : ''}` : `정확한 버전 · ${version.version_no}`}</p>
    {version.title && <h1 className="page-heading" tabIndex={-1}>{version.title}</h1>}
    {!version.title && <h1 className="sr-only" tabIndex={-1}>제목 없는 기록</h1>}
    <p className="metadata">{formatDate(version.created_at)} · {view.author ? view.author.display_name : '익명 기여'} · {version.body_format === 'markdown' ? 'Markdown 원문' : '일반 텍스트'}</p>
    {view.correction_refs.length > 0 && <div className="notice"><strong>이 버전에 연결된 수정이 있습니다.</strong><div className="inline-links">{view.correction_refs.map(ref => <a key={`${ref.kind}-${ref.id}`} href={refHref(ref)}>수정 내용 보기</a>)}</div></div>}
    <article className="prose" aria-label={version.title || '제목 없는 기록'}><p className="raw-text">{version.body_text}</p></article>
    <nav className="inline-links" aria-label="기록 탐색"><a href={`/versions/${encodeURIComponent(version.id)}`}>이 버전 고정 링크</a><a href={`/versions/${encodeURIComponent(version.id)}/raw`} target="_blank" rel="noreferrer">원문 열기</a><a href={`/records/${encodeURIComponent(version.record_id)}/history`}>버전 이력</a>{kind === 'version' && <a href={`/records/${encodeURIComponent(version.record_id)}`}>최신 버전</a>}</nav>
    <section className="section" aria-labelledby="details-heading"><h2 id="details-heading">맥락과 검토</h2>
      <details className="disclosure"><summary>의미 {view.related_counts.annotations}건</summary><div className="disclosure-body">{relatedLoading ? <LoadingRelated/> : related?.annotations.items.length ? <ul>{related.annotations.items.map(item => <li key={item.id}><a href={`/objects/annotation/${encodeURIComponent(item.id)}`}>{item.meaning}</a></li>)}</ul> : <p className="muted">표시할 의미가 없습니다.</p>}{related?.annotations.page.next_cursor && <p className="status-copy">의미가 더 있습니다.</p>}</div></details>
      <details className="disclosure"><summary>근거 {view.basis.length + (related?.evidence.items.length || 0)}건{view.basis_truncated ? ' 이상' : ''}</summary><div className="disclosure-body">{view.basis.map(item => <EvidenceItem key={item.id} item={item}/>)}{relatedLoading ? <LoadingRelated/> : related?.evidence.items.map(item => <EvidenceItem key={item.id} item={item}/>)}{!relatedLoading && !view.basis.length && !related?.evidence.items.length && <p className="muted">표시할 근거가 없습니다.</p>}</div></details>
      <details className="disclosure"><summary>관계 {view.related_counts.relations}건</summary><div className="disclosure-body">{relatedLoading ? <LoadingRelated/> : related?.relations.items.length ? <ul>{related.relations.items.map(item => <li key={item.id}><a href={`/objects/relation/${encodeURIComponent(item.id)}`}>{item.predicate}</a> — {item.explanation}</li>)}</ul> : <p className="muted">표시할 관계가 없습니다.</p>}{related?.relations.page.next_cursor && <p className="status-copy">관계가 더 있습니다.</p>}</div></details>
      <details className="disclosure"><summary>검토 {view.related_counts.reviews}건</summary><div className="disclosure-body">{relatedLoading ? <LoadingRelated/> : related?.reviews.items.length ? <ul>{related.reviews.items.map(item => <li key={item.id}><a href={`/objects/review/${encodeURIComponent(item.id)}`}>{item.stance} · {item.focus}</a> — {item.explanation}</li>)}</ul> : <p className="muted">표시할 검토가 없습니다.</p>}<p className="status-copy">검토는 이 버전에만 적용되며, 익명 검토 수는 서로 다른 사람이나 에이전트 수를 뜻하지 않습니다.</p></div></details>
      <details className="disclosure"><summary>기타 속성</summary><div className="disclosure-body"><ObjectFields value={version.attributes}/></div></details>
    </section>
  </main>;
}

function LoadingRelated() { return <p className="status-copy" role="status">연결 정보를 불러오는 중…</p>; }

function EvidenceItem({item}: {item: Evidence}) {
  const basis = item.basis;
  return <p>{basis.kind === 'external' ? <><a href={`/sources/${encodeURIComponent(basis.source_id)}`}>제출된 외부 출처</a>{basis.quote ? ` — “${basis.quote}”` : ''}<br/></> : basis.kind === 'internal' ? <><a href={refHref(basis.source)}>내부 근거</a><br/></> : null}{basis.explanation}</p>;
}

export function ObjectFields({value}: {value: unknown}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return <p className="json-value">{String(value ?? '')}</p>;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return <p className="muted">추가 속성이 없습니다.</p>;
  return <dl className="definition-list">{entries.map(([key, item]) => <span key={key} style={{display: 'contents'}}><dt>{key}</dt><dd>{typeof item === 'string' ? item : JSON.stringify(item, null, 2)}</dd></span>)}</dl>;
}
