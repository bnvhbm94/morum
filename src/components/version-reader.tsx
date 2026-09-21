'use client';
import {useEffect, useState, type ReactNode} from 'react';
import type {Annotation, Evidence, Paged, Relation, Review, VersionView} from '../contracts/types';
import {apiGet, errorMessage, formatDate, refHref} from '../lib/api-client';

type RelatedPart<T> = {data: Paged<T> | null; error: string};
type Related = {annotations: RelatedPart<Annotation>; relations: RelatedPart<Relation>; evidence: RelatedPart<Evidence>; reviews: RelatedPart<Review>};

export default function VersionReader({kind, id}: {kind: 'record' | 'version'; id: string}) {
  const [view, setView] = useState<VersionView | null>(null), [related, setRelated] = useState<Related | null>(null);
  const [loading, setLoading] = useState(true), [relatedLoading, setRelatedLoading] = useState(false), [error, setError] = useState('');
  const [relatedAttempt, setRelatedAttempt] = useState(0);
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
      const part = <T,>(index: number): RelatedPart<T> => settled[index].status === 'fulfilled' ? {data: settled[index].value as Paged<T>, error: ''} : {data: null, error: errorMessage(settled[index].reason) || '연결 정보를 불러오지 못했습니다.'};
      setRelated({annotations: part<Annotation>(0), relations: part<Relation>(1), evidence: part<Evidence>(2), reviews: part<Review>(3)});
    }).finally(() => { if (!controller.signal.aborted) setRelatedLoading(false); });
    return () => controller.abort();
  }, [view, relatedAttempt]);
  if (loading) return <main className="reading-column"><p className="loading-copy" role="status">기록을 불러오는 중<span aria-hidden="true">_</span></p></main>;
  if (error || !view) return <main className="reading-column"><h1 className="page-heading" tabIndex={-1}>기록을 열지 못했습니다</h1><div className="notice error" role="alert">{error}</div><a href="/">홈으로 돌아가기</a></main>;
  const {version} = view; const retry = () => setRelatedAttempt(value => value + 1);
  return <main className="reading-column">
    <p className="eyebrow">{kind === 'record' ? `기록 · 버전 ${version.version_no}${view.is_current ? ' · 최신' : ''}` : `정확한 버전 · ${version.version_no}`}</p>
    {version.title && <h1 className="page-heading" tabIndex={-1}>{version.title}</h1>}
    {!version.title && <h1 className="sr-only" tabIndex={-1}>제목 없는 기록</h1>}
    <p className="metadata">{formatDate(version.created_at)} · {view.author ? view.author.display_name : '익명 기여'} · {version.body_format === 'markdown' ? 'Markdown 원문' : '일반 텍스트'}</p>
    {view.correction_refs.length > 0 && <div className="notice"><strong>이 버전에 연결된 수정이 있습니다.</strong><div className="inline-links">{view.correction_refs.map(ref => <a key={`${ref.kind}-${ref.id}`} href={refHref(ref)}>수정 내용 보기</a>)}</div></div>}
    <article className="prose" aria-label={version.title || '제목 없는 기록'}><p className="raw-text">{version.body_text}</p></article>
    <nav className="inline-links" aria-label="기록 탐색"><a href={`/versions/${encodeURIComponent(version.id)}`}>이 버전 고정 링크</a><a href={`/versions/${encodeURIComponent(version.id)}/raw`} target="_blank" rel="noreferrer">원문 열기</a><a href={`/records/${encodeURIComponent(version.record_id)}/history`}>버전 이력</a>{kind === 'version' && <a href={`/records/${encodeURIComponent(version.record_id)}`}>최신 버전</a>}</nav>
    <section className="section" aria-labelledby="details-heading"><h2 id="details-heading">맥락과 검토</h2>
      <details className="disclosure"><summary>의미 {view.related_counts.annotations}건</summary><div className="disclosure-body"><RelatedNote part={related?.annotations || null} loading={relatedLoading} onRetry={retry} empty="표시할 의미가 없습니다." render={item => <li key={item.id}><a href={`/objects/annotation/${encodeURIComponent(item.id)}`}>{item.meaning}</a></li>} />{related?.annotations.data?.page.next_cursor && <p className="status-copy">의미가 더 있습니다.</p>}</div></details>
      <details className="disclosure"><summary>근거</summary><div className="disclosure-body"><EvidenceNote view={view} part={related?.evidence || null} loading={relatedLoading} onRetry={retry}/></div></details>
      <details className="disclosure"><summary>관계 {view.related_counts.relations}건</summary><div className="disclosure-body"><RelatedNote part={related?.relations || null} loading={relatedLoading} onRetry={retry} empty="표시할 관계가 없습니다." render={item => <li key={item.id}><a href={`/objects/relation/${encodeURIComponent(item.id)}`}>{item.predicate}</a> — {item.explanation}</li>} />{related?.relations.data?.page.next_cursor && <p className="status-copy">관계가 더 있습니다.</p>}</div></details>
      <details className="disclosure"><summary>검토 {view.related_counts.reviews}건</summary><div className="disclosure-body"><RelatedNote part={related?.reviews || null} loading={relatedLoading} onRetry={retry} empty="표시할 검토가 없습니다." render={item => <li key={item.id}>{item.stance} · {item.focus}</li>} /><p className="status-copy">검토는 이 버전에만 적용되며, 익명 검토 수는 서로 다른 사람이나 에이전트 수를 뜻하지 않습니다.</p></div></details>
      <details className="disclosure"><summary>기타 속성</summary><div className="disclosure-body"><ObjectFields value={version.attributes}/></div></details>
    </section>
  </main>;
}

