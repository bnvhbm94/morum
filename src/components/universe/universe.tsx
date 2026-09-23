'use client';

// Phase-0 continuous universe explorer. One canvas (decorative starlight + category/item particles,
// pointer-events none) behind an imperatively-positioned DOM button layer (accessible hit targets).
// Camera and layout state live in refs; React state only drives which DOM buttons exist and the
// crumb/search chrome. Design: docs/ARCHIVE_DESIGN.md §5.
import {useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent} from 'react';
import type {Camera, Circle, UniverseCategory, UniverseItem, UniverseSource, Viewport} from './types';
import {createTopicSource} from '../../lib/universe-data';
import {loadSpatialSearch} from '../../lib/spatial-data';
import {rootCircle, packChildren} from './layout';
import {worldToScreen, screenToWorld, zoomAt, panBy, fitCircle, interpolate, inertiaStep} from './camera';
import {screenRadius, stageFor, stageScale, isVisible, pickFetchTargets, directionalNode, STAGE_PX, type Stage, type FetchCandidate} from './lod';
import {makeStarfield, paintStarfield, drawCategoryPoint, drawCategoryParticles, drawCategoryGlow, makeCategoryParticles, type Star, type Particle} from './starfield';
import './universe.css';

type CategoryEntry = {category: UniverseCategory; circle: Circle; parentId: string | null};
type ItemEntry = {item: UniverseItem; circle: Circle};
type PointerState = {id: number; startX: number; startY: number; lastX: number; lastY: number; lastAt: number; moved: boolean; samples: {dx: number; dy: number; dt: number; at: number}[]};
type PinchState = {dist: number; mid: {x: number; y: number}};
type Highlight = {itemId: string; until: number};

const DRAG_THRESHOLD = 7;
const FLY_MS = 520;
const STILL_MS = 120;
const DOM_DEBOUNCE_MS = 80;
const HIGHLIGHT_MS = 1200;
const NOT_FOUND_MS = 2000;
const IDLE_MS = 2000;
const MAX_DOM_CATEGORIES = 150;
const MAX_FETCH = 4;
const ARROW_STEP = 0.12;
// Titles appear as soon as a category opens, so its documents read as places rather than specks.
const ITEM_TITLE_PX = 34;
const ITEM_SNIPPET_PX = 220;
const UNTITLED_LABEL_CHARS = 28;
const KEY_ZOOM = 1.35;

function itemKey(categoryId: string, itemId: string): string { return `${categoryId}::${itemId}`; }
/** Untitled records are labelled by their opening clause only; the full text belongs in the reader, not on the field. */
function itemLabel(item: UniverseItem): string {
  if (!item.node.untitled) return item.title;
  const text = item.snippet.replace(/\s+/g, ' ').trim();
  const clause = text.split(/(?<=[.。!?])\s|[,，]\s/)[0] || text;
  const chars = Array.from(clause);
  return chars.length > UNTITLED_LABEL_CHARS ? `${chars.slice(0, UNTITLED_LABEL_CHARS).join('')}…` : clause;
}
function splitItemKey(key: string): [string, string] { const i = key.indexOf('::'); return [key.slice(0, i), key.slice(i + 2)]; }

