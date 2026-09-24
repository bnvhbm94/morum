'use client';

// The document view inside the universe: a planet's record or a star's description, read in place over the
// field. Same satellites as the home explorer (earlier versions, evidence, declared relations, reviews). Its
// own keyboard cursor lives entirely inside its own columns (left satellites, the centre article, right
// satellites) — arrows never open another document by themselves, unlike the field's own Arrow navigation in
// explore mode, which this reader never touches. See moveReaderCursor for the column/index state machine.
import {Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import type {ContentRef, Dossier, QuoteCheckState, Version, VersionView} from '../../contracts/types';
import {loadSpatialCitations, loadSpatialDossier, loadSpatialHistory, loadSpatialMeanings, loadSpatialNeighbors, loadSpatialVersion, type Citation, type Meaning, type SpatialNeighbor} from '../../lib/spatial-data';
import {errorMessage} from '../../lib/api-client';
import {citeMark, renderCitedBody} from '../cited-body';
import {clearReadingHighlight, pageReading, readingUnits, stepReadingParagraph} from '../reading';
import {countReviewsByFocus, QUOTE_CHECK_TEXT, REVIEW_FOCUS_ROWS, REVIEW_STANCES, type ReviewFocus, type ReviewStance} from '../reading-spans';
import {hueHex, parseAppearance} from './appearance';
import {relationLabel} from './labels';
import {INITIAL_READER_CURSOR, moveReaderCursor, type ReaderArrowKey, type ReaderCursor} from './reader-cursor';

export {relationLabel};
export {INITIAL_READER_CURSOR, moveReaderCursor, type ReaderColumn, type ReaderCursor, type ReaderArrowKey} from './reader-cursor';

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
  const leftAsideRef = useRef<HTMLElement>(null);
  const rightAsideRef = useRef<HTMLElement>(null);
  const cursorRef = useRef<ReaderCursor>(INITIAL_READER_CURSOR);
  const stageRef = useRef<HTMLDivElement>(null);
  const paragraphRef = useRef(-1);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(target.kind === 'doc');
  const key = readerTargetKey(target);

  // Load the document and its satellites; a new target aborts the previous load.
  useEffect(() => {
    clearReadingHighlight();
    cursorRef.current = INITIAL_READER_CURSOR;
    panStage(stageRef.current, null, null, false);
    paragraphRef.current = -1;
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

  // Paging, arrow-cursor and Enter keys, registered while the reader is open. Bound to `window` before the
  // universe's own keydown listener (see universe.tsx), which now leaves every key alone while the reader is
  // open — the cursor below is the reader's own, entirely inside its own columns; it never opens another
  // document by itself. stopImmediatePropagation on the arrows also keeps the field from panning underneath.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const focused = event.target instanceof HTMLElement ? event.target : null;
      if (focused?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || event.isComposing) return;
      const scroller = scrollerRef.current, article = articleRef.current;
      if (!scroller || !article) return;
      const smooth = !reducedMotion;
      if (event.key === ' ' || event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault();
        pageReading(scroller, event.key === 'PageUp' || (event.key === ' ' && event.shiftKey) ? -1 : 1, smooth);
        return;
      }
      if (event.key.startsWith('Arrow')) {
        const arrow = event.key as ReaderArrowKey;
        event.preventDefault();
        event.stopImmediatePropagation();
        const cursor = cursorRef.current;
        // Up/Down in the centre column: restore the old paragraph-stepping behaviour instead of moving the
        // cursor (moveReaderCursor is a no-op here for exactly this case).
        if (cursor.column === 'center' && (arrow === 'ArrowUp' || arrow === 'ArrowDown')) {
          const body = article.querySelector<HTMLElement>('.universe-doc-text');
          if (body) paragraphRef.current = stepReadingParagraph({article: scroller, title: article.querySelector<HTMLElement>('.universe-doc-title'), body}, paragraphRef.current, arrow === 'ArrowDown' ? 1 : -1, smooth);
          return;
        }
        const leftEls = satellitesIn(leftAsideRef.current), rightEls = satellitesIn(rightAsideRef.current);
        const counts = {left: leftEls.length, right: rightEls.length};
        // Entering a side column from the article: land on the satellite level with what is being read —
        // the current paragraph if one is selected, else the middle of the view once scrolled — and on the
        // top item when nothing is selected and nothing has been scrolled.
        const enterSide = arrow === 'ArrowLeft' ? 'left' : 'right';
        let enterIndex = 0;
        if (cursor.column === 'center') {
          const els = enterSide === 'left' ? leftEls : rightEls;
          const refY = readingReferenceY(scroller, article, paragraphRef.current);
          enterIndex = refY === null ? 0 : nearestIndexToY(els, refY);
        }
        const next = moveReaderCursor(cursor, arrow, counts, enterIndex);
        cursorRef.current = next;
        // The cursor moves the view, not just a highlight: the current item is brought to the middle of the
        // reader and the rest of its column steps back (CSS on aria-current), so the eye follows the move.
        if (next.column === 'center') {
          clearSatelliteCurrent(leftAsideRef.current); clearSatelliteCurrent(rightAsideRef.current);
          article.focus({preventScroll: true});
          panStage(stageRef.current, scroller, null, smooth);
        } else {
          const els = next.column === 'left' ? leftEls : rightEls;
          const el = els[next.index];
          clearSatelliteCurrent(leftAsideRef.current); clearSatelliteCurrent(rightAsideRef.current);
          el?.setAttribute('aria-current', 'true');
          el?.focus({preventScroll: true});
          if (el) panStage(stageRef.current, scroller, el, smooth, cursor.column === 'center' ? 'x' : 'both');
        }
        return;
      }
      if (event.key === 'Enter') {
        const cursor = cursorRef.current;
        if (cursor.column === 'center') return; // Enter on the centre article does nothing
        const els = satellitesIn(cursor.column === 'left' ? leftAsideRef.current : rightAsideRef.current);
        const el = els[cursor.index];
        if (!el) return;
        event.preventDefault();
        activateSatellite(el);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reducedMotion]);

  const kindWord = target.kind === 'doc' && target.role === 'planet' ? '행성' : '항성';
  const crumb = `${target.categoryLabel} · ${kindWord}${target.kind === 'star-missing' || (target.kind === 'doc' && target.role === 'star') ? ` · 행성 ${target.planetCount}` : ''}`;

  return (
    <div ref={scrollerRef} className="universe-reader" role="dialog" aria-label={crumb}
      onClickCapture={event => {
        // Like explore mode: the first click on a satellite moves the view to it and makes it current; only a
        // click on the current satellite (or Enter) opens it. Clicking the article brings the cursor home.
        const scroller = scrollerRef.current; if (!scroller) return;
        const target = event.target instanceof HTMLElement ? event.target : null; if (!target) return;
        if (target.closest('a[href]')) return;
        const sat = target.closest<HTMLElement>('.universe-satellite');
        if (sat) {
          if (sat.getAttribute('aria-current') === 'true') return;
          event.preventDefault(); event.stopPropagation();
          const side = leftAsideRef.current?.contains(sat) ? 'left' : rightAsideRef.current?.contains(sat) ? 'right' : null;
          if (!side) return;
          const index = satellitesIn(side === 'left' ? leftAsideRef.current : rightAsideRef.current).indexOf(sat);
          cursorRef.current = {column: side, index: Math.max(0, index)};
          clearSatelliteCurrent(leftAsideRef.current); clearSatelliteCurrent(rightAsideRef.current);
          sat.setAttribute('aria-current', 'true'); sat.focus({preventScroll: true});
          panStage(stageRef.current, scroller, sat, !reducedMotion, 'x');
          return;
        }
        if (articleRef.current && articleRef.current.contains(target) && cursorRef.current.column !== 'center') {
          cursorRef.current = INITIAL_READER_CURSOR;
          clearSatelliteCurrent(leftAsideRef.current); clearSatelliteCurrent(rightAsideRef.current);
          panStage(stageRef.current, scroller, null, !reducedMotion);
        }
      }}
      onClick={event => { if (event.target === event.currentTarget || (event.target instanceof HTMLElement && event.target.classList.contains('universe-reader-stage'))) onClose(); }}>
      <div className="universe-reader-stage" ref={stageRef}>
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
            <aside ref={leftAsideRef} className="universe-satellites" data-side="left" aria-label="이력과 근거">{leftSatellites(loaded, onOpenVersion)}</aside>
            <article ref={articleRef} className="universe-doc" tabIndex={-1} aria-labelledby="universe-doc-title">
              {portrait(loaded.view.version.attributes)}
              {loaded.view.version.title
                ? <h2 className="universe-doc-title" id="universe-doc-title">{loaded.view.version.title}</h2>
                : <h2 className="universe-sr-only" id="universe-doc-title">제목 없는 기록</h2>}
              <div className="universe-doc-text">{renderCitedBody(loaded.view.version.body_text, loaded.citations, 'universe-cite', loaded.meanings)}</div>
              {/* 1-10: "원문" here used to sit right next to the quote-check line's promise that the server
                  never opens the source page — same screen, contradicting words. Renamed to what the raw link
                  actually is: the server's own stored text file, not "the original". */}
              <nav className="universe-doc-links" aria-label="문서 상세">
                <a href={`/versions/${encodeURIComponent(loaded.view.version.id)}`}>고정 링크</a>
                <span aria-hidden="true"> · </span>
                <a href={`/versions/${encodeURIComponent(loaded.view.version.id)}/raw`} target="_blank" rel="noreferrer">텍스트 파일</a>
                <span aria-hidden="true"> · </span>
                <a href={`/records/${encodeURIComponent(loaded.view.version.record_id)}/history`}>고친 이력</a>
              </nav>
            </article>
            <aside ref={rightAsideRef} className="universe-satellites" data-side="right" aria-label="관계와 검토">
              {reviewSatellite(loaded.dossier)}
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
    : <div key={key} className="universe-satellite" data-kind={kind} tabIndex={-1}>{content}</div>;
}

// ---- Keyboard-cursor helpers (used by the keydown handler above; kept out of the component body since they
// only ever touch the DOM, never React state). `.universe-satellite` covers both the buttons above (earlier
// versions, internal evidence with a source, relations, meanings with a linked concept) and the plain divs
// (external evidence, unlinked evidence/meanings, the review summary below) — the cursor visits every one of
// them, DOM order is column order, and Enter decides what (if anything) to do by what is actually inside.


// ---- View movement (mirrors the field's glide: easeInOutCubic, 420-900ms by distance) --------------------
// The reader behaves like the field's camera: moving the cursor pans the whole stage so the current item sits
// at the centre of the view, on both axes, without touching the article's own scroll position. Returning to
// the article pans back to the resting position.
function easeInOutCubic(t: number): number { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
let panRaf: number | null = null;
let panNow = {x: 0, y: 0};
/** `axis: 'x'` (entering a column from the article) moves sideways only and touches y just enough to keep the
 * item inside the view; `axis: 'both'` (Up/Down within a column) centres on both axes. */
function panStage(stage: HTMLElement | null, scroller: HTMLElement | null, el: HTMLElement | null, smooth: boolean, axis: 'x' | 'both' = 'both'): void {
  if (!stage) return;
  let target = {x: 0, y: 0};
  if (el && scroller) {
    const sr = scroller.getBoundingClientRect(), er = el.getBoundingClientRect();
    // er already includes the current pan; remove it to get the resting position, then aim at the centre.
    const restCx = (er.left + er.right) / 2 - panNow.x, restCy = (er.top + er.bottom) / 2 - panNow.y;
    const x = sr.left + sr.width / 2 - restCx;
    if (axis === 'both') target = {x, y: sr.top + sr.height / 2 - restCy};
    else {
      // Keep the current vertical pan; nudge only if the item would sit outside the view (24px margin).
      const margin = 24, top = er.top - panNow.y + panNow.y, bottom = er.bottom;
      let y = panNow.y;
      if (top < sr.top + margin) y += sr.top + margin - top;
      else if (bottom > sr.bottom - margin) y -= bottom - (sr.bottom - margin);
      target = {x, y};
    }
  }
  if (panRaf !== null) { cancelAnimationFrame(panRaf); panRaf = null; }
  const from = {...panNow};
  const dist = Math.hypot(target.x - from.x, target.y - from.y);
  const apply = (x: number, y: number) => { panNow = {x, y}; stage.style.transform = x === 0 && y === 0 ? '' : `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; };
  if (!smooth || dist < 2) { apply(target.x, target.y); return; }
  const duration = Math.max(420, Math.min(900, 420 + dist / 4));
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration), e = easeInOutCubic(t);
    apply(from.x + (target.x - from.x) * e, from.y + (target.y - from.y) * e);
    panRaf = t < 1 ? requestAnimationFrame(tick) : null;
  };
  panRaf = requestAnimationFrame(tick);
}

function satellitesIn(aside: HTMLElement | null): HTMLElement[] {
  return aside ? Array.from(aside.querySelectorAll<HTMLElement>('.universe-satellite')) : [];
}


/** Vertical reference for entering a side column: centre of the selected paragraph, else the view's middle
 * when the article has been scrolled, else null (nothing selected, nothing read yet → top item). */
function readingReferenceY(scroller: HTMLElement, article: HTMLElement, paragraph: number): number | null {
  if (paragraph >= 0) {
    const body = article.querySelector<HTMLElement>('.universe-doc-text');
    if (body) {
      const units = readingUnits({article: scroller, title: article.querySelector<HTMLElement>('.universe-doc-title'), body});
      const range = units[paragraph];
      if (range) { const r = range.getBoundingClientRect(); return (r.top + r.bottom) / 2; }
    }
  }
  if (scroller.scrollTop > 8) { const sr = scroller.getBoundingClientRect(); return sr.top + sr.height / 2; }
  return null;
}
function nearestIndexToY(elements: HTMLElement[], y: number): number {
  let best = 0, bestDist = Infinity;
  elements.forEach((el, index) => { const r = el.getBoundingClientRect(); const d = Math.abs((r.top + r.bottom) / 2 - y); if (d < bestDist) { bestDist = d; best = index; } });
  return best;
}

function clearSatelliteCurrent(aside: HTMLElement | null): void {
  aside?.querySelectorAll('[aria-current]').forEach(el => el.removeAttribute('aria-current'));
}

/** Enter on a focused satellite: a real `<button>` (earlier version, internal evidence, relation, linked
 * meaning) is simply clicked, which runs the same onClick the mouse would. A plain `<div>` that holds a link
 * (external evidence's source, the "더 있음" cap's full-context link) has that link clicked instead — for
 * external evidence this opens the source in a new tab, since the anchor itself already carries
 * target="_blank". A satellite with neither (the review summary, an evidence/meaning item with no source) has
 * nothing to activate: its `title` says so, and Enter does nothing beyond the scroll-into-view focus already gave it. */
function activateSatellite(el: HTMLElement): void {
  if (el instanceof HTMLButtonElement) { el.click(); return; }
  el.querySelector<HTMLAnchorElement>('a[href]')?.click();
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

/** The review summary as one cursor stop in the right column: a plain, non-actionable satellite (Enter does
 * nothing beyond the scroll-into-view its focus already gives it — the `title` says so for anyone hovering or
 * using a screen reader that surfaces it) wrapping the table itself. Only rendered when there is a dossier to
 * summarise, same condition reviewTable already used. */
function reviewSatellite(dossier: Dossier | null): ReactNode {
  const table = reviewTable(dossier);
  if (!table) return null;
  return <div key="review" className="universe-satellite" data-kind="review" tabIndex={-1} title="검토 요약 — Enter로 활성화되지 않음, 화면에 스크롤만 됩니다.">{table}</div>;
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
      ) : rows.length === 1 ? (
        // 1-9/3: one row reads better as a single inline line ("근거 뒷받침 — 반대 1") than as a whole table.
        <>
          <p className="universe-review-inline">{reviewInlineLine(rows[0], counts)}</p>
          {truncated && <p className="universe-review-note">50건까지만 셈</p>}
        </>
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
      {/* 1-6: two separate lines — a plain count, then (only when there is an anonymous count to explain) the
         caveat that anonymous submissions are not a count of distinct reviewers. Zero-count halves are dropped
         entirely, and no line at all shows when both are zero. */}
      {(keyedTotal > 0 || anonymousTotal > 0) && (
        <>
          <p className="universe-review-note-primary">
            {[keyedTotal > 0 ? `서명한 검토 ${keyedTotal}` : null, anonymousTotal > 0 ? `익명 검토 ${anonymousTotal}` : null].filter(Boolean).join(' · ')}
          </p>
          {anonymousTotal > 0 && <p className="universe-review-note">익명 검토는 몇 명이 했는지 알 수 없습니다.</p>}
        </>
      )}
    </div>
  );
}

function reviewInlineLine(row: {focus: ReviewFocus; label: string}, counts: Map<ReviewFocus, Record<ReviewStance, number>>): string {
  const c = counts.get(row.focus)!;
  const parts = REVIEW_STANCES.filter(({stance}) => c[stance] > 0).map(({stance, label}) => `${label} ${c[stance]}`);
  return `${row.label} — ${parts.join(' · ')}`;
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
