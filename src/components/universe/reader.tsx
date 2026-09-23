'use client';

// The document view inside the universe: a planet's record or a star's description, read in place over the
// field. Same reading experience as the home explorer (title, Up/Down through paragraphs with a fading mark,
// Space to page), and the same satellites: earlier versions, evidence, declared relations, reviews.
import {useEffect, useRef, useState, type ReactNode} from 'react';
import type {ContentRef, Version, VersionView} from '../../contracts/types';
import {loadSpatialCitations, loadSpatialHistory, loadSpatialNeighbors, loadSpatialVersion, type Citation, type SpatialNeighbor} from '../../lib/spatial-data';
import {errorMessage} from '../../lib/api-client';
import {citeMark, renderCitedBody} from '../cited-body';
import {clearReadingHighlight, pageReading, stepReadingParagraph} from '../reading';

export type ReaderTarget =
  | {kind: 'doc'; versionId: string; role: 'planet' | 'star'; categoryId: string; categoryLabel: string; planetCount: number}
  | {kind: 'star-missing'; categoryId: string; categoryLabel: string; planetCount: number};

export type ReaderNeighbor = {versionId: string; predicate: string};

type Loaded = {view: VersionView; citations: Citation[]; history: Version[]; neighbors: SpatialNeighbor[]; hasMoreNeighbors: boolean};

const RELATION_LABEL: Record<string, string> = {supports: '지지', corrects: '정정', depends_on: '의존', derived_from: '파생', contradicts: '반론', defines: '정의', related_to: '관련', same_meaning_as: '같은 의미', translation_of: '번역'};
export function relationLabel(predicate: string): string { return RELATION_LABEL[predicate] || predicate; }

export function readerTargetKey(target: ReaderTarget): string {
  return target.kind === 'doc' ? `doc:${target.versionId}` : `star:${target.categoryId}`;
}

type Props = {
  target: ReaderTarget;
  reducedMotion: boolean;
  onClose: () => void;
  /** Open another document (an earlier version, a related record) in the same reader. */
  onOpenVersion: (versionId: string) => void;
  /** Declared relations of the open document, once known, so the field can mark the related planets. */
  onNeighbors: (neighbors: ReaderNeighbor[]) => void;
};

