'use client';

import {useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent} from 'react';
import {
  loadSpatialHome,
  loadSpatialNeighbors,
  loadSpatialSearch,
  loadSpatialVersion,
  type SpatialNeighbor,
  type SpatialNode,
  type SpatialPage,
} from '../lib/spatial-data';
import {errorMessage} from '../lib/api-client';
import type {VersionView} from '../contracts/types';

const CELL_X = 430;
const CELL_Y = 300;
const DRAG_THRESHOLD = 7;
const SEARCH_DELAY = 1000;

type Point = {x: number; y: number};
type PositionedNode = SpatialNode & Point;
type ReaderState = {view: VersionView; neighbors: SpatialNeighbor[]; hasMore: boolean; direction: 'left' | 'right' | 'center'};

export function spatialCoordinate(index: number): Point {
  if (index === 0) return {x: 0, y: 0};
  let x = 0, y = 0, step = 1, used = 0, direction = 0;
  const vectors = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
  for (let current = 1; current <= index; current += 1) {
    const [dx, dy] = vectors[direction]; x += dx; y += dy; used += 1;
    if (used === step) { used = 0; direction = (direction + 1) % 4; if (direction === 0 || direction === 2) step += 1; }
  }
  return {x, y};
}

export function directionalNode(nodes: PositionedNode[], current: PositionedNode, key: string): PositionedNode | null {
  const candidates = nodes.filter(node => key === 'ArrowLeft' ? node.x < current.x : key === 'ArrowRight' ? node.x > current.x : key === 'ArrowUp' ? node.y < current.y : node.y > current.y);
  const axial = (node: PositionedNode) => key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(node.y - current.y) : Math.abs(node.x - current.x);
  const forward = (node: PositionedNode) => key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(node.x - current.x) : Math.abs(node.y - current.y);
  return candidates.sort((a, b) => axial(a) - axial(b) || forward(a) - forward(b) || a.key.localeCompare(b.key))[0] || null;
}

