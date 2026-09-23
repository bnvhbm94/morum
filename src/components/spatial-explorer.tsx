'use client';

import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type PointerEvent as ReactPointerEvent} from 'react';
import {
  loadSpatialHome,
  loadSpatialContextMany,
  loadSpatialNeighbors,
  loadSpatialSearch,
  loadSpatialVersion,
  loadSpatialHistory,
  loadSpatialCitations,
  type Citation,
  layoutEdges,
  layoutNodes,
  groupGalaxies,
  placeGalaxy,
  type Galaxy,
  type MidPlacement,
  type LayoutEdge,
  type SpatialNeighbor,
  type SpatialNode,
  type SpatialPage,
} from '../lib/spatial-data';
import {errorMessage} from '../lib/api-client';
import type {ContentRef, Relation, ReviewSummary, Version, VersionView} from '../contracts/types';

const CELL_X = 430;
const CELL_Y = 300;
const DRAG_THRESHOLD = 7;
const DOUBLE_TAP = 340;
const MAX_FLICK = 60;
const SEARCH_DELAY = 1000;
const WHEEL_IN = -240;
const WHEEL_OUT = 240;
const WHEEL_COOLDOWN = 700;
const WHEEL_IDLE_RESET = 250;
const SATELLITE_CAP = 6;
const SATELLITE_STEP = 0.55;

type Point = {x: number; y: number};

type Level =
  | {kind: 'far'}
  | {kind: 'mid'; galaxyKey: string}
  | {kind: 'near'; galaxyKey: string | null; node: SpatialNode};

type FarItem = {kind: 'galaxy'; key: string; x: number; y: number; galaxy: Galaxy};
type MidItem = {kind: 'mid'; key: string; x: number; y: number; node: SpatialNode; foreign: boolean; dim: boolean};
type PlanetItem = {kind: 'planet'; key: string; x: number; y: number; node: SpatialNode};
type SatelliteItem = {kind: 'satellite'; key: string; x: number; y: number; satellite: Satellite};
type Item = FarItem | MidItem | PlanetItem | SatelliteItem;

type Satellite =
  | {kind: 'version'; caption: string; version: Version; node: SpatialNode}
  | {kind: 'evidence'; caption: string; citation: Citation}
  | {kind: 'relation'; caption: string; neighbor: SpatialNeighbor}
  | {kind: 'review'; caption: string; summary: ReviewSummary}
  | {kind: 'empty'; caption: string}
  | {kind: 'more'; caption: string; versionId: string};

type NearState = {
  citations: Citation[];
  view: VersionView;
  neighbors: SpatialNeighbor[];
  hasMoreNeighbors: boolean;
  history: Version[];
};

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

export function directionalNode<T extends {key: string; x: number; y: number}>(nodes: T[], current: T, key: string): T | null {
  const candidates = nodes.filter(node => key === 'ArrowLeft' ? node.x < current.x : key === 'ArrowRight' ? node.x > current.x : key === 'ArrowUp' ? node.y < current.y : node.y > current.y);
  const axial = (node: T) => key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(node.y - current.y) : Math.abs(node.x - current.x);
  const forward = (node: T) => key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(node.x - current.x) : Math.abs(node.y - current.y);
  return candidates.sort((a, b) => axial(a) - axial(b) || forward(a) - forward(b) || a.key.localeCompare(b.key))[0] || null;
}

function relationLabel(predicate: string): string {
  const labels: Record<string, string> = {supports: '지지', corrects: '정정', depends_on: '의존', derived_from: '파생', contradicts: '반론', defines: '정의', related_to: '관련', same_meaning_as: '같은 의미', translation_of: '번역'};
  return labels[predicate] || predicate;
}

function parseLevelFromLocation(): {galaxy: string | null; doc: string | null; q: string | null} {
  if (typeof window === 'undefined') return {galaxy: null, doc: null, q: null};
  const params = new URLSearchParams(window.location.search);
  return {galaxy: params.get('galaxy'), doc: params.get('doc'), q: params.get('q')};
}

function buildUrl(level: Level, query: string): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (level.kind === 'mid' && level.galaxyKey) params.set('galaxy', level.galaxyKey);
  if (level.kind === 'near') {
    if (level.galaxyKey) params.set('galaxy', level.galaxyKey);
    params.set('doc', level.node.target.id);
  }
  const search = params.toString();
  return search ? `/?${search}` : '/';
}

function synthesizeVersionNode(id: string): SpatialNode {
  const target: ContentRef = {kind: 'version', id};
  return {
    key: `version:${id}`,
    target,
    locator: {kind: 'object', target},
    locators: [{kind: 'object', target}],
    title: '',
    snippet: '',
    href: `/versions/${encodeURIComponent(id)}`,
    isCurrent: null,
    versionState: 'unknown',
    score: null,
    syntheticDemo: false,
    topic: null,
    untitled: true,
    duplicateOf: null,
  };
}