export default function Universe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const buttonElsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const selectedKeyRef = useRef<string | null>(null);

  const sourceRef = useRef<UniverseSource | null>(null);
  const cameraRef = useRef<Camera>({x: 0, y: 0, scale: 1});
  const viewportRef = useRef<Viewport>({width: 0, height: 0});
  const categoriesRef = useRef<Map<string, CategoryEntry>>(new Map());
  const loadedChildrenRef = useRef<Set<string>>(new Set());
  const loadedItemsRef = useRef<Set<string>>(new Set());
  const itemCirclesRef = useRef<Map<string, Map<string, ItemEntry>>>(new Map());
  const particlesRef = useRef<Map<string, Particle[]>>(new Map());
  const starsRef = useRef<Star[]>(makeStarfield());
  const reducedMotionRef = useRef(false);
  const highlightRef = useRef<Highlight | null>(null);

  const rafRef = useRef<number | null>(null);
  const flightRafRef = useRef<number | null>(null);
  const inertiaRafRef = useRef<number | null>(null);
  const velocityRef = useRef({x: 0, y: 0});
  const pointerRef = useRef<PointerState | null>(null);
  const activePointersRef = useRef<Set<number>>(new Set());
  const pinchRef = useRef<PinchState | null>(null);
  const suppressClickRef = useRef(false);

  const stillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notFoundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const domTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedDomRef = useRef({cats: '', items: ''});
  const fetchControllersRef = useRef<Set<AbortController>>(new Set());
  const searchControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const [domCategoryIds, setDomCategoryIds] = useState<string[]>([]);
  const [domItemKeys, setDomItemKeys] = useState<string[]>([]);
  const [crumbText, setCrumbText] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [pillHidden, setPillHidden] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState('');

  function resizeCanvas(): void {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(viewport.width * dpr));
    canvas.height = Math.max(1, Math.round(viewport.height * dpr));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function bindButton(key: string, el: HTMLButtonElement | null): void {
    if (!el) { buttonElsRef.current.delete(key); return; }
    buttonElsRef.current.set(key, el);
    // Place it now; waiting for the next paint leaves freshly mounted buttons at 0×0 until the camera moves.
    positionButton(key, el, cameraRef.current, viewportRef.current, performance.now());
  }

  function commitDom(cats: string[], items: string[]): void {
    const catsKey = cats.join(',');
    const itemsKey = items.join(',');
    if (catsKey === committedDomRef.current.cats && itemsKey === committedDomRef.current.items) return;
    if (domTimerRef.current) clearTimeout(domTimerRef.current);
    domTimerRef.current = setTimeout(() => {
      domTimerRef.current = null;
      committedDomRef.current = {cats: catsKey, items: itemsKey};
      setDomCategoryIds(cats);
      setDomItemKeys(items);
    }, DOM_DEBOUNCE_MS);
  }

  function positionDomButtons(camera: Camera, viewport: Viewport): void {
    const now = performance.now();
    for (const [key, el] of buttonElsRef.current) positionButton(key, el, camera, viewport, now);
  }

  function positionButton(key: string, el: HTMLButtonElement, camera: Camera, viewport: Viewport, now: number): void {
    const isItem = key.includes('::');
    let circle: Circle | undefined;
    if (isItem) {
      const [categoryId, itemId] = splitItemKey(key);
      circle = itemCirclesRef.current.get(categoryId)?.get(itemId)?.circle;
    } else {
      circle = categoriesRef.current.get(key)?.circle;
    }
    if (!circle) return;
    const pos = worldToScreen(camera, viewport, circle);
    const r = Math.max(screenRadius(circle, camera), 1);
    el.style.transform = `translate(${pos.x - r}px, ${pos.y - r}px)`;
    el.style.width = `${r * 2}px`;
    el.style.height = `${r * 2}px`;
    el.dataset.selected = selectedKeyRef.current === key ? 'true' : 'false';
    if (isItem) {
      const [, itemId] = splitItemKey(key);
      const highlight = highlightRef.current;
      el.dataset.detail = r >= ITEM_SNIPPET_PX ? 'snippet' : r >= ITEM_TITLE_PX ? 'title' : 'none';
      el.dataset.highlight = highlight && highlight.itemId === itemId && now < highlight.until ? 'true' : 'false';
    } else {
      const entry = categoriesRef.current.get(key);
      el.dataset.stage = entry ? stageFor(screenRadius(entry.circle, camera), entry.category.directCount > 0, entry.category.childCount > 0, stageScale(viewport)) : 'nebula';
    }
  }

  function currentCategoryId(): string | null {
    const camera = cameraRef.current, viewport = viewportRef.current;
    const centre = screenToWorld(camera, viewport, {x: viewport.width / 2, y: viewport.height / 2});
    const limit = 2 * Math.min(viewport.width, viewport.height);
    let best: {id: string; radiusPx: number} | null = null;
    for (const [id, entry] of categoriesRef.current) {
      if (Math.hypot(centre.x - entry.circle.x, centre.y - entry.circle.y) > entry.circle.r) continue;
      const radiusPx = screenRadius(entry.circle, camera);
      // Only an opened category counts as the place you are in.
      if (radiusPx < STAGE_PX.open * stageScale(viewport) || radiusPx >= limit) continue;
      if (!best || radiusPx > best.radiusPx) best = {id, radiusPx};
    }
    return best?.id ?? null;
  }

  function computeCrumb(): string {
    const id = currentCategoryId();
    if (!id) return '';
    const labels: string[] = [];
    let cursor: string | null = id;
    while (cursor) {
      const entry: CategoryEntry | undefined = categoriesRef.current.get(cursor);
      if (!entry) break;
      labels.unshift(entry.category.label);
      cursor = entry.parentId;
    }
    return labels.join(' › ');
  }

  function paint(): void {
    rafRef.current = null;
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || viewport.width <= 0 || viewport.height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const camera = cameraRef.current;

    ctx.clearRect(0, 0, viewport.width, viewport.height);
    paintStarfield(ctx, starsRef.current, camera, viewport);

    const catNodes: {id: string; radiusPx: number}[] = [];
    const itemNodes: {id: string; radiusPx: number}[] = [];
    for (const [id, entry] of categoriesRef.current) {
      if (!isVisible(entry.circle, camera, viewport)) continue;
      const radiusPx = screenRadius(entry.circle, camera);
      const stage: Stage = stageFor(radiusPx, entry.category.directCount > 0, entry.category.childCount > 0, stageScale(viewport));
      const screenPos = worldToScreen(camera, viewport, entry.circle);
      if (stage === 'point') {
        drawCategoryPoint(ctx, screenPos, entry.category.mass);
      } else {
        let points = particlesRef.current.get(id);
        if (!points) { points = makeCategoryParticles(entry.circle, entry.category.layoutSeed, entry.category.mass); particlesRef.current.set(id, points); }
        if (stage === 'nebula') {
          drawCategoryParticles(ctx, points, camera, viewport, 1);
        } else {
          const k = stageScale(viewport), fade = Math.max(0.05, 1 - (radiusPx - STAGE_PX.open * k) / ((STAGE_PX.items - STAGE_PX.open) * k));
          drawCategoryParticles(ctx, points, camera, viewport, fade);
          drawCategoryGlow(ctx, screenPos, radiusPx);
        }
        catNodes.push({id, radiusPx});
      }
      if (stage === 'items') {
        const items = itemCirclesRef.current.get(id);
        if (items) {
          for (const [itemId, entryItem] of items) {
            if (!isVisible(entryItem.circle, camera, viewport)) continue;
            itemNodes.push({id: itemKey(id, itemId), radiusPx: screenRadius(entryItem.circle, camera)});
          }
        }
      }
    }

    catNodes.sort((a, b) => b.radiusPx - a.radiusPx);
    itemNodes.sort((a, b) => b.radiusPx - a.radiusPx);
    positionDomButtons(camera, viewport);
    commitDom(catNodes.slice(0, MAX_DOM_CATEGORIES).map(n => n.id), itemNodes.map(n => n.id));

    const nextCrumb = computeCrumb();
    setCrumbText(prev => (prev === nextCrumb ? prev : nextCrumb));
  }

  function schedulePaint(): void {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(paint);
  }

  function stopFlight(): void {
    if (flightRafRef.current !== null) { cancelAnimationFrame(flightRafRef.current); flightRafRef.current = null; }
  }
  function stopInertia(): void {
    if (inertiaRafRef.current !== null) { cancelAnimationFrame(inertiaRafRef.current); inertiaRafRef.current = null; }
    velocityRef.current = {x: 0, y: 0};
  }

  function updateUrl(categoryId: string): void {
    const params = new URLSearchParams({c: categoryId});
    window.history.replaceState(null, '', `/universe?${params.toString()}`);
  }

  async function fetchItemsFor(categoryId: string, signal?: AbortSignal): Promise<void> {
    if (itemCirclesRef.current.has(categoryId)) return;
    const entry = categoriesRef.current.get(categoryId);
    const source = sourceRef.current;
    if (!entry || !source) return;
    loadedItemsRef.current.add(categoryId);
    try {
      const items = await source.items(categoryId, signal);
      if (!mountedRef.current) return;
      const circles = packChildren(entry.circle, items.map(item => ({id: item.id, mass: 1})), entry.category.layoutSeed);
      const map = new Map<string, ItemEntry>();
      for (const item of items) { const circle = circles.get(item.id); if (circle) map.set(item.id, {item, circle}); }
      itemCirclesRef.current.set(categoryId, map);
      schedulePaint();
    } catch { loadedItemsRef.current.delete(categoryId); }
  }

  async function fetchChildrenFor(categoryId: string, signal?: AbortSignal): Promise<void> {
    const entry = categoriesRef.current.get(categoryId);
    const source = sourceRef.current;
    if (!entry || !source) { loadedChildrenRef.current.delete(categoryId); return; }
    try {
      const kids = await source.children(categoryId, signal);
      if (!mountedRef.current) return;
      const circles = packChildren(entry.circle, kids.map(kid => ({id: kid.id, mass: kid.mass})), entry.category.layoutSeed);
      for (const kid of kids) { const circle = circles.get(kid.id); if (circle) categoriesRef.current.set(kid.id, {category: kid, circle, parentId: categoryId}); }
      schedulePaint();
    } catch { loadedChildrenRef.current.delete(categoryId); }
  }

  async function fetchNearby(): Promise<void> {
    const source = sourceRef.current;
    if (!source) return;
    const candidates: FetchCandidate[] = [...categoriesRef.current.entries()].map(([id, entry]) => ({id, circle: entry.circle, childCount: entry.category.childCount, directCount: entry.category.directCount}));
    const {children, items} = pickFetchTargets(candidates, cameraRef.current, viewportRef.current, loadedChildrenRef.current, loadedItemsRef.current, MAX_FETCH);
    if (children.length === 0 && items.length === 0) return;
    const controller = new AbortController();
    fetchControllersRef.current.add(controller);
    for (const id of children) loadedChildrenRef.current.add(id);
    await Promise.all([...children.map(id => fetchChildrenFor(id, controller.signal)), ...items.map(id => fetchItemsFor(id, controller.signal))]);
    fetchControllersRef.current.delete(controller);
  }

  function markCameraChanged(): void {
    if (stillTimerRef.current) clearTimeout(stillTimerRef.current);
    stillTimerRef.current = setTimeout(() => { stillTimerRef.current = null; void fetchNearby(); }, STILL_MS);
  }

  function markActive(): void {
    setPillHidden(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setPillHidden(false), IDLE_MS);
  }

  function afterFly(categoryId: string | null): void {
    if (categoryId) updateUrl(categoryId);
    markCameraChanged();
    void fetchNearby();
  }

  function flyTo(circle: Circle, categoryId: string | null): void {
    glideTo(fitCircle(viewportRef.current, circle, 0.8), categoryId);
  }

  function glideTo(target: Camera, categoryId: string | null = null): void {
    stopInertia();
    stopFlight();
    if (reducedMotionRef.current) {
      cameraRef.current = target;
      schedulePaint();
      afterFly(categoryId);
      return;
    }
    const from = {...cameraRef.current};
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / FLY_MS);
      cameraRef.current = interpolate(from, target, t);
      schedulePaint();
      if (t < 1) { flightRafRef.current = requestAnimationFrame(tick); }
      else { flightRafRef.current = null; afterFly(categoryId); }
    };
    flightRafRef.current = requestAnimationFrame(tick);
  }

  /** Arrow keys move to the nearest rendered node in that direction and centre it; Enter then opens it. */
  function stepSelection(key: string): boolean {
    const nodes = [...buttonElsRef.current].map(([nodeKey, el]) => {
      const rect = el.getBoundingClientRect();
      return {key: nodeKey, el, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    }).filter(node => node.el.getBoundingClientRect().width > 0);
    if (!nodes.length) return false;
    const viewport = viewportRef.current;
    const current = nodes.find(node => node.key === selectedKeyRef.current)
      ?? nodes.reduce((best, node) => Math.hypot(node.x - viewport.width / 2, node.y - viewport.height / 2) < Math.hypot(best.x - viewport.width / 2, best.y - viewport.height / 2) ? node : best);
    const next = current.key === selectedKeyRef.current ? directionalNode(nodes, current, key) : current;
    if (!next) return true;
    selectedKeyRef.current = next.key;
    next.el.focus({preventScroll: true});
    const world = screenToWorld(cameraRef.current, viewport, {x: next.x, y: next.y});
    glideTo({...cameraRef.current, x: world.x, y: world.y});
    return true;
  }

  function flyToParentOrRoot(): void {
    const id = currentCategoryId();
    if (!id) { flyTo(rootCircle(), null); return; }
    const entry = categoriesRef.current.get(id);
    const parentId = entry?.parentId ?? null;
    const parentEntry = parentId ? categoriesRef.current.get(parentId) : null;
    flyTo(parentEntry ? parentEntry.circle : rootCircle(), parentId);
  }

  function zoomCentre(factor: number): void {
    const viewport = viewportRef.current;
    cameraRef.current = zoomAt(cameraRef.current, viewport, {x: viewport.width / 2, y: viewport.height / 2}, factor);
    schedulePaint();
    markCameraChanged();
    markActive();
  }

  function showNotFound(): void {
    setNotFound(true);
    if (notFoundTimerRef.current) clearTimeout(notFoundTimerRef.current);
    notFoundTimerRef.current = setTimeout(() => setNotFound(false), NOT_FOUND_MS);
  }

  function highlightItem(id: string): void {
    highlightRef.current = {itemId: id, until: performance.now() + HIGHLIGHT_MS};
    schedulePaint();
    setTimeout(() => schedulePaint(), HIGHLIGHT_MS);
  }

  async function runSearch(text: string): Promise<void> {
    const trimmed = text.trim();
    const source = sourceRef.current;
    if (!trimmed || !source) return;
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    try {
      const result = await loadSpatialSearch(trimmed, {scope: 'current', include_context: false}, controller.signal);
      const hit = result.nodes.find(node => node.target.kind === 'version');
      const versionId = hit && hit.target.kind === 'version' ? hit.target.id : null;
      const path = versionId ? await source.pathTo(versionId, controller.signal) : [];
      const categoryId = path[path.length - 1];
      const entry = categoryId ? categoriesRef.current.get(categoryId) : undefined;
      if (!hit || !entry) { showNotFound(); return; }
      flyTo(entry.circle, categoryId);
      await fetchItemsFor(categoryId, controller.signal);
      if (mountedRef.current) highlightItem(hit.key);
    } catch { if (!controller.signal.aborted) showNotFound(); }
  }

  // Newly mounted buttons have no size until the next paint positions them.
  useEffect(() => { schedulePaint(); }, [domCategoryIds, domItemKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Mount: build the source, place the roots, honour a `?c=` deep link, then keep fetching as the camera settles.
  useEffect(() => {
    mountedRef.current = true;
    const container = containerRef.current;
    if (!container) return;
    reducedMotionRef.current = matchMedia('(prefers-reduced-motion: reduce)').matches;
    viewportRef.current = {width: container.clientWidth, height: container.clientHeight};
    resizeCanvas();
    const source = createTopicSource();
    sourceRef.current = source;
    const controller = new AbortController();
    fetchControllersRef.current.add(controller);

    (async () => {
      try {
        const roots = await source.children(null, controller.signal);
        if (!mountedRef.current) return;
        const circles = packChildren(rootCircle(), roots.map(cat => ({id: cat.id, mass: cat.mass})), 0);
        for (const cat of roots) { const circle = circles.get(cat.id); if (circle) categoriesRef.current.set(cat.id, {category: cat, circle, parentId: null}); }
        const target = new URLSearchParams(window.location.search).get('c');
        const targetEntry = target ? categoriesRef.current.get(target) : null;
        cameraRef.current = fitCircle(viewportRef.current, targetEntry ? targetEntry.circle : rootCircle(), targetEntry ? 0.8 : 0.92);
        schedulePaint();
        markCameraChanged();
      } catch { /* roots stay empty; nothing to place */ }
    })();

    const onResize = () => {
      if (!containerRef.current) return;
      viewportRef.current = {width: containerRef.current.clientWidth, height: containerRef.current.clientHeight};
      resizeCanvas();
      schedulePaint();
    };
    window.addEventListener('resize', onResize);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      cameraRef.current = zoomAt(cameraRef.current, viewportRef.current, {x: event.clientX - rect.left, y: event.clientY - rect.top}, factor);
      schedulePaint();
      markCameraChanged();
      markActive();
    };
    container.addEventListener('wheel', onWheel, {passive: false});

    const pinchInfo = (event: TouchEvent): PinchState => {
      const rect = container.getBoundingClientRect();
      const [a, b] = [event.touches[0], event.touches[1]];
      return {dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mid: {x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top}};
    };
    const onTouchStart = (event: TouchEvent) => { if (event.touches.length === 2) { stopFlight(); stopInertia(); pinchRef.current = pinchInfo(event); } };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinchRef.current) return;
      event.preventDefault();
      const next = pinchInfo(event);
      const factor = pinchRef.current.dist > 0 ? next.dist / pinchRef.current.dist : 1;
      cameraRef.current = zoomAt(cameraRef.current, viewportRef.current, pinchRef.current.mid, factor);
      cameraRef.current = panBy(cameraRef.current, next.mid.x - pinchRef.current.mid.x, next.mid.y - pinchRef.current.mid.y);
      pinchRef.current = next;
      schedulePaint();
      markCameraChanged();
      markActive();
    };
    const onTouchEnd = (event: TouchEvent) => { if (event.touches.length < 2) pinchRef.current = null; };
    container.addEventListener('touchstart', onTouchStart, {passive: true});
    container.addEventListener('touchmove', onTouchMove, {passive: false});
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);

    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const inField = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      if (event.key === '/' && !inField) { event.preventDefault(); searchInputRef.current?.focus(); return; }
      if (inField || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); flyToParentOrRoot(); return; }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomCentre(KEY_ZOOM); return; }
      if (event.key === '-') { event.preventDefault(); zoomCentre(1 / KEY_ZOOM); return; }
      if (!event.key.startsWith('Arrow')) return;
      event.preventDefault();
      if (!event.shiftKey && stepSelection(event.key)) return;
      const viewport = viewportRef.current;
      const dx = event.key === 'ArrowLeft' ? viewport.width * ARROW_STEP : event.key === 'ArrowRight' ? -viewport.width * ARROW_STEP : 0;
      const dy = event.key === 'ArrowUp' ? viewport.height * ARROW_STEP : event.key === 'ArrowDown' ? -viewport.height * ARROW_STEP : 0;
      cameraRef.current = panBy(cameraRef.current, dx, dy);
      schedulePaint();
      markCameraChanged();
      markActive();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      // Reset, not just cancel: React's dev double-mount reruns this effect and schedulePaint checks for null.
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      stopFlight();
      stopInertia();
      if (stillTimerRef.current) clearTimeout(stillTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (notFoundTimerRef.current) clearTimeout(notFoundTimerRef.current);
      if (domTimerRef.current) clearTimeout(domTimerRef.current);
      for (const c of fetchControllersRef.current) c.abort();
      searchControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    activePointersRef.current.add(event.pointerId);
    if (activePointersRef.current.size > 1) { pointerRef.current = null; return; }
    stopFlight();
    stopInertia();
    pointerRef.current = {id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, lastAt: performance.now(), moved: false, samples: []};
    markActive();
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    const now = performance.now();
    const dx = event.clientX - pointer.lastX, dy = event.clientY - pointer.lastY, dt = Math.max(now - pointer.lastAt, 1);
    pointer.samples.push({dx, dy, dt, at: now});
    if (pointer.samples.length > 3) pointer.samples.shift();
    pointer.lastX = event.clientX; pointer.lastY = event.clientY; pointer.lastAt = now;
    const wasMoved = pointer.moved;
    pointer.moved ||= Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) >= DRAG_THRESHOLD;
    if (pointer.moved && !wasMoved) { try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* already released */ } }
    cameraRef.current = panBy(cameraRef.current, dx, dy);
    schedulePaint();
    markCameraChanged();
    markActive();
  }, []);

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    activePointersRef.current.delete(event.pointerId);
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    pointerRef.current = null;
    suppressClickRef.current = pointer.moved;
    if (pointer.moved) setTimeout(() => { suppressClickRef.current = false; }, 0);
    if (cancelled || !pointer.moved || reducedMotionRef.current) return;
    const now = performance.now();
    const recent = pointer.samples.filter(sample => now - sample.at <= 80);
    let vx = 0, vy = 0;
    if (recent.length) {
      let sumDx = 0, sumDy = 0, sumDt = 0;
      for (const sample of recent) { sumDx += sample.dx; sumDy += sample.dy; sumDt += sample.dt; }
      if (sumDt > 0) { vx = (sumDx / sumDt) * 16; vy = (sumDy / sumDt) * 16; }
    }
    velocityRef.current = {x: vx, y: vy};
    const tick = () => {
      const {velocity, delta} = inertiaStep(velocityRef.current, 16);
      cameraRef.current = panBy(cameraRef.current, delta.x, delta.y);
      velocityRef.current = velocity;
      schedulePaint();
      markCameraChanged();
      if (velocity.x !== 0 || velocity.y !== 0) inertiaRafRef.current = requestAnimationFrame(tick);
      else inertiaRafRef.current = null;
    };
    inertiaRafRef.current = requestAnimationFrame(tick);
  }, []);

  const onCategoryClick = useCallback((id: string) => {
    if (suppressClickRef.current) return;
    const entry = categoriesRef.current.get(id);
    if (entry) flyTo(entry.circle, id);
  }, []);

  const onItemClick = useCallback((item: UniverseItem, categoryId: string) => {
    if (suppressClickRef.current) return;
    // The home explorer's near view carries the satellites (history, evidence, relations, reviews) until phase 3 moves it here.
    if (!item.versionId) { window.location.assign(item.href); return; }
    window.location.assign(`/?${new URLSearchParams({galaxy: categoryId, doc: item.versionId, from: 'universe'})}`);
  }, []);

  const onSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || composing) return;
    event.preventDefault();
    void runSearch(query);
  }, [composing, query]);

  const dockHidden = pillHidden && !inputFocused;

  function renderCategoryButton(id: string) {
    const entry = categoriesRef.current.get(id);
    if (!entry) return null;
    return (
      <button key={id} type="button" className="universe-category" aria-label={entry.category.label}
        ref={el => bindButton(id, el)} onClick={() => onCategoryClick(id)}>
        <span className="universe-category-label">{entry.category.label}</span>
      </button>
    );
  }

  function renderItemButton(key: string) {
    const [categoryId, id] = splitItemKey(key);
    const entry = itemCirclesRef.current.get(categoryId)?.get(id);
    if (!entry) return null;
    return (
      <button key={key} type="button" className="universe-item" aria-label={itemLabel(entry.item) || '기록'}
        ref={el => bindButton(key, el)} onClick={() => onItemClick(entry.item, categoryId)}>
        <span className="universe-item-dot" aria-hidden="true" />
        <span className="universe-item-title">{itemLabel(entry.item)}</span>
        {!entry.item.node.untitled && <span className="universe-item-snippet">{entry.item.snippet}</span>}
      </button>
    );
  }

  return (
    <div className="universe-root">
      <canvas ref={canvasRef} className="universe-canvas" aria-hidden="true" />
      <div ref={containerRef} className="universe-viewport" tabIndex={-1}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={event => finishPointer(event)} onPointerCancel={event => finishPointer(event, true)}>
        {domCategoryIds.map(renderCategoryButton)}
        {domItemKeys.map(renderItemButton)}
      </div>
      <div className="universe-chrome">
        <p className="universe-crumb" aria-live="polite">{notFound ? '찾지 못했어요' : crumbText}</p>
        <div className="universe-search" data-hidden={dockHidden}>
          <label className="universe-sr-only" htmlFor="universe-query">우주 검색</label>
          <input id="universe-query" ref={searchInputRef} value={query} autoComplete="off" placeholder="검색"
            onChange={event => setQuery(event.target.value)}
            onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={event => { setComposing(false); setQuery(event.currentTarget.value); }}
            onKeyDown={onSearchKeyDown} />
        </div>
      </div>
    </div>
  );
}
