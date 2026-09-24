'use client';

// The document view inside the universe: a planet's record or a star's description, read in place over the
// field. Same reading experience as the home explorer (title, Up/Down through paragraphs with a fading mark,
// Space to page), and the same satellites: earlier versions, evidence, declared relations, reviews.
import {Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import type {ContentRef, Dossier, QuoteCheckState, Version, VersionView} from '../../contracts/types';
import {loadSpatialCitations, loadSpatialDossier, loadSpatialHistory, loadSpatialMeanings, loadSpatialNeighbors, loadSpatialVersion, type Citation, type Meaning, type SpatialNeighbor} from '../../lib/spatial-data';
import {errorMessage} from '../../lib/api-client';
import {citeMark, renderCitedBody} from '../cited-body';
import {clearReadingHighlight, pageReading, stepReadingParagraph} from '../reading';
import {countReviewsByFocus, QUOTE_CHECK_TEXT, REVIEW_FOCUS_ROWS, REVIEW_STANCES} from '../reading-spans';
import {hueHex, parseAppearance} from './appearance';
import {relationLabel} from './labels';

export {relationLabel};

export type ReaderTarget =
  | {kind: 'doc'; versionId: string; role: 'planet' | 'star'; categoryId: string; categoryLabel: string; planetCount: number}
  | {kind: 'star-missing'; categoryId: string; categoryLabel: string; planetCount: number};

export type ReaderNeighbor = {versionId: string; predicate: string};

type Loaded = {view: VersionView; citations: Citation[]; meanings: Meaning[]; history: Version[]; neighbors: SpatialNeighbor[]; hasMoreNeighbors: boolean; dossier: Dossier | null};

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
        const [history, citations, meanings, dossier] = await Promise.all([
          loadSpatialHistory(view.version.record_id, controller.signal).catch(() => [] as Version[]),
          loadSpatialCitations(view, controller.signal).catch(() => [] as Citation[]),
          loadSpatialMeanings(view, controller.signal).catch(() => [] as Meaning[]),
          loadSpatialDossier(target.versionId, controller.signal).catch(() => null as Dossier | null),
        ]);
        if (controller.signal.aborted) return;
        setLoaded({view, citations, meanings, history, neighbors: neighborResult.items, hasMoreNeighbors: neighborResult.hasMore, dossier});
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
        {/* B §4: under 700px a thumb can reach a fixed circle without scrolling back to the top crumb. */}
        <button type="button" className="universe-reader-close-float" onClick={onClose} aria-label="닫기">닫기</button>
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
              {portrait(loaded.view.version.attributes)}
              {loaded.view.version.title
                ? <h2 className="universe-doc-title" id="universe-doc-title">{loaded.view.version.title}</h2>
                : <h2 className="universe-sr-only" id="universe-doc-title">제목 없는 기록</h2>}
              <div className="universe-doc-text">{renderCitedBody(loaded.view.version.body_text, loaded.citations, 'universe-cite', loaded.meanings)}</div>
              <nav className="universe-doc-links" aria-label="문서 상세">
                <a href={`/versions/${encodeURIComponent(loaded.view.version.id)}`}>고정 링크와 전체 맥락</a>
                <a href={`/versions/${encodeURIComponent(loaded.view.version.id)}/raw`} target="_blank" rel="noreferrer">원문</a>
                <a href={`/records/${encodeURIComponent(loaded.view.version.record_id)}/history`}>이력</a>
              </nav>
            </article>
            <aside className="universe-satellites" data-side="right" aria-label="관계와 검토">
              {reviewTable(loaded.dossier)}
              {rightSatellites(loaded, onOpenVersion)}
            </aside>
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

// ---- Quote-check line (B §2.1): what the server's mechanical comparison found, worded against the
// contributor's submitted excerpt — never "원문" (the server never opens the source page). Colour separates
// only compared vs not-compared; found_* and not_found share the same colour, since the line never says
// right or wrong. Text table lives in reading-spans.ts (pure, unit-tested).
function quoteCheckLine(state: QuoteCheckState | undefined): ReactNode {
  const entry = state ? QUOTE_CHECK_TEXT[state] : null;
  if (!entry) return null;
  return <span className="universe-cite-check" data-compared={entry.compared}><b className="universe-cite-check-label">인용 대조</b> · {entry.text}</span>;
}

function leftSatellites(loaded: Loaded, open: (versionId: string) => void): ReactNode[] {
  const quoteCheckById = new Map((loaded.dossier?.evidence ?? []).map(item => [item.id, item.quote_check.state]));
  const evidenceItems: ReactNode[] = [];
  let hasExternal = false;
  for (const citation of loaded.citations) {
    const {evidence, source, anchor, anchorMatches} = citation;
    const basis = evidence.basis;
    const caption = `${basis.kind === 'external' ? '출처' : basis.kind === 'internal' ? '내부 근거' : '추론'} ${citeMark(citation.index)}`;
    const where = anchor
      ? (anchorMatches ? <span className="universe-cite-where">본문 구간 “{anchor.selector.exact}”</span> : <span className="universe-cite-where">본문 구간이 현재 본문과 맞지 않음</span>)
      : <span className="universe-cite-where">문서 전체</span>;
    if (basis.kind === 'external') {
      hasExternal = true;
      const label = source?.title?.trim() || (source?.url ? hostOf(source.url) : '출처 보기');
      evidenceItems.push(satellite(`e-${evidence.id}`, 'evidence', caption, <>
        <a href={`/sources/${encodeURIComponent(basis.source_id)}`}>{label}</a>
        {basis.quote ? <q className="universe-cite-quote">{basis.quote}</q> : <span className="universe-cite-none">인용문 없음</span>}
        {quoteCheckLine(quoteCheckById.get(evidence.id))}
        <span className="universe-cite-why">{basis.explanation}</span>
        {where}
      </>));
    } else if (basis.kind === 'internal') {
      evidenceItems.push(satellite(`e-${evidence.id}`, 'evidence', caption, <><span className="universe-cite-why">{basis.explanation}</span>{where}</>, basis.source.kind === 'version' ? () => open(basis.source.id) : undefined));
    } else {
      evidenceItems.push(satellite(`e-${evidence.id}`, 'evidence', caption, <><span className="universe-cite-why">{basis.explanation}</span>{where}</>));
    }
  }
  if (hasExternal) {
    evidenceItems.push(
      <p key="cite-note" className="universe-cite-note">인용 대조는 제출된 발췌와 인용문을 글자로 맞춰 본 결과입니다. 서버는 출처 주소를 열지 않고, 내용이 참인지 판단하지 않습니다.</p>
    );
  }

  // Earlier versions and declared relations, capped; evidence (above) is never counted against the cap (B §2.1).
  const rest: ReactNode[] = [];
  for (const version of loaded.history.filter(version => version.id !== loaded.view.version.id)) {
    rest.push(satellite(`v-${version.id}`, 'version', `이전 버전 v${version.version_no}`, version.title || '제목 없는 기록', () => open(version.id)));
  }
  for (const neighbor of loaded.neighbors.filter(item => item.side === 'left')) {
    rest.push(satellite(`r-${neighbor.relation.id}`, 'relation', relationLabel(neighbor.relation.predicate), neighbor.node.title, neighbor.node.target.kind === 'version' ? () => open(neighbor.node.target.id) : undefined));
  }

  if (!evidenceItems.length && !rest.length) return [satellite('empty', 'empty', '', '첨부된 근거 없음')];
  return [...evidenceItems, ...cap(rest, false, loaded.view.version.id)];
}

function rightSatellites(loaded: Loaded, open: (versionId: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  for (const neighbor of loaded.neighbors.filter(item => item.side !== 'left')) {
    out.push(satellite(`r-${neighbor.relation.id}`, 'relation', relationLabel(neighbor.relation.predicate), neighbor.node.title, neighbor.node.target.kind === 'version' ? () => open(neighbor.node.target.id) : undefined));
  }
  for (const meaning of loaded.meanings) {
    const exact = meaning.anchor ? truncateExact(meaning.anchor.selector.exact) : '';
    const body = exact ? `“${exact}” — ${meaning.annotation.meaning}` : meaning.annotation.meaning;
    const conceptId = meaning.annotation.concept_version_id;
    out.push(satellite(`m-${meaning.annotation.id}`, 'meaning', '의미', body, conceptId ? () => open(conceptId) : undefined));
  }
  return cap(out, loaded.hasMoreNeighbors, loaded.view.version.id);
}

function cap(items: ReactNode[], needsMore: boolean, versionId: string): ReactNode[] {
  if (items.length <= SATELLITE_CAP && !needsMore) return items;
  return [...items.slice(0, SATELLITE_CAP - 1), satellite('more', 'more', '… 더 있음', <a href={`/versions/${encodeURIComponent(versionId)}`}>전체 맥락</a>)];
}

// ---- Review table (B §2.2): focus × stance, pinned at the top of the right column regardless of the
// satellite cap. Built from dossier.agreements.reviews and dossier.counterarguments.reviews — every review
// made on this version (the dossier already drops a keyed reviewer's superseded judgement). Row/column
// order and counting live in reading-spans.ts (pure, unit-tested).
function reviewTable(dossier: Dossier | null): ReactNode {
  if (!dossier) return null;
  const reviews = [...dossier.agreements.reviews, ...dossier.counterarguments.reviews];
  const counts = countReviewsByFocus(reviews);
  const rows = REVIEW_FOCUS_ROWS.filter(row => {
    const c = counts.get(row.focus)!;
    return c.agree + c.disagree + c.needs_review > 0;
  });

  const keyedTotal = dossier.agreements.agree_keyed + dossier.counterarguments.groups.keyed_actors;
  const anonymousTotal = dossier.agreements.agree_anonymous + dossier.counterarguments.groups.anonymous_reviews;
  const truncated = dossier.agreements.truncated;

  return (
    <div className="universe-review-table" aria-label="이 판에 단 검토">
      {rows.length === 0 ? (
        <p className="universe-review-empty">이 판에 단 검토 없음</p>
      ) : (
        <>
          <div className="universe-review-grid" role="table">
            <span className="universe-review-head universe-review-head-corner" role="columnheader">이 판에 단 검토</span>
            {REVIEW_STANCES.map(({stance, label}) => <span key={stance} className="universe-review-head" role="columnheader">{label}</span>)}
            {rows.map(row => {
              const c = counts.get(row.focus)!;
              return (
                <Fragment key={row.focus}>
                  <span className="universe-review-row-label" role="rowheader">{row.label}</span>
                  {REVIEW_STANCES.map(({stance}) => (
                    <span key={stance} className="universe-review-cell" data-nonzero={c[stance] > 0} role="cell">{c[stance] > 0 ? c[stance] : '·'}</span>
                  ))}
                </Fragment>
              );
            })}
          </div>
          {truncated && <p className="universe-review-note">50건까지만 셈</p>}
        </>
      )}
      {(keyedTotal > 0 || anonymousTotal > 0) && (
        <p className="universe-review-note">
          {`키 있는 검토자 ${keyedTotal} · 익명 제출 ${anonymousTotal}건`}
          {anonymousTotal > 0 && ' 익명 제출 수는 서로 다른 검토자 수가 아닙니다.'}
        </p>
      )}
    </div>
  );
}

// ---- Planet portrait (B §5): a 20px disc above the title, the open document's own `attributes.appearance`
// (not the field's — a reader shows the판 that is actually open). Texture lives only here: the field's 6px
// dot is too small to show grain or bands without borrowing the size (mass) channel.
function portrait(attributes: Version['attributes']): ReactNode {
  const appearance = parseAppearance(attributes);
  if (!appearance.present) return null;
  return <span className={`universe-portrait universe-portrait-${appearance.texture}`} style={{'--portrait-hue': hueHex(appearance.hue)} as CSSProperties} aria-hidden="true" />;
}

function truncateExact(text: string): string {
  const points = Array.from(text);
  return points.length > 24 ? `${points.slice(0, 24).join('')}…` : text;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return '출처 보기'; }
}