export default function UniverseReader({target, reducedMotion, onClose, onOpenVersion, onNeighbors}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const paragraphRef = useRef(-1);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(target.kind === 'doc');
  const key = readerTargetKey(target);

  // Load the document and its satellites; a new target aborts the previous load.
  useEffect(() => {
    paragraphRef.current = -1;
    clearReadingHighlight();
    setLoaded(null); setError('');
    if (target.kind !== 'doc') { setLoading(false); onNeighbors([]); return; }
    const controller = new AbortController();
    setLoading(true);
    const ref: ContentRef = {kind: 'version', id: target.versionId};
    (async () => {
      try {
        const [view, neighborResult] = await Promise.all([
          loadSpatialVersion(target.versionId, controller.signal),
          loadSpatialNeighbors(ref, {displayLimit: 12}, controller.signal).catch(() => ({items: [] as SpatialNeighbor[], hasMore: false})),
        ]);
        if (controller.signal.aborted) return;
        const [history, citations] = await Promise.all([
          loadSpatialHistory(view.version.record_id, controller.signal).catch(() => [] as Version[]),
          loadSpatialCitations(view, controller.signal).catch(() => [] as Citation[]),
        ]);
        if (controller.signal.aborted) return;
        setLoaded({view, citations, history, neighbors: neighborResult.items, hasMoreNeighbors: neighborResult.hasMore});
        setLoading(false);
        onNeighbors(neighborResult.items.flatMap(item => item.node.target.kind === 'version' ? [{versionId: item.node.target.id, predicate: item.relation.predicate}] : []));
        requestAnimationFrame(() => articleRef.current?.focus({preventScroll: true}));
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(errorMessage(caught) || '문서를 열지 못했다.');
        setLoading(false);
      }
    })();
    return () => { controller.abort(); clearReadingHighlight(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Reading keys. Registered while the reader is open; the universe skips its own arrow handling meanwhile.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const focused = event.target instanceof HTMLElement ? event.target : null;
      if (focused?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || event.isComposing) return;
      const scroller = scrollerRef.current, article = articleRef.current;
      if (!scroller || !article) return;
      const smooth = !reducedMotion;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const body = article.querySelector<HTMLElement>('.universe-doc-text');
        if (!body) return;
        event.preventDefault();
        paragraphRef.current = stepReadingParagraph({article: scroller, title: article.querySelector<HTMLElement>('.universe-doc-title'), body}, paragraphRef.current, event.key === 'ArrowDown' ? 1 : -1, smooth);
        return;
      }
      if (event.key === ' ' || event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault();
        pageReading(scroller, event.key === 'PageUp' || (event.key === ' ' && event.shiftKey) ? -1 : 1, smooth);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reducedMotion]);

  const kindWord = target.kind === 'doc' && target.role === 'planet' ? '행성' : '항성';
  const crumb = `${target.categoryLabel} · ${kindWord}${target.kind === 'star-missing' || (target.kind === 'doc' && target.role === 'star') ? ` · 행성 ${target.planetCount}` : ''}`;

  return (
    <div ref={scrollerRef} className="universe-reader" role="dialog" aria-label={crumb}
      onClick={event => { if (event.target === event.currentTarget || (event.target instanceof HTMLElement && event.target.classList.contains('universe-reader-stage'))) onClose(); }}>
      <div className="universe-reader-stage">
        <p className="universe-reader-crumb">
          <button type="button" className="universe-reader-close" onClick={onClose}>닫기</button>
          <span>{crumb}</span>
        </p>
        {target.kind === 'star-missing' && (
          <article ref={articleRef} className="universe-doc" tabIndex={-1} aria-labelledby="universe-doc-title">
            <h2 className="universe-doc-title" id="universe-doc-title">{target.categoryLabel}</h2>
            <div className="universe-doc-text">{`행성 ${target.planetCount}.\n\n아직 이 항성의 설명 문서가 없다. 설명 문서는 여기 속한 기록들을 바탕으로 쓰이고, 올라오면 이 자리에 보인다.`}</div>
          </article>
        )}
        {target.kind === 'doc' && loading && <p className="universe-reader-note" role="status">문서를 여는 중</p>}
        {target.kind === 'doc' && error && <p className="universe-reader-note" role="alert">{error}</p>}
        {target.kind === 'doc' && loaded && (
          <div className="universe-reader-grid">
            <aside className="universe-satellites" data-side="left" aria-label="이력과 근거">{leftSatellites(loaded, onOpenVersion)}</aside>
            <article ref={articleRef} className="universe-doc" tabIndex={-1} aria-labelledby="universe-doc-title">
              {loaded.view.version.title
                ? <h2 className="universe-doc-title" id="universe-doc-title">{loaded.view.version.title}</h2>
                : <h2 className="universe-sr-only" id="universe-doc-title">제목 없는 기록</h2>}
              <div className="universe-doc-text">{renderCitedBody(loaded.view.version.body_text, loaded.citations, 'universe-cite')}</div>
              <nav className="universe-doc-links" aria-label="문서 상세">
                <a href={`/versions/${encodeURIComponent(loaded.view.version.id)}`}>고정 링크와 전체 맥락</a>
                <a href={`/versions/${encodeURIComponent(loaded.view.version.id)}/raw`} target="_blank" rel="noreferrer">원문</a>
                <a href={`/records/${encodeURIComponent(loaded.view.version.record_id)}/history`}>이력</a>
              </nav>
            </article>
            <aside className="universe-satellites" data-side="right" aria-label="관계와 검토">{rightSatellites(loaded, onOpenVersion)}</aside>
          </div>
        )}
      </div>
    </div>
  );
}

const SATELLITE_CAP = 6;

function satellite(key: string, kind: string, caption: string, body: ReactNode, onClick?: () => void): ReactNode {
  const content = <><b>{caption}</b>{body}</>;
  return onClick
    ? <button key={key} type="button" className="universe-satellite" data-kind={kind} onClick={onClick}>{content}</button>
    : <div key={key} className="universe-satellite" data-kind={kind}>{content}</div>;
}

function leftSatellites(loaded: Loaded, open: (versionId: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  for (const version of loaded.history.filter(version => version.id !== loaded.view.version.id)) {
    out.push(satellite(`v-${version.id}`, 'version', `이전 버전 v${version.version_no}`, version.title || '제목 없는 기록', () => open(version.id)));
  }
  for (const citation of loaded.citations) {
    const {evidence, source, anchor, anchorMatches} = citation;
    const basis = evidence.basis;
    const caption = `${basis.kind === 'external' ? '출처' : basis.kind === 'internal' ? '내부 근거' : '추론'} ${citeMark(citation.index)}`;
    const where = anchor
      ? (anchorMatches ? <span className="universe-cite-where">본문 구간 “{anchor.selector.exact}”</span> : <span className="universe-cite-where">본문 구간이 현재 본문과 맞지 않음</span>)
      : <span className="universe-cite-where">문서 전체</span>;
    if (basis.kind === 'external') {
      const label = source?.title?.trim() || (source?.url ? hostOf(source.url) : '출처 보기');
      out.push(satellite(`e-${evidence.id}`, 'evidence', caption, <><a href={`/sources/${encodeURIComponent(basis.source_id)}`}>{label}</a>{basis.quote ? <q className="universe-cite-quote">{basis.quote}</q> : <span className="universe-cite-none">인용문 없음</span>}<span className="universe-cite-why">{basis.explanation}</span>{where}</>));
    } else if (basis.kind === 'internal') {
      out.push(satellite(`e-${evidence.id}`, 'evidence', caption, <><span className="universe-cite-why">{basis.explanation}</span>{where}</>, basis.source.kind === 'version' ? () => open(basis.source.id) : undefined));
    } else {
      out.push(satellite(`e-${evidence.id}`, 'evidence', caption, <><span className="universe-cite-why">{basis.explanation}</span>{where}</>));
    }
  }
  for (const neighbor of loaded.neighbors.filter(item => item.side === 'left')) {
    out.push(satellite(`r-${neighbor.relation.id}`, 'relation', relationLabel(neighbor.relation.predicate), neighbor.node.title, neighbor.node.target.kind === 'version' ? () => open(neighbor.node.target.id) : undefined));
  }
  if (!out.length) out.push(satellite('empty', 'empty', '', '첨부된 근거 없음'));
  return cap(out, false, loaded.view.version.id);
}

function rightSatellites(loaded: Loaded, open: (versionId: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  for (const neighbor of loaded.neighbors.filter(item => item.side !== 'left')) {
    out.push(satellite(`r-${neighbor.relation.id}`, 'relation', relationLabel(neighbor.relation.predicate), neighbor.node.title, neighbor.node.target.kind === 'version' ? () => open(neighbor.node.target.id) : undefined));
  }
  const summary = loaded.view.review_summary;
  out.push(satellite('review', 'review', '검토', summary.review_state === 'unreviewed' ? '아직 검토 없음' : `${summary.agree} 동의 · ${summary.disagree} 반대 · ${summary.needs_review} 검토 필요`));
  return cap(out, loaded.hasMoreNeighbors, loaded.view.version.id);
}

function cap(items: ReactNode[], needsMore: boolean, versionId: string): ReactNode[] {
  if (items.length <= SATELLITE_CAP && !needsMore) return items;
  return [...items.slice(0, SATELLITE_CAP - 1), satellite('more', 'more', '… 더 있음', <a href={`/versions/${encodeURIComponent(versionId)}`}>전체 맥락</a>)];
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return '출처 보기'; }
}