export default function SpatialExplorer() {
  const viewportRef = useRef<HTMLDivElement>(null), worldRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Point>({x: 0, y: 0}), frameRef = useRef<number | null>(null), inertiaRef = useRef<number | null>(null);
  const pointerRef = useRef<{id: number; startX: number; startY: number; lastX: number; lastY: number; lastAt: number; vx: number; vy: number; moved: boolean; samples: {dx: number; dy: number; dt: number; at: number}[]} | null>(null);
  const generationRef = useRef(0), selectedRef = useRef(0), itemsRef = useRef<Item[]>([]), suppressClickRef = useRef(false);
  const lastTapRef = useRef<{index: number; at: number} | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRequestRef = useRef<AbortController | null>(null), nearRequestRef = useRef<AbortController | null>(null);
  const wheelAccumRef = useRef(0), wheelAtRef = useRef(0), wheelLockUntilRef = useRef(0);
  const ownPushCountRef = useRef(0);
  const activeQueryRef = useRef('');
  const restoredRef = useRef(false);

  const [level, setLevel] = useState<Level>({kind: 'far'});
  const [homePage, setHomePage] = useState<SpatialPage | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [relationsFailed, setRelationsFailed] = useState(false);
  const [searchPage, setSearchPage] = useState<SpatialPage | null>(null);
  const [searchRelations, setSearchRelations] = useState<Relation[]>([]);
  const [searchRelationsFailed, setSearchRelationsFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(true), [inputFocused, setInputFocused] = useState(false), [composing, setComposing] = useState(false);
  const [selected, setSelected] = useState(0);
  const [near, setNear] = useState<NearState | null>(null);
  const [nearLoading, setNearLoading] = useState(false);
  const [nearError, setNearError] = useState('');
  const [pageGeneration, setPageGeneration] = useState(0);
  const reducedMotion = useRef(false);

  activeQueryRef.current = activeQuery;
  const homePageRef = useRef<SpatialPage | null>(null), searchPageRef = useRef<SpatialPage | null>(null);
  homePageRef.current = homePage; searchPageRef.current = searchPage;

  const galaxies = useMemo(() => groupGalaxies(homePage?.nodes || []), [homePage]);

  const items: Item[] = useMemo(() => {
    if (level.kind === 'far') {
      return layoutNodes(galaxies, [], spatialCoordinate).map((galaxy): FarItem => ({kind: 'galaxy', key: galaxy.key, x: galaxy.x, y: galaxy.y, galaxy}));
    }
    if (level.kind === 'mid') {
      if (activeQuery) {
        const nodes = searchPage?.nodes || [];
        const keys = new Set(nodes.map(node => node.key));
        const edges: LayoutEdge[] = layoutEdges(searchRelations, keys);
        const dimmed = new Set(searchRelations.filter(relation => relation.predicate === 'corrects' && relation.to.kind === 'version').map(relation => `version:${relation.to.id}`));
        return layoutNodes(nodes, edges, spatialCoordinate).map((node): MidItem => ({kind: 'mid', key: node.key, x: node.x, y: node.y, node, foreign: false, dim: dimmed.has(node.key)}));
      }
      const galaxy = galaxies.find(candidate => candidate.key === level.galaxyKey);
      if (!galaxy) return [];
      const placements: MidPlacement[] = placeGalaxy(galaxy, homePage?.nodes || [], relations, spatialCoordinate);
      return placements.map((placement): MidItem => ({kind: 'mid', key: placement.node.key, x: placement.x, y: placement.y, node: placement.node, foreign: placement.foreign, dim: placement.dim}));
    }
    const planet: PlanetItem = {kind: 'planet', key: level.node.key, x: 0, y: 0, node: level.node};
    if (!near) return [planet];
    const satellites = buildSatellites(near, level.node);
    return [planet, ...satellites];
  }, [level, galaxies, homePage, relations, searchPage, searchRelations, activeQuery, near]);

  itemsRef.current = items;
  selectedRef.current = Math.min(selected, Math.max(items.length - 1, 0));

  const paint = useCallback(() => {
    frameRef.current = null; const {x, y} = cameraRef.current;
    if (worldRef.current) worldRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const viewport = viewportRef.current; if (!viewport) return;
    const cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2;
    let nearest = 0, best = Infinity;
    itemsRef.current.forEach((item, index) => {
      const distance = Math.hypot(cx - (cx + item.x * CELL_X + x), cy - (cy + item.y * CELL_Y + y));
      const element = worldRef.current?.querySelector<HTMLElement>(`[data-item-index="${index}"]`) ?? undefined;
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
    const item = itemsRef.current[index]; if (!item) return; stopMotion();
    const target = {x: -item.x * CELL_X, y: -item.y * CELL_Y};
    if (!smooth || reducedMotion.current) { cameraRef.current = target; schedulePaint(); return; }
    const start = {...cameraRef.current}, began = performance.now();
    const tick = (now: number) => { const t = Math.min(1, (now - began) / 380), eased = 1 - Math.pow(1 - t, 3); cameraRef.current = {x: start.x + (target.x - start.x) * eased, y: start.y + (target.y - start.y) * eased}; schedulePaint(); if (t < 1) inertiaRef.current = requestAnimationFrame(tick); else inertiaRef.current = null; };
    inertiaRef.current = requestAnimationFrame(tick);
  }, [schedulePaint, stopMotion]);

  const navigateTo = useCallback((next: Level, options?: {replace?: boolean}) => {
    if (typeof window !== 'undefined') {
      const url = buildUrl(next, activeQueryRef.current);
      if (options?.replace) window.history.replaceState({own: true}, '', url);
      else { window.history.pushState({own: true}, '', url); ownPushCountRef.current += 1; }
    }
    setLevel(next); stopMotion(); lastTapRef.current = null;
    selectedRef.current = 0; setSelected(0);
    setPageGeneration(value => value + 1);
  }, [stopMotion]);

  const loadHome = useCallback(async (signal: AbortSignal) => {
    const result = await loadSpatialHome(signal);
    setHomePage(result); setRelations([]); setRelationsFailed(false);
    if (result.nodes.length) {
      loadSpatialContextMany(result.nodes.slice(0, 5).map(node => node.target), 1, signal)
        .then(context => setRelations(context.relations ?? []))
        .catch(() => setRelationsFailed(true));
    }
    return result;
  }, []);

  const runSearch = useCallback(async (text: string, signal: AbortSignal) => {
    const searchResult = await loadSpatialSearch(text, {scope: 'current', limit: 20, include_context: true}, signal);
    setSearchPage(searchResult); setSearchRelations(searchResult.response.context?.relations ?? []); setSearchRelationsFailed(false);
    return searchResult;
  }, []);

  const loadPage = useCallback(async (nextQuery: string) => {
    const generation = ++generationRef.current; setLoading(true); setFailure('');
    const trimmed = nextQuery.trim();
    setActiveQuery(trimmed); activeQueryRef.current = trimmed;
    pageRequestRef.current?.abort(); const controller = new AbortController(); pageRequestRef.current = controller;
    try {
      if (trimmed) {
        await runSearch(trimmed, controller.signal);
        if (generation !== generationRef.current) return;
        navigateTo({kind: 'mid', galaxyKey: ''});
      } else {
        await loadHome(controller.signal);
        if (generation !== generationRef.current) return;
        navigateTo({kind: 'far'});
      }
    } catch (error) { if (generation === generationRef.current) setFailure(errorMessage(error) || '문서 공간을 불러오지 못했습니다.'); }
    finally { if (generation === generationRef.current) setLoading(false); }
  }, [loadHome, navigateTo, runSearch]);

  useEffect(() => { if (pageGeneration > 0) center(0); }, [center, pageGeneration]);

  const enterNode = useCallback((node: SpatialNode, galaxyKey: string | null) => {
    if (node.target.kind !== 'version') { window.location.assign(node.href); return; }
    navigateTo({kind: 'near', galaxyKey, node});
  }, [navigateTo]);

  useEffect(() => {
    if (level.kind !== 'near') return;
    if (level.node.target.kind !== 'version') return;
    const target = level.node.target;
    nearRequestRef.current?.abort(); const controller = new AbortController(); nearRequestRef.current = controller;
    setNearLoading(true); setNearError(''); setNear(null);
    (async () => {
      try {
        const [view, neighborResult] = await Promise.all([
          loadSpatialVersion(target.id, controller.signal),
          loadSpatialNeighbors(target, {displayLimit: 12}, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const [history, citations] = await Promise.all([
          loadSpatialHistory(view.version.record_id, controller.signal),
          loadSpatialCitations(view, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setNear({view, neighbors: neighborResult.items, hasMoreNeighbors: neighborResult.hasMore, history, citations});
        setNearLoading(false);
      } catch (error) {
        if (!controller.signal.aborted) { setNearError(errorMessage(error) || '문서를 열지 못했습니다.'); setNearLoading(false); }
      }
    })();
    return () => controller.abort();
  }, [level]);

  // Restore from URL on mount, then handle popstate.
  useEffect(() => {
    reducedMotion.current = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const controller = new AbortController(); pageRequestRef.current = controller;
    const {galaxy, doc, q} = parseLevelFromLocation();
    (async () => {
      try {
        if (q) {
          setQuery(q); setActiveQuery(q); activeQueryRef.current = q;
          const searchResult = await runSearch(q, controller.signal);
          if (doc) {
            const found = searchResult.nodes.find(node => node.target.kind === 'version' && node.target.id === doc);
            let node = found;
            if (!node) { const view = await loadSpatialVersion(doc, controller.signal); node = nodeFromVersionView(view); }
            setLevel({kind: 'near', galaxyKey: galaxy, node});
          } else {
            setLevel({kind: 'mid', galaxyKey: ''});
          }
        } else {
          const home = await loadHome(controller.signal);
          if (doc) {
            const found = home.nodes.find(node => node.target.kind === 'version' && node.target.id === doc);
            let node = found;
            if (!node) { const view = await loadSpatialVersion(doc, controller.signal); node = nodeFromVersionView(view); }
            setLevel({kind: 'near', galaxyKey: galaxy, node});
          } else if (galaxy && groupGalaxies(home.nodes).some(candidate => candidate.key === galaxy)) {
            setLevel({kind: 'mid', galaxyKey: galaxy});
          } else {
            setLevel({kind: 'far'});
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) setFailure(errorMessage(error) || '문서 공간을 불러오지 못했습니다.');
      } finally {
        if (!controller.signal.aborted) { setLoading(false); restoredRef.current = true; setPageGeneration(value => value + 1); }
      }
    })();
    const onPopState = () => {
      ownPushCountRef.current = Math.max(0, ownPushCountRef.current - 1);
      const {galaxy: g, doc: d, q: query2} = parseLevelFromLocation();
      setActiveQuery(query2 || ''); activeQueryRef.current = query2 || ''; setQuery(query2 || '');
      if (d) {
        const pool = [...(homePageRef.current?.nodes || []), ...(searchPageRef.current?.nodes || [])];
        const found = pool.find(node => node.target.kind === 'version' && node.target.id === d) || synthesizeVersionNode(d);
        setLevel({kind: 'near', galaxyKey: g, node: found});
      } else if (query2) {
        setLevel({kind: 'mid', galaxyKey: ''});
        void runSearch(query2, new AbortController().signal);
      } else if (g) {
        setLevel({kind: 'mid', galaxyKey: g});
      } else {
        setLevel({kind: 'far'});
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      generationRef.current += 1; stopMotion();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (idleRef.current) clearTimeout(idleRef.current);
      pageRequestRef.current?.abort(); nearRequestRef.current?.abort();
      window.removeEventListener('popstate', onPopState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { const resize = () => schedulePaint(); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, [schedulePaint]);

  const goIn = useCallback((index: number) => {
    const item = itemsRef.current[index]; if (!item) return;
    if (item.kind === 'galaxy') { navigateTo({kind: 'mid', galaxyKey: item.galaxy.key}); return; }
    if (item.kind === 'mid') { enterNode(item.node, level.kind === 'mid' && !activeQueryRef.current ? level.galaxyKey : null); return; }
    if (item.kind === 'satellite') { activateSatellite(item.satellite, level, enterNode); }
  }, [enterNode, level, navigateTo]);

  const goOut = useCallback((useHistory: boolean) => {
    // A document opened from /universe returns there instead of to this explorer's galaxy level.
    if (level.kind === 'near' && ownPushCountRef.current === 0 && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('from') === 'universe') {
      window.history.back(); return;
    }
    let target: Level;
    if (level.kind === 'near') {
      target = level.galaxyKey || activeQueryRef.current ? {kind: 'mid', galaxyKey: level.galaxyKey || ''} : {kind: 'far'};
    } else if (level.kind === 'mid') {
      if (activeQueryRef.current) { setQuery(''); setActiveQuery(''); activeQueryRef.current = ''; }
      target = {kind: 'far'};
    } else {
      return;
    }
    if (useHistory && ownPushCountRef.current > 0 && typeof window !== 'undefined') {
      ownPushCountRef.current -= 1; window.history.back(); setLevel(target); stopMotion(); selectedRef.current = 0; setSelected(0); setPageGeneration(value => value + 1);
    } else {
      navigateTo(target, {replace: true});
    }
  }, [level, navigateTo, stopMotion]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof HTMLElement && event.target.closest('.spatial-planet')) return;
    stopMotion(); pointerRef.current = {id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, lastAt: performance.now(), vx: 0, vy: 0, moved: false, samples: []}; markActive();
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => { const pointer = pointerRef.current; if (!pointer || pointer.id !== event.pointerId) return; const now = performance.now(), dx = event.clientX - pointer.lastX, dy = event.clientY - pointer.lastY, dt = Math.max(now - pointer.lastAt, 1); pointer.samples.push({dx, dy, dt, at: now}); if (pointer.samples.length > 3) pointer.samples.shift(); pointer.vx = dx / dt * 16; pointer.vy = dy / dt * 16; pointer.lastX = event.clientX; pointer.lastY = event.clientY; pointer.lastAt = now; const wasMoved = pointer.moved; pointer.moved ||= Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) >= DRAG_THRESHOLD; if (pointer.moved && !wasMoved) { try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already released */ } } cameraRef.current.x += dx; cameraRef.current.y += dy; schedulePaint(); };
  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const pointer = pointerRef.current; if (!pointer || pointer.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    pointerRef.current = null; suppressClickRef.current = pointer.moved;
    if (pointer.moved) { lastTapRef.current = null; setTimeout(() => { suppressClickRef.current = false; }, 0); }
    if (cancelled || !pointer.moved || reducedMotion.current) return;
    const now = performance.now();
    const recent = pointer.samples.filter(sample => now - sample.at <= 80);
    let vx = 0, vy = 0;
    if (recent.length) {
      const weights = [2, 1, 1];
      const recentTail = recent.slice(-3);
      let sumDx = 0, sumDy = 0, sumDt = 0;
      recentTail.reverse().forEach((sample, index) => { const weight = weights[index] ?? 1; sumDx += sample.dx * weight; sumDy += sample.dy * weight; sumDt += sample.dt * weight; });
      if (sumDt > 0) { vx = sumDx / sumDt * 16; vy = sumDy / sumDt * 16; }
    }
    const speed = Math.hypot(vx, vy); if (speed > MAX_FLICK) { vx = vx / speed * MAX_FLICK; vy = vy / speed * MAX_FLICK; }
    const tick = () => { vx *= .92; vy *= .92; cameraRef.current.x += vx; cameraRef.current.y += vy; schedulePaint(); if (Math.hypot(vx, vy) > .35) inertiaRef.current = requestAnimationFrame(tick); else inertiaRef.current = null; };
    inertiaRef.current = requestAnimationFrame(tick);
  };
  // Wheel = semantic zoom only while browsing galaxies or documents. While reading (near) the wheel
  // is left to the document's own scrolling: trackpad momentum outside the text must never "go out".
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (level.kind === 'near') return;
    if (event.target instanceof HTMLElement && event.target.closest('.spatial-planet')) return;
    const now = performance.now();
    if (now < wheelLockUntilRef.current) return;
    if (now - wheelAtRef.current > WHEEL_IDLE_RESET) wheelAccumRef.current = 0;
    wheelAtRef.current = now;
    wheelAccumRef.current += event.deltaY;
    if (wheelAccumRef.current <= WHEEL_IN) { wheelAccumRef.current = 0; wheelLockUntilRef.current = now + WHEEL_COOLDOWN; goIn(selectedRef.current); }
    else if (wheelAccumRef.current >= WHEEL_OUT) { wheelAccumRef.current = 0; wheelLockUntilRef.current = now + WHEEL_COOLDOWN; goOut(true); }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (composing || event.isComposing || target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      if (event.key === 'Enter') { event.preventDefault(); goIn(selectedRef.current); return; }
      if (event.key === 'Escape' || event.key === 'Backspace') { event.preventDefault(); goOut(true); return; }
      if (!event.key.startsWith('Arrow')) return;
      const current = itemsRef.current[selectedRef.current], next = current && directionalNode(itemsRef.current, current, event.key);
      if (next) { event.preventDefault(); const index = itemsRef.current.indexOf(next); setSelected(index); selectedRef.current = index; center(index); markActive(); lastTapRef.current = null; }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [center, composing, goIn, goOut, markActive]);

  const submit = (event: FormEvent) => { event.preventDefault(); void loadPage(query); };
  useEffect(() => { if (!restoredRef.current || composing || query.trim() === activeQuery) return; const timer = setTimeout(() => void loadPage(query), SEARCH_DELAY); return () => clearTimeout(timer); }, [activeQuery, composing, loadPage, query]);

  const selectedItem = items[selected];
  const activeCite = selectedItem?.kind === 'satellite' && selectedItem.satellite.kind === 'evidence' ? selectedItem.satellite.citation.index : null;
  const dockHidden = !searchVisible && !inputFocused && !loading && !failure;

  const crumb: ReactNode = loading ? '불러오는 중…'
    : failure ? <><span>{failure}</span><button type="button" onClick={() => void loadPage(activeQuery)}>다시 시도</button></>
    : level.kind === 'far' ? (activeQuery ? '' : (homePage && homePage.nodes.length === 0 ? '아직 공개된 기록이 없습니다.' : ''))
    : activeQuery
      ? (searchPage && searchPage.nodes.length === 0 ? `“${activeQuery}” 검색 결과가 없습니다.` : <>검색 › “{activeQuery}” · {searchPage?.nodes.length ?? 0}편{searchRelationsFailed ? ' · 관계 정보를 불러오지 못함' : ''}</>)
      : level.kind === 'mid'
        ? <><button type="button" onClick={() => goOut(false)}>은하</button> › {galaxies.find(g => g.key === level.galaxyKey)?.label ?? ''}</>
        : <><button type="button" onClick={() => navigateTo({kind: 'far'})}>은하</button> › {level.galaxyKey ? <button type="button" onClick={() => navigateTo({kind: 'mid', galaxyKey: level.galaxyKey as string})}>{galaxies.find(g => g.key === level.galaxyKey)?.label ?? ''}</button> : null} › {level.node.untitled ? '제목 없는 기록' : level.node.title}</>;

  return <main className="spatial-explorer" aria-busy={loading} data-level={level.kind}>
    <h1 className="sr-only">Morum 문서 공간</h1>
    <div className="spatial-viewport" ref={viewportRef} tabIndex={-1} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={event => finishPointer(event)} onPointerCancel={event => finishPointer(event, true)} onWheel={onWheel}>
      <div className="spatial-world" ref={worldRef}>
        {renderItems(items, selected, near, nearLoading, nearError, activeCite, {
          suppressed: () => suppressClickRef.current,
          onSelect: (i) => { if (i !== selectedRef.current) { setSelected(i); selectedRef.current = i; } center(i); },
          onActivate: (i) => { lastTapRef.current = null; goIn(i); },
          registerTap: (i) => { const now = performance.now(), last = lastTapRef.current; const doubleActivation = last !== null && last.index === i && now - last.at <= DOUBLE_TAP; if (doubleActivation) { lastTapRef.current = null; goIn(i); } else lastTapRef.current = {index: i, at: now}; },
          onRetry: () => { if (level.kind === 'near') navigateTo(level, {replace: true}); },
        })}
      </div>
    </div>
    <div className="spatial-dock" data-hidden={dockHidden}>
      <p className="spatial-crumb" aria-live="polite">{crumb}</p>
      <form className="spatial-search" onSubmit={submit}><label className="sr-only" htmlFor="spatial-query">지식 검색</label><input id="spatial-query" value={query} onChange={event => setQuery(event.target.value)} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} onCompositionStart={() => setComposing(true)} onCompositionEnd={event => { setComposing(false); setQuery(event.currentTarget.value); }} placeholder="문서와 맥락 검색" autoComplete="off"/><button type="submit">검색</button></form>
    </div>
    {selectedItem && <p className="sr-only" aria-live="polite">선택됨: {itemLabel(selectedItem)}</p>}
  </main>;
}

function itemLabel(item: Item): string {
  if (item.kind === 'galaxy') return item.galaxy.label;
  if (item.kind === 'mid') return item.node.title;
  if (item.kind === 'planet') return item.node.untitled ? '제목 없는 기록' : item.node.title;
  return item.satellite.caption;
}

function nodeFromVersionView(view: VersionView): SpatialNode {
  const target: ContentRef = {kind: 'version', id: view.version.id};
  return {
    key: `version:${view.version.id}`,
    target,
    locator: {kind: 'object', target},
    locators: [{kind: 'object', target}],
    title: view.version.title || '',
    snippet: view.version.body_text,
    href: `/versions/${encodeURIComponent(view.version.id)}`,
    isCurrent: view.is_current,
    versionState: view.is_current ? 'current' : 'historical',
    score: null,
    syntheticDemo: view.version.synthetic_demo,
    topic: null,
    untitled: !view.version.title?.trim(),
    duplicateOf: typeof view.version.attributes?.duplicate_of === 'string' ? view.version.attributes.duplicate_of : null,
  };
}

function buildSatellites(near: NearState, planetNode: SpatialNode): SatelliteItem[] {
  const {view, neighbors, hasMoreNeighbors, history} = near;

  const historyItems: Satellite[] = history
    .filter(version => version.id !== view.version.id)
    .map(version => ({kind: 'version', caption: `이전 버전 v${version.version_no}`, version, node: {
      key: `version:${version.id}`,
      target: {kind: 'version', id: version.id},
      locator: {kind: 'object', target: {kind: 'version', id: version.id}},
      locators: [],
      title: version.title || '',
      snippet: version.body_text,
      href: `/versions/${encodeURIComponent(version.id)}`,
      isCurrent: null,
      versionState: 'historical',
      score: null,
      syntheticDemo: version.synthetic_demo,
      topic: null,
      untitled: !version.title?.trim(),
      duplicateOf: null,
    }}));

  const basisItems: Satellite[] = near.citations.map(citation => ({
    kind: 'evidence',
    caption: `${citation.evidence.basis.kind === 'external' ? '출처' : citation.evidence.basis.kind === 'internal' ? '내부 근거' : '추론'} ${citeMark(citation.index)}`,
    citation,
  }));

  const leftBase: Satellite[] = [...historyItems, ...basisItems];
  const leftNeighborItems: Satellite[] = neighbors.filter(item => item.side === 'left').map(neighbor => ({kind: 'relation', caption: relationLabel(neighbor.relation.predicate), neighbor}));
  let left: Satellite[] = [...leftBase, ...leftNeighborItems];
  if (left.length === 0) left = [{kind: 'empty', caption: ''}];

  const rightNeighborItems: Satellite[] = neighbors.filter(item => item.side === 'right').map(neighbor => ({kind: 'relation', caption: relationLabel(neighbor.relation.predicate), neighbor}));
  const contextItems: Satellite[] = neighbors.filter(item => item.side === 'context').map(neighbor => ({kind: 'relation', caption: relationLabel(neighbor.relation.predicate), neighbor}));
  const reviewSatellite: Satellite = {kind: 'review', caption: '검토', summary: view.review_summary};
  let right: Satellite[] = [...rightNeighborItems, ...contextItems, reviewSatellite];

  const moreSatellite: Satellite = {kind: 'more', caption: '… 더 있음', versionId: planetNode.target.id};
  const cap = (satellites: Satellite[], needsMore: boolean): Satellite[] => {
    if (satellites.length <= SATELLITE_CAP && !needsMore) return satellites;
    return [...satellites.slice(0, SATELLITE_CAP - 1), moreSatellite];
  };
  left = cap(left, false);
  right = cap(right, hasMoreNeighbors);

  const place = (satellites: Satellite[], x: number): SatelliteItem[] => satellites.map((satellite, index) => {
    const y = (index - (satellites.length - 1) / 2) * SATELLITE_STEP;
    return {kind: 'satellite', key: `sat:${x < 0 ? 'l' : 'r'}:${index}:${satellite.kind}`, x, y, satellite};
  });

  return [...place(left, -1.15), ...place(right, 1.15)];
}

function activateSatellite(satellite: Satellite, level: Level, enterNode: (node: SpatialNode, galaxyKey: string | null) => void) {
  const galaxyKey = level.kind === 'near' ? level.galaxyKey : null;
  if (satellite.kind === 'version') { enterNode(satellite.node, galaxyKey); return; }
  if (satellite.kind === 'relation') { enterNode(satellite.neighbor.node, galaxyKey); return; }
  if (satellite.kind === 'more') { window.location.assign(`/versions/${encodeURIComponent(satellite.versionId)}`); return; }
  if (satellite.kind === 'evidence' && satellite.citation.evidence.basis.kind === 'external') { window.location.assign(`/sources/${encodeURIComponent(satellite.citation.evidence.basis.source_id)}`); return; }
}

type ItemHandlers = {
  suppressed: () => boolean;
  onSelect: (index: number) => void;
  onActivate: (index: number) => void;
  registerTap: (index: number) => void;
  onRetry: () => void;
};

/** Satellites are stacked in one column per side so uneven heights never overlap; their item x/y stay only for keyboard direction and lighting. */
function renderItems(items: Item[], selected: number, near: NearState | null, nearLoading: boolean, nearError: string, activeCite: number | null, handlers: ItemHandlers): ReactNode {
  const out: ReactNode[] = [];
  const columns: Record<'left' | 'right', ReactNode[]> = {left: [], right: []};
  items.forEach((item, index) => {
    const rendered = renderItem(item, index, selected, near, nearLoading, nearError, activeCite, handlers);
    if (item.kind === 'satellite') columns[item.x < 0 ? 'left' : 'right'].push(rendered);
    else out.push(rendered);
  });
  (['left', 'right'] as const).forEach(side => {
    if (columns[side].length) out.push(<div key={`satellites-${side}`} className="spatial-satellites" data-side={side}>{columns[side]}</div>);
  });
  return out;
}

function renderItem(item: Item, index: number, selected: number, near: NearState | null, nearLoading: boolean, nearError: string, activeCite: number | null, handlers: ItemHandlers): ReactNode {
  const style = {'--grid-x': item.x, '--grid-y': item.y} as CSSProperties;
  if (item.kind === 'galaxy') {
    const untagged = item.galaxy.topic === null;
    return <button key={item.key} type="button" className="spatial-galaxy" data-item-index={index} data-selected={index === selected} data-untagged={untagged} style={style}
      onMouseDown={event => { if (event.detail >= 2) event.preventDefault(); }}
      onClick={event => { if (handlers.suppressed()) return; handlers.onSelect(index); if (event.detail >= 2) handlers.onActivate(index); else handlers.registerTap(index); }}>
      <span className="spatial-galaxy-name">{item.galaxy.label}</span>
      <span className="spatial-galaxy-count">{item.galaxy.nodes.length}편{untagged ? ' · topic 없음' : ''}</span>
    </button>;
  }
  if (item.kind === 'mid') {
    return <button key={item.key} type="button" className="spatial-node" data-item-index={index} data-selected={index === selected} data-dim={item.dim} data-foreign={item.foreign} style={style}
      onMouseDown={event => { if (event.detail >= 2) event.preventDefault(); }}
      onClick={event => { if (handlers.suppressed()) return; handlers.onSelect(index); if (event.detail >= 2) handlers.onActivate(index); else handlers.registerTap(index); }}>
      <span className="spatial-node-copy">{item.node.snippet || '내용 미리보기가 없습니다.'}</span>
    </button>;
  }
  if (item.kind === 'planet') {
    if (nearLoading) return <p key={item.key} className="spatial-message" role="status">문서를 불러오는 중…</p>;
    if (nearError) return <p key={item.key} className="spatial-message" role="alert">{nearError} <button type="button" onClick={handlers.onRetry}>다시 시도</button></p>;
    if (!near) return null;
    const titleId = 'spatial-planet-title';
    return <article key={item.key} className="spatial-planet" data-item-index={index} data-selectable data-cite={activeCite ?? undefined} style={{'--grid-x': 0, '--grid-y': 0} as CSSProperties} aria-labelledby={titleId}>
      <h2 className="sr-only" id={titleId}>{item.node.untitled ? '제목 없는 기록' : (near.view.version.title || '제목 없는 기록')}</h2>
      <div className="spatial-planet-text">{renderCitedBody(near.view.version.body_text, near.citations)}</div>
      <nav className="spatial-planet-links" aria-label="문서 상세">
        <a href={`/versions/${encodeURIComponent(near.view.version.id)}`}>고정 링크와 전체 맥락</a>
        <a href={`/versions/${encodeURIComponent(near.view.version.id)}/raw`} target="_blank" rel="noreferrer">원문</a>
        <a href={`/records/${encodeURIComponent(near.view.version.record_id)}/history`}>이력</a>
      </nav>
    </article>;
  }
  return <div key={item.key} className="spatial-satellite" data-item-index={index} data-selected={index === selected} data-kind={item.satellite.kind} onClick={event => { if (handlers.suppressed()) return; handlers.onSelect(index); if (!(event.target instanceof HTMLElement && event.target.closest('a'))) handlers.onActivate(index); }}>
    {renderSatelliteContent(item.satellite)}
  </div>;
}

function renderSatelliteContent(satellite: Satellite): ReactNode {
  if (satellite.kind === 'version') return <><b>{satellite.caption}</b>{satellite.node.title || '제목 없는 기록'}</>;
  if (satellite.kind === 'evidence') {
    const {evidence, source, anchor, anchorMatches} = satellite.citation;
    const basis = evidence.basis;
    const where = anchor
      ? (anchorMatches ? <span className="spatial-cite-where">본문 구간 “{anchor.selector.exact}”</span> : <span className="spatial-cite-where">본문 구간이 현재 본문과 맞지 않음</span>)
      : <span className="spatial-cite-where">문서 전체</span>;
    if (basis.kind === 'external') {
      const label = source?.title?.trim() || (source?.url ? new URL(source.url).hostname : '출처 보기');
      return <><b>{satellite.caption}</b><a href={`/sources/${encodeURIComponent(basis.source_id)}`}>{label}</a>{basis.quote ? <q className="spatial-cite-quote">{basis.quote}</q> : <span className="spatial-cite-none">인용문 없음</span>}<span className="spatial-cite-why">{basis.explanation}</span>{where}</>;
    }
    return <><b>{satellite.caption}</b><span className="spatial-cite-why">{basis.explanation}</span>{where}</>;
  }
  if (satellite.kind === 'relation') return <><b>{satellite.caption}</b>{satellite.neighbor.node.title}</>;
  if (satellite.kind === 'review') {
    const summary = satellite.summary;
    return <><b>{satellite.caption}</b>{summary.review_state === 'unreviewed' ? '아직 검토 없음' : `${summary.agree} 동의 · ${summary.disagree} 반대 · ${summary.needs_review} 검토 필요`}</>;
  }
  if (satellite.kind === 'more') return <><b>{satellite.caption}</b><a href={`/versions/${encodeURIComponent(satellite.versionId)}`}>전체 맥락</a></>;
  return <>첨부된 근거 없음</>;
}

function citeMark(index: number): string {
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return String(index).split('').map(d => digits[Number(d)]).join('');
}

/** Body text with each anchored, still-matching citation wrapped in a mark carrying its number. Offsets are Unicode code points, as the API records them. */
function renderCitedBody(body: string, citations: Citation[]): ReactNode {
  const points = Array.from(body);
  const spans = citations
    .filter(citation => citation.anchor && citation.anchorMatches)
    .map(citation => ({start: citation.anchor!.selector.start, end: citation.anchor!.selector.end, index: citation.index}))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // overlapping spans: keep the earlier one, the satellite still lists the citation
    if (span.start > cursor) parts.push(points.slice(cursor, span.start).join(''));
    parts.push(<mark key={`cite-${span.index}`} className="spatial-cite" data-n={span.index}>{points.slice(span.start, span.end).join('')}<sup>{span.index}</sup></mark>);
    cursor = span.end;
  }
  if (cursor < points.length) parts.push(points.slice(cursor).join(''));
  return parts;
}