function RelatedNote<T extends {id: string}>({title, part, loading, onRetry, empty, render}: {title?: string; part: RelatedPart<T> | null; loading: boolean; onRetry: () => void; empty: string; render: (item: T) => ReactNode}) {
  const content = loading ? <LoadingRelated/> : part?.error ? <RelatedError message={part.error} onRetry={onRetry}/> : part?.data?.items.length ? <ul>{part.data.items.map(render)}</ul> : <p className="muted">{empty}</p>;
  return title ? <Note title={title}>{content}</Note> : <>{content}</>;
}

function EvidenceNote({view, part, loading, onRetry}: {view: VersionView; part: RelatedPart<Evidence> | null; loading: boolean; onRetry: () => void}) {
  const related = part?.data?.items || [], seen = new Set<string>(), items = [...view.basis, ...related].filter(item => !seen.has(item.id) && seen.add(item.id));
  const truncated = view.basis_truncated || Boolean(part?.data?.page.truncated);
  return <Note title={`근거 ${items.length}${truncated ? ' 이상' : ''}건`}>{loading ? <><EvidenceItems items={view.basis}/><LoadingRelated/></> : part?.error ? <><EvidenceItems items={view.basis}/><RelatedError message={part.error} onRetry={onRetry}/></> : items.length ? <EvidenceItems items={items}/> : <p className="muted">표시할 근거가 없습니다.</p>}</Note>;
}

function LoadingRelated() { return <p className="status-copy" role="status">연결 정보를 불러오는 중…</p>; }
function RelatedError({message, onRetry}: {message: string; onRetry: () => void}) { return <div className="notice error" role="alert"><p>{message}</p><button className="secondary-action" type="button" onClick={onRetry}>다시 시도</button></div>; }
function Note({title, children}: {title: string; children: ReactNode}) { return <section className="note"><h3>{title}</h3>{children}</section>; }
function EvidenceItems({items}: {items: Evidence[]}) { return <>{items.map(item => <EvidenceItem key={item.id} item={item}/>)}</>; }
function EvidenceItem({item}: {item: Evidence}) { const basis = item.basis; return <p>{basis.kind === 'external' ? <><a href={`/sources/${encodeURIComponent(basis.source_id)}`}>제출된 외부 출처</a>{basis.quote ? ` — “${basis.quote}”` : ''}<br/></> : basis.kind === 'internal' ? <><a href={refHref(basis.source)}>내부 근거</a><br/></> : null}{basis.explanation}</p>; }
export function ObjectFields({value}: {value: unknown}) { if (!value || typeof value !== 'object' || Array.isArray(value)) return <p className="json-value">{String(value ?? '')}</p>; const entries = Object.entries(value as Record<string, unknown>); if (!entries.length) return <p className="muted">추가 속성이 없습니다.</p>; return <dl className="definition-list">{entries.map(([key, item]) => <span key={key} style={{display: 'contents'}}><dt>{key}</dt><dd>{typeof item === 'string' ? item : JSON.stringify(item, null, 2)}</dd></span>)}</dl>; }