export default function SpatialExplorer() {
  const viewportRef = useRef<HTMLDivElement>(null), worldRef = useRef<HTMLDivElement>(null), dotsRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Point>({x: 0, y: 0}), frameRef = useRef<number | null>(null), inertiaRef = useRef<number | null>(null);
  const pointerRef = useRef<{id: number; startX: number; startY: number; lastX: number; lastY: number; lastAt: number; vx: number; vy: number; moved: boolean} | null>(null);
  const generationRef = useRef(0), selectedRef = useRef(0), nodesRef = useRef<PositionedNode[]>([]), suppressClickRef = useRef(false);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null), pageRequestRef = useRef<AbortController | null>(null), readerRequestRef = useRef<AbortController | null>(null);
  const [page, setPage] = useState<SpatialPage | null>(null), [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true), [failure, setFailure] = useState(''), [query, setQuery] = useState(''), [activeQuery, setActiveQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(true), [inputFocused, setInputFocused] = useState(false), [composing, setComposing] = useState(false);
  const [reader, setReader] = useState<ReaderState | null>(null), [readerLoading, setReaderLoading] = useState(false), [readerError, setReaderError] = useState('');
  const reducedMotion = useRef(false);
  const nodes = (page?.nodes || []).map((node, index) => ({...node, ...spatialCoordinate(index)}));
  nodesRef.current = nodes; selectedRef.current = Math.min(selected, Math.max(nodes.length - 1, 0));

  const paint = useCallback(() => {
    frameRef.current = null; const {x, y} = cameraRef.current;
    if (worldRef.current) worldRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (dotsRef.current) dotsRef.current.style.backgroundPosition = `${x * .09}px ${y * .09}px`;
    const viewport = viewportRef.current; if (!viewport) return;
    const cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2;
    let nearest = 0, best = Infinity;
    nodesRef.current.forEach((node, index) => {
      const distance = Math.hypot(cx - (cx + node.x * CELL_X + x), cy - (cy + node.y * CELL_Y + y));
      const element = worldRef.current?.children[index] as HTMLElement | undefined;
      element?.style.setProperty('--node-light', String(Math.max(.34, 1 - distance / 920)));
      if (distance < best) { best = distance; nearest = index; }
    });
    if (nearest !== selectedRef.current) { selectedRef.current = nearest; setSelected(nearest); }
  }, []);

  const schedulePaint = useCallback(() => { if (frameRef.current === null) frameRef.current = requestAnimationFrame(paint); }, [paint]);
  const stopMotion = useCallback(() => { if (inertiaRef.current !== null) cancelAnimationFrame(inertiaRef.current); inertiaRef.current = null; }, []);
  const markActive = useCallback(() => {
    setSearchVisible(false); if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => setSearchVisible(true), 2000);
  }, []);
  const center = useCallback((index: number, smooth = true) => {
    const node = nodesRef.current[index]; if (!node) return; stopMotion();
    const target = {x: -node.x * CELL_X, y: -node.y * CELL_Y};
    if (!smooth || reducedMotion.current) { cameraRef.current = target; schedulePaint(); return; }
    const start = {...cameraRef.current}, began = performance.now();
    const tick = (now: number) => { const t = Math.min(1, (now - began) / 380), eased = 1 - Math.pow(1 - t, 3); cameraRef.current = {x: start.x + (target.x - start.x) * eased, y: start.y + (target.y - start.y) * eased}; schedulePaint(); if (t < 1) inertiaRef.current = requestAnimationFrame(tick); else inertiaRef.current = null; };
    inertiaRef.current = requestAnimationFrame(tick);
  }, [schedulePaint, stopMotion]);

  const loadPage = useCallback(async (nextQuery: string) => {
    const generation = ++generationRef.current; setLoading(true); setFailure(''); setActiveQuery(nextQuery.trim()); stopMotion();
    pageRequestRef.current?.abort(); const controller = new AbortController(); pageRequestRef.current = controller;
    try {
      const result = nextQuery.trim() ? await loadSpatialSearch(nextQuery, {scope: 'current', limit: 20, include_context: true}, controller.signal) : await loadSpatialHome(controller.signal);
      if (generation !== generationRef.current) return; setPage(result); setSelected(0); selectedRef.current = 0; cameraRef.current = {x: 0, y: 0}; requestAnimationFrame(paint);
    } catch (error) { if (generation === generationRef.current) setFailure(errorMessage(error) || '문서 공간을 불러오지 못했습니다.'); }
    finally { if (generation === generationRef.current) setLoading(false); }
  }, [paint, stopMotion]);

  useEffect(() => { reducedMotion.current = matchMedia('(prefers-reduced-motion: reduce)').matches; void loadPage(''); return () => { generationRef.current += 1; stopMotion(); if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); if (idleRef.current) clearTimeout(idleRef.current); pageRequestRef.current?.abort(); readerRequestRef.current?.abort(); }; }, [loadPage, stopMotion]);
  useEffect(() => { const resize = () => schedulePaint(); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, [schedulePaint]);

  const openNode = useCallback(async (node: SpatialNode, direction: 'left' | 'right' | 'center' = 'center') => {
    if (node.target.kind !== 'version') { window.location.assign(node.href); return; }
    readerRequestRef.current?.abort(); const controller = new AbortController(); readerRequestRef.current = controller; setReaderLoading(true); setReaderError('');
    try { const [view, neighborResult] = await Promise.all([loadSpatialVersion(node.target.id, controller.signal), loadSpatialNeighbors(node.target, {displayLimit: 12}, controller.signal)]); if (!controller.signal.aborted) { setReader({view, neighbors: neighborResult.items, hasMore: neighborResult.hasMore, direction}); setReaderLoading(false); } }
    catch (error) { if (!controller.signal.aborted) { setReaderError(errorMessage(error) || '문서를 열지 못했습니다.'); setReaderLoading(false); } }
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => { if (reader || event.button !== 0) return; stopMotion(); event.currentTarget.setPointerCapture(event.pointerId); pointerRef.current = {id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, lastAt: performance.now(), vx: 0, vy: 0, moved: false}; markActive(); };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => { const pointer = pointerRef.current; if (!pointer || pointer.id !== event.pointerId) return; const now = performance.now(), dx = event.clientX - pointer.lastX, dy = event.clientY - pointer.lastY, dt = Math.max(now - pointer.lastAt, 1); pointer.vx = dx / dt * 16; pointer.vy = dy / dt * 16; pointer.lastX = event.clientX; pointer.lastY = event.clientY; pointer.lastAt = now; pointer.moved ||= Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) >= DRAG_THRESHOLD; cameraRef.current.x += dx; cameraRef.current.y += dy; schedulePaint(); };
  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => { const pointer = pointerRef.current; if (!pointer || pointer.id !== event.pointerId) return; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); pointerRef.current = null; suppressClickRef.current = pointer.moved; if (pointer.moved) setTimeout(() => { suppressClickRef.current = false; }, 0); if (cancelled || !pointer.moved || reducedMotion.current) return; let vx = pointer.vx, vy = pointer.vy; const tick = () => { vx *= .92; vy *= .92; cameraRef.current.x += vx; cameraRef.current.y += vy; schedulePaint(); if (Math.hypot(vx, vy) > .35) inertiaRef.current = requestAnimationFrame(tick); else inertiaRef.current = null; }; inertiaRef.current = requestAnimationFrame(tick); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { const target = event.target instanceof HTMLElement ? event.target : null; if (reader || composing || event.isComposing || target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return; if (event.key === 'Enter') { const node = nodesRef.current[selectedRef.current]; if (node) { event.preventDefault(); void openNode(node); } return; } if (!event.key.startsWith('Arrow')) return; const current = nodesRef.current[selectedRef.current], next = current && directionalNode(nodesRef.current, current, event.key); if (next) { event.preventDefault(); const index = nodesRef.current.indexOf(next); setSelected(index); selectedRef.current = index; center(index); markActive(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [center, composing, markActive, openNode, reader]);

  const submit = (event: FormEvent) => { event.preventDefault(); void loadPage(query); };
  useEffect(() => { if (composing || query.trim() === activeQuery) return; const timer = setTimeout(() => void loadPage(query), SEARCH_DELAY); return () => clearTimeout(timer); }, [activeQuery, composing, loadPage, query]);

  const selectedNode = nodes[selected];
  return <main className="spatial-explorer" aria-busy={loading}>
    <h1 className="sr-only">Morum 문서 공간</h1>
    <div className="spatial-dots" ref={dotsRef}/>
    <div className="spatial-viewport" ref={viewportRef} tabIndex={-1} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={event => finishPointer(event)} onPointerCancel={event => finishPointer(event, true)}>
      <div className="spatial-world" ref={worldRef}>{nodes.map((node, index) => <button key={node.key} type="button" className="spatial-node" data-selected={index === selected} style={{'--grid-x': node.x, '--grid-y': node.y} as CSSProperties} onClick={() => { if (suppressClickRef.current) return; if (index !== selectedRef.current) { setSelected(index); selectedRef.current = index; center(index); } else void openNode(node); }}><span className="spatial-node-title">{node.title}</span><span className="spatial-node-copy">{node.snippet || '내용 미리보기가 없습니다.'}</span><span className="spatial-node-meta">{node.versionState === 'current' ? '현재 버전' : node.versionState === 'historical' ? '과거 버전' : '문서'}</span></button>)}</div>
    </div>
    <div className="spatial-status" aria-live="polite">{loading ? '문서 공간을 불러오는 중…' : failure ? <><span>{failure}</span><button type="button" onClick={() => void loadPage(activeQuery)}>다시 시도</button></> : !nodes.length ? (activeQuery ? '검색 결과가 없습니다.' : '아직 공개된 기록이 없습니다.') : <>{activeQuery ? `“${activeQuery}” 검색 결과 · ${nodes.length}개` : `최근 문서 · ${nodes.length}개`}{page?.hasMore ? ' · 더 있음' : ''}</>}</div>
    <form className="spatial-search" data-hidden={!searchVisible && !inputFocused} onSubmit={submit}><label className="sr-only" htmlFor="spatial-query">지식 검색</label><input id="spatial-query" value={query} onChange={event => setQuery(event.target.value)} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} onCompositionStart={() => setComposing(true)} onCompositionEnd={event => { setComposing(false); setQuery(event.currentTarget.value); }} placeholder="문서와 맥락 검색" autoComplete="off"/><button type="submit">검색</button></form>
    {(reader || readerLoading || readerError) && <SpatialReader state={reader} loading={readerLoading} error={readerError} onClose={() => { readerRequestRef.current?.abort(); setReader(null); setReaderError(''); setReaderLoading(false); viewportRef.current?.focus(); }} onOpen={(node, direction) => void openNode(node, direction)}/>} 
    {selectedNode && <p className="sr-only" aria-live="polite">선택됨: {selectedNode.title}</p>}
  </main>;
}

function SpatialReader({state, loading, error, onClose, onOpen}: {state: ReaderState | null; loading: boolean; error: string; onClose: () => void; onOpen: (node: SpatialNode, direction: 'left' | 'right') => void}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  const left = state?.neighbors.filter(item => item.side === 'left').slice(0, 4) || [], right = state?.neighbors.filter(item => item.side === 'right').slice(0, 4) || [], context = state?.neighbors.filter(item => item.side === 'context').slice(0, 4) || [];
  return <section className="spatial-reader" data-direction={state?.direction || 'center'} aria-modal="true" role="dialog" aria-labelledby="spatial-reader-title"><button ref={closeRef} className="spatial-close" type="button" onClick={onClose} aria-label="읽기 닫기">×</button>{loading ? <p role="status" className="reader-message">문서를 불러오는 중…</p> : error ? <div className="reader-message" role="alert"><p>{error}</p><button type="button" onClick={onClose}>문서 공간으로 돌아가기</button></div> : state && <div className="reader-stage"><RelationColumn label="근거와 상위 맥락" items={left} direction="left" onOpen={onOpen}/><article className="reader-document"><p className="reader-eyebrow">버전 {state.view.version.version_no}{state.view.is_current ? ' · 현재' : ' · 과거'}</p><h2 id="spatial-reader-title">{state.view.version.title || '제목 없는 기록'}</h2><p className="reader-body">{state.view.version.body_text}</p><nav className="reader-links" aria-label="문서 상세"><a href={`/versions/${encodeURIComponent(state.view.version.id)}`}>고정 링크와 전체 맥락</a><a href={`/versions/${encodeURIComponent(state.view.version.id)}/raw`} target="_blank" rel="noreferrer">원문</a><a href={`/records/${encodeURIComponent(state.view.version.record_id)}/history`}>이력</a></nav>{context.length > 0 && <div className="reader-context"><h3>기타 관계</h3>{context.map(item => <a key={item.relation.id} href={item.node.href}>{relationLabel(item)} · {item.node.title}</a>)}</div>}{state.hasMore && <p className="reader-more">표시되지 않은 관계는 전체 맥락에서 볼 수 있습니다.</p>}</article><RelationColumn label="파생과 정정" items={right} direction="right" onOpen={onOpen}/></div>}</section>;
}

function relationLabel(item: SpatialNeighbor) { const labels: Record<string, string> = {supports: '지지', corrects: '정정', depends_on: '의존', derived_from: '파생', contradicts: '반론', defines: '정의', related_to: '관련', same_meaning_as: '같은 의미', translation_of: '번역'}; return labels[item.relation.predicate] || item.relation.predicate; }
function RelationColumn({label, items, direction, onOpen}: {label: string; items: SpatialNeighbor[]; direction: 'left' | 'right'; onOpen: (node: SpatialNode, direction: 'left' | 'right') => void}) { return <aside className={`reader-relations reader-relations-${direction}`} aria-label={label}><h3>{label}</h3>{items.length ? items.map(item => <button type="button" key={item.relation.id} onClick={() => onOpen(item.node, direction)}><span>{relationLabel(item)}</span>{item.node.title}</button>) : <p>표시할 관계가 없습니다.</p>}</aside>; }
