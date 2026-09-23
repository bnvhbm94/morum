'use client';

// One continuous universe. Galaxies (categories with subcategories) open into their children; stars (categories
// that hold documents) show their planets on orbits; a planet or a star opens as a document read in place.
// One canvas (decorative starlight, particles, star cores; pointer-events none) sits behind imperatively
// positioned DOM buttons (accessible hit targets). Camera and layout live in refs; React state only drives
// which buttons exist, the reader, and the chrome. Design: docs/ARCHIVE_DESIGN.md §5, docs/FABLE_UNIVERSE_BRIEF.md.
import {useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent} from 'react';
import type {Camera, Circle, UniverseCategory, UniverseItem, UniverseSource, Viewport} from './types';
import {createTopicSource} from '../../lib/universe-data';
import {loadSpatialSearch} from '../../lib/spatial-data';
import {rootCircle, packChildren, placeOrbits, HOLE_KEY, ORBIT_INNER} from './layout';
import {worldToScreen, screenToWorld, zoomAt, panBy, fitCircle, interpolate, inertiaStep, clampScale} from './camera';
import {screenRadius, stageFor, stageScale, isVisible, pickFetchTargets, directionalNode, itemsOpen, STAGE_PX, type Stage, type FetchCandidate} from './lod';
import {makeStarfield, paintStarfield, drawCategoryPoint, drawCategoryParticles, drawCategoryGlow, drawStarCore, makeCategoryParticles, type Star, type Particle} from './starfield';
import {bodyKind, starCircle, CENTER_HOLE, type BodyKind} from './celestial';
import {estimateLabelWidth, resolveLabels, type LabelBox} from './labels';
import UniverseReader, {readerTargetKey, relationLabel, type ReaderNeighbor, type ReaderTarget} from './reader';
import './universe.css';

type CategoryEntry = {category: UniverseCategory; circle: Circle; parentId: string | null; kind: BodyKind; star: Circle};
type ItemEntry = {item: UniverseItem; circle: Circle};
type PointerState = {id: number; startX: number; startY: number; lastX: number; lastY: number; lastAt: number; moved: boolean; samples: {dx: number; dy: number; dt: number; at: number}[]};
type PinchState = {dist: number; mid: {x: number; y: number}};
type Highlight = {itemId: string; until: number};

const DRAG_THRESHOLD = 7;
const STILL_MS = 120;
const DOM_DEBOUNCE_MS = 80;
const HIGHLIGHT_MS = 1600;
const NOT_FOUND_MS = 2000;
const IDLE_MS = 2000;
const MAX_DOM_CATEGORIES = 150;
const MAX_DOM_ITEMS = 400;
const MAX_FETCH = 4;
const ARROW_STEP = 0.12;
const MAX_FLICK = 60;
/** The archive's guide to itself sits at the centre of the universe. */
const CENTER_CATEGORY_ID = 'topic:Morum';
/** Fraction of an opened category's radius where particles dim behind its centred name. */
const NAME_QUIET_RATIO = 0.3;
/** Planet labels: one line under the dot, culled like map labels when they would overlap. */
const LABEL_FONT_PX = 13.4;
const LABEL_MAX_PX = 192;
const LABEL_MAX_NARROW_PX = 144;
const LABEL_PAD_PX = 10;
const LABEL_LINE_PX = 18;
const LABEL_GAP_PX = 9;
/** A planet's opening lines appear under its title once its star fills this many screen pixels of radius. */
const SNIPPET_STAR_PX = 720;
const SNIPPET_BOX = {width: 224, height: 44};
const UNTITLED_LABEL_CHARS = 28;
const KEY_ZOOM = 1.35;
const SHOW_STARFIELD = false;
const DOUBLE_CLICK_ZOOM = 2.4;
const WHEEL_STEP = 0.0018;
const WHEEL_MAX_LOG = 0.7;
const ZOOM_SMOOTHING = 0.28;

function itemKey(categoryId: string, itemId: string): string { return `${categoryId}::${itemId}`; }
function splitItemKey(key: string): [string, string] { const i = key.indexOf('::'); return [key.slice(0, i), key.slice(i + 2)]; }
/** Untitled records are labelled by their opening clause only; the full text belongs in the reader, not on the field. */
function itemLabel(item: UniverseItem): string {
  if (!item.node.untitled) return item.title;
  const text = item.snippet.replace(/\s+/g, ' ').trim();
  const clause = text.split(/(?<=[.。!?])\s|[,，]\s/)[0] || text;
  const chars = Array.from(clause);
  return chars.length > UNTITLED_LABEL_CHARS ? `${chars.slice(0, UNTITLED_LABEL_CHARS).join('')}…` : clause;
}
/** Flight time grows a little with the zoom change, so long dives read as travel and short hops stay quick. */
function flightMs(from: Camera, to: Camera): number {
  const ratio = Math.abs(Math.log2(to.scale / from.scale));
  return Math.max(420, Math.min(900, 420 + ratio * 110));
}

export default function Universe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const buttonElsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const selectedKeyRef = useRef<string | null>(null);
  /** The body a deliberate tap or arrow key chose; the next tap on it opens it. Focus alone (a mouse press) does not arm. */
  const armedKeyRef = useRef<string | null>(null);

  const sourceRef = useRef<UniverseSource | null>(null);
  const cameraRef = useRef<Camera>({x: 0, y: 0, scale: 1});
  const viewportRef = useRef<Viewport>({width: 0, height: 0});
  const categoriesRef = useRef<Map<string, CategoryEntry>>(new Map());
  const loadedChildrenRef = useRef<Set<string>>(new Set());
  const loadedItemsRef = useRef<Set<string>>(new Set());
  const itemCirclesRef = useRef<Map<string, Map<string, ItemEntry>>>(new Map());
  const starDocsRef = useRef<Map<string, UniverseItem | null>>(new Map());
  const starDocLoadingRef = useRef<Map<string, Promise<UniverseItem | null>>>(new Map());
  const particlesRef = useRef<Map<string, Particle[]>>(new Map());
  const starsRef = useRef<Star[]>(makeStarfield());
  const reducedMotionRef = useRef(false);
  const highlightRef = useRef<Highlight | null>(null);
  const labelsRef = useRef<Set<string>>(new Set());
  /** Declared relations of the open or selected document: version id → predicate label, for marking planets. */
  const relatedRef = useRef<Map<string, string>>(new Map());

  const rafRef = useRef<number | null>(null);
  const flightRafRef = useRef<number | null>(null);
  const inertiaRafRef = useRef<number | null>(null);
  const zoomRafRef = useRef<number | null>(null);
  const zoomPendingRef = useRef(0);
  const zoomAnchorRef = useRef({x: 0, y: 0});
  const velocityRef = useRef({x: 0, y: 0});
  const pointerRef = useRef<PointerState | null>(null);
  const activePointersRef = useRef<Set<number>>(new Set());
  const pinchRef = useRef<PinchState | null>(null);
  const suppressClickRef = useRef(false);

  const readerRef = useRef<ReaderTarget | null>(null);
  const returnCameraRef = useRef<Camera | null>(null);
  /** The circle the view was last fitted to. Until the visitor moves the camera, a resize keeps it fitted. */
  const lastFitRef = useRef<{circle: Circle; margin: number} | null>(null);
  const touchedRef = useRef(false);
  const readerPushesRef = useRef(0);

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
  const [reader, setReader] = useState<ReaderTarget | null>(null);

  // ---- Canvas and DOM placement -------------------------------------------------------------------------

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
      const [categoryId, itemId] = splitItemKey(key);
      const entry = itemCirclesRef.current.get(categoryId)?.get(itemId);
      const highlight = highlightRef.current;
      const labels = labelsRef.current;
      el.dataset.detail = labels.has(`${key}#s`) ? 'snippet' : labels.has(key) ? 'title' : 'none';
      el.dataset.highlight = highlight && highlight.itemId === itemId && now < highlight.until ? 'true' : 'false';
      const related = entry?.item.versionId ? relatedRef.current.get(entry.item.versionId) : undefined;
      if (related) el.dataset.related = related; else delete el.dataset.related;
    } else {
      const entry = categoriesRef.current.get(key);
      el.dataset.stage = entry ? stageFor(screenRadius(entry.circle, camera), entry.category.directCount > 0, entry.category.childCount > 0, stageScale(viewport)) : 'nebula';
      el.dataset.kind = entry?.kind ?? 'empty';
      el.dataset.open = entry && entry.category.directCount > 0 && itemsOpen(screenRadius(entry.star, camera), stageScale(viewport)) ? 'true' : 'false';
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
      // Only an opened category counts as the place you are in; the deepest one wins.
      if (radiusPx < STAGE_PX.open * stageScale(viewport) || radiusPx >= limit * 40) continue;
      if (!best || radiusPx < best.radiusPx) best = {id, radiusPx};
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
    const entry = categoriesRef.current.get(id);
    const inStar = entry && entry.category.directCount > 0 && itemsOpen(screenRadius(entry.star, cameraRef.current), stageScale(viewportRef.current));
    return labels.join(' › ') + (inStar ? ` · 행성 ${entry.category.directCount}` : '');
  }

  // ---- Paint ----------------------------------------------------------------------------------------------

  function paint(): void {
    rafRef.current = null;
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || viewport.width <= 0 || viewport.height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const camera = cameraRef.current;
    const k = stageScale(viewport);
    const reading = readerRef.current !== null;
    // While a document is open the field stays, but every light behind the text is turned well down.
    const dim = reading ? 0.22 : 1;

    ctx.clearRect(0, 0, viewport.width, viewport.height);
    // Decorative starlight is off for now (2026-09-23): it was barely visible and only added motion behind the data.
    if (SHOW_STARFIELD) paintStarfield(ctx, starsRef.current, camera, viewport, reading ? 0.3 : 1);

    const catNodes: {id: string; radiusPx: number}[] = [];
    const itemNodes: {key: string; radiusPx: number}[] = [];
    const boxes: LabelBox[] = [];
    for (const [id, entry] of categoriesRef.current) {
      if (!isVisible(entry.circle, camera, viewport)) continue;
      const radiusPx = screenRadius(entry.circle, camera);
      const stage: Stage = stageFor(radiusPx, entry.category.directCount > 0, entry.category.childCount > 0, k);
      const screenPos = worldToScreen(camera, viewport, entry.circle);
      const starRadiusPx = screenRadius(entry.star, camera);
      const open = entry.category.directCount > 0 && itemsOpen(starRadiusPx, k);
      if (stage === 'point') {
        drawCategoryPoint(ctx, screenPos, entry.category.mass, dim);
      } else {
        let points = particlesRef.current.get(id);
        if (!points) { points = makeCategoryParticles(entry.circle, entry.category.layoutSeed, entry.category.mass, entry.kind === 'star' ? 2.3 : 1.6); particlesRef.current.set(id, points); }
        if (stage === 'nebula') {
          drawCategoryParticles(ctx, points, camera, viewport, dim);
        } else {
          const fade = Math.max(0.05, 1 - (radiusPx - STAGE_PX.open * k) / ((STAGE_PX.items - STAGE_PX.open) * k));
          drawCategoryParticles(ctx, points, camera, viewport, fade * dim, {x: entry.circle.x, y: entry.circle.y, r: entry.circle.r * NAME_QUIET_RATIO});
          if (!reading) drawCategoryGlow(ctx, screenPos, radiusPx);
        }
        // A star's light. Dimmer once its name sits on it, like the particles behind the name.
        if (entry.kind === 'star' || entry.kind === 'galaxy-star') drawStarCore(ctx, screenPos, starRadiusPx, (stage === 'nebula' ? 0.85 : 0.35) * dim);
        catNodes.push({id, radiusPx});
      }
      if (open) {
        const items = itemCirclesRef.current.get(id);
        if (!items) continue;
        const snippetsOn = starRadiusPx >= SNIPPET_STAR_PX;
        for (const [itemId, entryItem] of items) {
          if (!isVisible(entryItem.circle, camera, viewport)) continue;
          const key = itemKey(id, itemId);
          const r = screenRadius(entryItem.circle, camera);
          itemNodes.push({key, radiusPx: r});
          const pos = worldToScreen(camera, viewport, entryItem.circle);
          const label = itemLabel(entryItem.item);
          const selected = selectedKeyRef.current === key;
          const lit = highlightRef.current?.itemId === itemId;
          const priority = (selected ? 1e6 : 0) + (lit ? 1e5 : 0) + (entryItem.item.node.untitled ? 0 : 10) + Math.min(r, 9);
          const width = Math.min(estimateLabelWidth(label, LABEL_FONT_PX), viewport.width <= 850 ? LABEL_MAX_NARROW_PX : LABEL_MAX_PX);
          const titleY = pos.y + r + LABEL_GAP_PX + LABEL_LINE_PX / 2;
          boxes.push({id: key, x: pos.x, y: titleY, width, height: LABEL_LINE_PX, priority});
          if (snippetsOn && !entryItem.item.node.untitled && entryItem.item.snippet) {
            boxes.push({id: `${key}#s`, x: pos.x, y: titleY + LABEL_LINE_PX / 2 + 4 + SNIPPET_BOX.height / 2, width: SNIPPET_BOX.width, height: SNIPPET_BOX.height, priority: priority - 1});
          }
        }
      }
    }
    // A snippet only shows under a shown title.
    const resolved = resolveLabels(boxes, LABEL_PAD_PX);
    for (const id of [...resolved]) if (id.endsWith('#s') && !resolved.has(id.slice(0, -2))) resolved.delete(id);
    labelsRef.current = resolved;

    catNodes.sort((a, b) => b.radiusPx - a.radiusPx);
    itemNodes.sort((a, b) => b.radiusPx - a.radiusPx);
    positionDomButtons(camera, viewport);
    commitDom(catNodes.slice(0, MAX_DOM_CATEGORIES).map(n => n.id), itemNodes.slice(0, MAX_DOM_ITEMS).map(n => n.key));

    const nextCrumb = computeCrumb();
    setCrumbText(prev => (prev === nextCrumb ? prev : nextCrumb));
  }

  function schedulePaint(): void {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(paint);
  }

  // ---- Camera motion ------------------------------------------------------------------------------------

  function stopFlight(): void {
    if (flightRafRef.current !== null) { cancelAnimationFrame(flightRafRef.current); flightRafRef.current = null; }
  }
  function stopInertia(): void {
    if (inertiaRafRef.current !== null) { cancelAnimationFrame(inertiaRafRef.current); inertiaRafRef.current = null; }
    velocityRef.current = {x: 0, y: 0};
  }
  function stopZoom(): void {
    if (zoomRafRef.current !== null) { cancelAnimationFrame(zoomRafRef.current); zoomRafRef.current = null; }
    zoomPendingRef.current = 0;
  }

  function updateUrl(categoryId: string | null, target: ReaderTarget | null = readerRef.current, push = false): void {
    const params = new URLSearchParams();
    if (categoryId) params.set('c', categoryId);
    if (target?.kind === 'doc') params.set('doc', target.versionId);
    if (target?.kind === 'star-missing') params.set('star', target.categoryId);
    const url = params.size ? `/universe?${params.toString()}` : '/universe';
    if (push) window.history.pushState({universe: true}, '', url);
    else window.history.replaceState({universe: true}, '', url);
  }

  async function fetchStarDoc(categoryId: string, signal?: AbortSignal): Promise<UniverseItem | null> {
    if (starDocsRef.current.has(categoryId)) return starDocsRef.current.get(categoryId) ?? null;
    const source = sourceRef.current;
    if (!source) return null;
    let pending = starDocLoadingRef.current.get(categoryId);
    if (!pending) {
      pending = source.star(categoryId, signal).then(doc => { if (mountedRef.current) starDocsRef.current.set(categoryId, doc); return doc; }).finally(() => starDocLoadingRef.current.delete(categoryId));
      starDocLoadingRef.current.set(categoryId, pending);
    }
    return pending;
  }

  async function fetchItemsFor(categoryId: string, signal?: AbortSignal): Promise<void> {
    if (itemCirclesRef.current.has(categoryId)) return;
    const entry = categoriesRef.current.get(categoryId);
    const source = sourceRef.current;
    if (!entry || !source) return;
    loadedItemsRef.current.add(categoryId);
    try {
      const [items] = await Promise.all([source.items(categoryId, signal), fetchStarDoc(categoryId, signal).catch(() => null)]);
      if (!mountedRef.current) return;
      const circles = placeOrbits(entry.star, items.map(item => item.id), entry.category.layoutSeed);
      const map = new Map<string, ItemEntry>();
      for (const item of items) { const circle = circles.get(item.id); if (circle) map.set(item.id, {item, circle}); }
      itemCirclesRef.current.set(categoryId, map);
      schedulePaint();
    } catch { loadedItemsRef.current.delete(categoryId); }
  }

  function placeCategory(kid: UniverseCategory, circle: Circle, parentId: string | null, hole: Circle | undefined): void {
    const kind = bodyKind(kid);
    categoriesRef.current.set(kid.id, {category: kid, circle, parentId, kind, star: starCircle(kid, circle, hole?.r ?? circle.r * ORBIT_INNER)});
  }

  async function fetchChildrenFor(categoryId: string, signal?: AbortSignal): Promise<void> {
    const entry = categoriesRef.current.get(categoryId);
    const source = sourceRef.current;
    if (!entry || !source) { loadedChildrenRef.current.delete(categoryId); return; }
    try {
      const kids = await source.children(categoryId, signal);
      if (!mountedRef.current) return;
      const circles = packChildren(entry.circle, kids.map(kid => ({id: kid.id, mass: kid.mass})), entry.category.layoutSeed, undefined, CENTER_HOLE * Math.sqrt(Math.max(1, ...kids.map(kid => kid.mass))));
      const hole = circles.get(HOLE_KEY);
      // The parent's own documents orbit inside the reserved centre now that its size is known.
      if (hole && entry.kind === 'galaxy-star') entry.star = hole;
      for (const kid of kids) {
        const circle = circles.get(kid.id);
        if (circle) placeCategory(kid, circle, categoryId, undefined);
      }
      schedulePaint();
    } catch { loadedChildrenRef.current.delete(categoryId); }
  }

  async function fetchNearby(): Promise<void> {
    const source = sourceRef.current;
    if (!source) return;
    const candidates: FetchCandidate[] = [...categoriesRef.current.entries()].map(([id, entry]) => ({id, circle: entry.circle, starCircle: entry.star, childCount: entry.category.childCount, directCount: entry.category.directCount}));
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
    touchedRef.current = true;
    setPillHidden(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setPillHidden(false), IDLE_MS);
  }

  /** `categoryId` undefined leaves the URL alone (the reader already wrote it); null means "wherever we landed". */
  function afterFly(categoryId: string | null | undefined): void {
    if (categoryId !== undefined) updateUrl(categoryId ?? currentCategoryId());
    markCameraChanged();
    void fetchNearby();
  }

  function flyTo(circle: Circle, categoryId: string | null, margin = 0.8): void {
    lastFitRef.current = {circle, margin};
    touchedRef.current = false;
    glideTo(fitCircle(viewportRef.current, circle, margin), categoryId);
  }

  function glideTo(target: Camera, categoryId: string | null | undefined = null): void {
    stopInertia();
    stopFlight();
    stopZoom();
    if (reducedMotionRef.current) {
      cameraRef.current = target;
      schedulePaint();
      afterFly(categoryId);
      return;
    }
    const from = {...cameraRef.current};
    const duration = flightMs(from, target);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      cameraRef.current = interpolate(from, target, t);
      schedulePaint();
      if (t < 1) { flightRafRef.current = requestAnimationFrame(tick); }
      else { flightRafRef.current = null; afterFly(categoryId); }
    };
    flightRafRef.current = requestAnimationFrame(tick);
  }

  /** Wheel zoom eases toward its target over a few frames instead of jumping per notch. */
  function smoothZoom(logFactor: number, anchor: {x: number; y: number}): void {
    stopFlight();
    zoomAnchorRef.current = anchor;
    if (reducedMotionRef.current) {
      cameraRef.current = zoomAt(cameraRef.current, viewportRef.current, anchor, Math.exp(logFactor));
      schedulePaint();
      return;
    }
    zoomPendingRef.current = Math.max(-WHEEL_MAX_LOG, Math.min(WHEEL_MAX_LOG, zoomPendingRef.current + logFactor));
    if (zoomRafRef.current !== null) return;
    const tick = () => {
      const pending = zoomPendingRef.current;
      const step = Math.abs(pending) < 0.004 ? pending : pending * ZOOM_SMOOTHING;
      cameraRef.current = zoomAt(cameraRef.current, viewportRef.current, zoomAnchorRef.current, Math.exp(step));
      zoomPendingRef.current = pending - step;
      schedulePaint();
      markCameraChanged();
      if (Math.abs(zoomPendingRef.current) > 0.0005) zoomRafRef.current = requestAnimationFrame(tick);
      else { zoomRafRef.current = null; zoomPendingRef.current = 0; }
    };
    zoomRafRef.current = requestAnimationFrame(tick);
  }

  function zoomCentre(factor: number): void {
    const viewport = viewportRef.current;
    smoothZoom(Math.log(factor), {x: viewport.width / 2, y: viewport.height / 2});
    markCameraChanged();
    markActive();
  }

  // ---- Selection and navigation -------------------------------------------------------------------------

  /** Arrow keys move to the nearest rendered node in that direction and centre it; Enter then opens it. */
  function stepSelection(key: string): boolean {
    const nodes = [...buttonElsRef.current].map(([nodeKey, el]) => {
      const rect = el.getBoundingClientRect();
      return {key: nodeKey, el, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width};
    }).filter(node => node.width > 0);
    if (!nodes.length) return false;
    const viewport = viewportRef.current;
    const current = nodes.find(node => node.key === selectedKeyRef.current)
      ?? nodes.reduce((best, node) => Math.hypot(node.x - viewport.width / 2, node.y - viewport.height / 2) < Math.hypot(best.x - viewport.width / 2, best.y - viewport.height / 2) ? node : best);
    const next = current.key === selectedKeyRef.current ? directionalNode(nodes, current, key) : current;
    if (!next) return true;
    select(next.key);
    armedKeyRef.current = next.key;
    next.el.focus({preventScroll: true});
    const world = screenToWorld(cameraRef.current, viewport, {x: next.x, y: next.y});
    glideTo({...cameraRef.current, x: world.x, y: world.y}, null);
    return true;
  }

  function select(key: string | null): void {
    selectedKeyRef.current = key;
    schedulePaint();
  }

  function activateSelection(): void {
    const key = selectedKeyRef.current;
    if (!key) return;
    if (key.includes('::')) {
      const [categoryId, id] = splitItemKey(key);
      const entry = itemCirclesRef.current.get(categoryId)?.get(id);
      if (entry) openItem(entry.item, categoryId);
      return;
    }
    const entry = categoriesRef.current.get(key);
    if (!entry) return;
    if (entry.category.directCount > 0 && itemsOpen(screenRadius(entry.star, cameraRef.current), stageScale(viewportRef.current))) { void openStar(key); return; }
    flyTo(entry.circle, key);
  }

  function flyToParentOrRoot(): void {
    const id = currentCategoryId();
    if (!id) { flyTo(rootCircle(), null, 0.92); return; }
    const entry = categoriesRef.current.get(id);
    const parentId = entry?.parentId ?? null;
    const parentEntry = parentId ? categoriesRef.current.get(parentId) : null;
    flyTo(parentEntry ? parentEntry.circle : rootCircle(), parentId, parentEntry ? 0.8 : 0.92);
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

  // ---- Reader ---------------------------------------------------------------------------------------------

  /** `camera` moves the view only for arrivals from search or a link; a tap opens the document where the view already is. */
  function openReader(target: ReaderTarget, camera: Camera | null, push: boolean): void {
    if (!readerRef.current) returnCameraRef.current = camera ? {...cameraRef.current} : null;
    readerRef.current = target;
    setReader(target);
    relatedRef.current = new Map();
    if (push) { updateUrl(target.categoryId, target, true); readerPushesRef.current += 1; }
    else updateUrl(target.categoryId, target);
    if (camera) glideTo(camera, undefined);
    else schedulePaint();
  }

  function closeReader(viaHistory: boolean): void {
    const open = readerRef.current;
    if (!open) return;
    readerRef.current = null;
    setReader(null);
    relatedRef.current = new Map();
    const back = returnCameraRef.current;
    returnCameraRef.current = null;
    if (viaHistory && readerPushesRef.current > 0) { readerPushesRef.current -= 1; window.history.back(); }
    else updateUrl(open.categoryId, null);
    if (back) glideTo(back, null); else schedulePaint();
    const el = selectedKeyRef.current ? buttonElsRef.current.get(selectedKeyRef.current) : null;
    el?.focus({preventScroll: true});
  }

  function openItem(item: UniverseItem, categoryId: string, push = true): void {
    const category = categoriesRef.current.get(categoryId);
    if (!item.versionId || !category) { window.location.assign(item.href); return; }
    select(itemKey(categoryId, item.id));
    openReader({kind: 'doc', versionId: item.versionId, role: 'planet', categoryId, categoryLabel: category.category.label, planetCount: category.category.directCount}, null, push);
  }

  async function openStar(categoryId: string, push = true): Promise<void> {
    const entry = categoriesRef.current.get(categoryId);
    if (!entry) return;
    select(categoryId);
    const doc = await fetchStarDoc(categoryId).catch(() => null);
    if (!mountedRef.current) return;
    const common = {categoryId, categoryLabel: entry.category.label, planetCount: entry.category.directCount};
    const target: ReaderTarget = doc?.versionId ? {kind: 'doc', versionId: doc.versionId, role: 'star', ...common} : {kind: 'star-missing', ...common};
    openReader(target, null, push);
  }

  /** From the reader: open another version (an earlier one, a related record). Camera stays; the field marks it if it is here. */
  function openVersionFromReader(versionId: string): void {
    const open = readerRef.current;
    if (!open) return;
    const category = categoriesRef.current.get(open.categoryId);
    const target: ReaderTarget = {kind: 'doc', versionId, role: 'planet', categoryId: open.categoryId, categoryLabel: category?.category.label ?? '', planetCount: category?.category.directCount ?? 0};
    readerRef.current = target;
    setReader(target);
    updateUrl(open.categoryId, target, true);
    readerPushesRef.current += 1;
  }

  const onNeighbors = useCallback((neighbors: ReaderNeighbor[]) => {
    relatedRef.current = new Map(neighbors.map(n => [n.versionId, relationLabel(n.predicate)]));
    schedulePaint();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Open what a URL names (a document or a star without one) after the field around it is placed. */
  async function restoreReader(params: URLSearchParams, signal: AbortSignal): Promise<void> {
    const source = sourceRef.current;
    if (!source) return;
    const doc = params.get('doc'), star = params.get('star');
    if (star) {
      const entry = categoriesRef.current.get(star);
      if (!entry) return;
      cameraRef.current = fitCircle(viewportRef.current, entry.star, 0.8);
      await fetchItemsFor(star, signal);
      if (signal.aborted) return;
      await openStar(star, false);
      return;
    }
    if (!doc) return;
    const path = await source.pathTo(doc, signal);
    const categoryId = path[path.length - 1];
    const entry = categoryId ? categoriesRef.current.get(categoryId) : undefined;
    if (!entry || signal.aborted) return;
    cameraRef.current = fitCircle(viewportRef.current, entry.star, 0.8);
    await fetchItemsFor(categoryId, signal);
    if (signal.aborted) return;
    const items = itemCirclesRef.current.get(categoryId);
    const found = items ? [...items.values()].find(candidate => candidate.item.versionId === doc) : undefined;
    const starDoc = starDocsRef.current.get(categoryId);
    if (found) openItem(found.item, categoryId, false);
    else if (starDoc && starDoc.versionId === doc) await openStar(categoryId, false);
    else openReader({kind: 'doc', versionId: doc, role: 'planet', categoryId, categoryLabel: entry.category.label, planetCount: entry.category.directCount}, null, false);
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
      if (readerRef.current) closeReader(true);
      flyTo(entry.star, categoryId);
      await fetchItemsFor(categoryId, controller.signal);
      if (!mountedRef.current) return;
      const items = itemCirclesRef.current.get(categoryId);
      const found = items ? [...items.values()].find(candidate => candidate.item.versionId === versionId) : undefined;
      if (found) select(itemKey(categoryId, found.item.id));
      highlightItem(hit.key);
    } catch { if (!controller.signal.aborted) showNotFound(); }
  }

  // Newly mounted buttons have no size until the next paint positions them.
  useEffect(() => { schedulePaint(); }, [domCategoryIds, domItemKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { schedulePaint(); }, [reader]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Mount: build the source, place the roots, honour deep links, then keep fetching as the camera settles.
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
        const circles = packChildren(rootCircle(), roots.map(cat => ({id: cat.id, mass: cat.mass})), 0, CENTER_CATEGORY_ID);
        for (const cat of roots) { const circle = circles.get(cat.id); if (circle) placeCategory(cat, circle, null, undefined); }
        if (containerRef.current) { viewportRef.current = {width: containerRef.current.clientWidth, height: containerRef.current.clientHeight}; resizeCanvas(); }
        const params = new URLSearchParams(window.location.search);
        const target = params.get('c');
        const targetEntry = target ? categoriesRef.current.get(target) : null;
        const fit = {circle: targetEntry ? targetEntry.circle : rootCircle(), margin: targetEntry ? 0.8 : 0.92};
        cameraRef.current = fitCircle(viewportRef.current, fit.circle, fit.margin);
        lastFitRef.current = fit;
        schedulePaint();
        markCameraChanged();
        await restoreReader(params, controller.signal);
        schedulePaint();
      } catch (error) {
        // Roots stay empty; nothing to place. An aborted load (React's dev double-mount) is expected.
        if (!(error instanceof DOMException && error.name === 'AbortError')) console.error(error);
      }
    })();

    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as {__universe?: unknown}).__universe = () => ({armed: armedKeyRef.current, selected: selectedKeyRef.current, camera: cameraRef.current, viewport: viewportRef.current, categories: [...categoriesRef.current.values()].map(entry => ({id: entry.category.id, circle: entry.circle, star: entry.star})), fit: lastFitRef.current});
    }
    const onResize = () => {
      if (!containerRef.current) return;
      viewportRef.current = {width: containerRef.current.clientWidth, height: containerRef.current.clientHeight};
      resizeCanvas();
      // Before the visitor has moved anything (or while the pane was still 0×0), a resize re-fits the same view.
      const fit = lastFitRef.current;
      if (fit && !touchedRef.current && viewportRef.current.width > 0 && viewportRef.current.height > 0 && !readerRef.current) {
        cameraRef.current = fitCircle(viewportRef.current, fit.circle, fit.margin);
        markCameraChanged();
      }
      schedulePaint();
    };
    window.addEventListener('resize', onResize);
    // A tab opened in the background can change size without a window resize event.
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (readerRef.current) return;
      const rect = container.getBoundingClientRect();
      const anchor = {x: event.clientX - rect.left, y: event.clientY - rect.top};
      // Trackpad pinch arrives as a wheel with ctrlKey: follow the fingers directly. Notches and two-finger scroll ease.
      if (event.ctrlKey) {
        stopFlight();
        cameraRef.current = zoomAt(cameraRef.current, viewportRef.current, anchor, Math.exp(-event.deltaY * 0.01));
        schedulePaint();
      } else {
        const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * viewportRef.current.height : event.deltaY;
        smoothZoom(-delta * WHEEL_STEP, anchor);
      }
      markCameraChanged();
      markActive();
    };
    container.addEventListener('wheel', onWheel, {passive: false});

    const pinchInfo = (event: TouchEvent): PinchState => {
      const rect = container.getBoundingClientRect();
      const [a, b] = [event.touches[0], event.touches[1]];
      return {dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mid: {x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top}};
    };
    const onTouchStart = (event: TouchEvent) => { if (event.touches.length === 2) { stopFlight(); stopInertia(); stopZoom(); pinchRef.current = pinchInfo(event); } };
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
      if (event.key === 'Escape') { event.preventDefault(); if (readerRef.current) closeReader(true); else flyToParentOrRoot(); return; }
      if (readerRef.current) return; // Reading keys belong to the reader while it is open.
      if (event.key === 'Enter') { event.preventDefault(); activateSelection(); return; }
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

    // Back closes the reader (or reopens it when going forward); the camera returns to where the reader was opened.
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const wantsReader = params.has('doc') || params.has('star');
      if (!wantsReader && readerRef.current) { closeReader(false); return; }
      if (wantsReader) {
        const key = params.get('doc') ? `doc:${params.get('doc')}` : `star:${params.get('star')}`;
        if (readerRef.current && readerTargetKey(readerRef.current) === key) return;
        void restoreReader(params, new AbortController().signal);
      }
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPopState);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      // Reset, not just cancel: React's dev double-mount reruns this effect and schedulePaint checks for null.
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      stopFlight();
      stopInertia();
      stopZoom();
      if (stillTimerRef.current) clearTimeout(stillTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (notFoundTimerRef.current) clearTimeout(notFoundTimerRef.current);
      if (domTimerRef.current) clearTimeout(domTimerRef.current);
      for (const c of fetchControllersRef.current) c.abort();
      searchControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Pointer input ------------------------------------------------------------------------------------

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    activePointersRef.current.add(event.pointerId);
    if (activePointersRef.current.size > 1) { pointerRef.current = null; return; }
    stopFlight();
    stopInertia();
    stopZoom();
    pointerRef.current = {id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, lastAt: performance.now(), moved: false, samples: []};
    markActive();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!pointer.moved) return;
    cameraRef.current = panBy(cameraRef.current, dx, dy);
    schedulePaint();
    markCameraChanged();
    markActive();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_FLICK) { vx = (vx / speed) * MAX_FLICK; vy = (vy / speed) * MAX_FLICK; }
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Double-click on the field zooms in around the pointer; on a body it opens it. */
  const onDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = {x: event.clientX - rect.left, y: event.clientY - rect.top};
    const target = zoomAt(cameraRef.current, viewportRef.current, anchor, DOUBLE_CLICK_ZOOM);
    glideTo({...target, scale: clampScale(target.scale)}, null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Centre a body on screen at the current zoom, so a first tap only brings it closer and never opens anything. */
  function centreOn(circle: Circle): void {
    glideTo({...cameraRef.current, x: circle.x, y: circle.y}, null);
  }

  const onCategoryClick = useCallback((id: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) return;
    const entry = categoriesRef.current.get(id);
    if (!entry) return;
    const wasArmed = armedKeyRef.current === id;
    armedKeyRef.current = id;
    select(id);
    const camera = cameraRef.current, viewport = viewportRef.current;
    const open = entry.category.directCount > 0 && itemsOpen(screenRadius(entry.star, camera), stageScale(viewport));
    if (open) {
      // Inside an open star, its name at the centre is the description: one tap selects it, a second (or a double tap) opens it.
      const field = containerRef.current?.getBoundingClientRect() ?? {left: 0, top: 0};
      const centre = worldToScreen(camera, viewport, entry.star);
      const distance = Math.hypot(event.clientX - field.left - centre.x, event.clientY - field.top - centre.y);
      if (distance <= screenRadius(entry.star, camera) * ORBIT_INNER) {
        if (wasArmed || event.detail >= 2) void openStar(id);
        else centreOn(entry.star);
        return;
      }
      if (event.detail >= 2) return;
      flyTo(entry.star, id);
      return;
    }
    flyTo(entry.circle, id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onItemClick = useCallback((item: UniverseItem, categoryId: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) return;
    const key = itemKey(categoryId, item.id);
    // First tap: select and centre the planet (its title shows). Second tap, double tap or Enter: read it.
    if (armedKeyRef.current !== key && event.detail < 2) {
      armedKeyRef.current = key;
      select(key);
      const circle = itemCirclesRef.current.get(categoryId)?.get(item.id)?.circle;
      if (circle) centreOn(circle);
      return;
    }
    openItem(item, categoryId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || composing) return;
    event.preventDefault();
    void runSearch(query);
  }, [composing, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const dockHidden = (pillHidden && !inputFocused) || reader !== null;

  function renderCategoryButton(id: string) {
    const entry = categoriesRef.current.get(id);
    if (!entry) return null;
    return (
      <button key={id} type="button" className="universe-category" aria-label={`${entry.category.label}, ${entry.kind === 'galaxy' ? '은하' : entry.kind === 'galaxy-star' ? '항성이 있는 은하' : '항성'}`}
        ref={el => bindButton(id, el)} onClick={event => onCategoryClick(id, event)} onFocus={() => select(id)}>
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
        ref={el => bindButton(key, el)} onClick={event => onItemClick(entry.item, categoryId, event)} onFocus={() => select(key)}>
        <span className="universe-item-dot" aria-hidden="true" />
        <span className="universe-item-title">{itemLabel(entry.item)}</span>
        {!entry.item.node.untitled && <span className="universe-item-snippet">{entry.item.snippet}</span>}
      </button>
    );
  }

  return (
    <div className="universe-root" data-reading={reader !== null}>
      <canvas ref={canvasRef} className="universe-canvas" aria-hidden="true" />
      <div ref={containerRef} className="universe-viewport" tabIndex={-1} aria-hidden={reader !== null}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={event => finishPointer(event)} onPointerCancel={event => finishPointer(event, true)}
        onDoubleClick={onDoubleClick}>
        {domCategoryIds.map(renderCategoryButton)}
        {domItemKeys.map(renderItemButton)}
      </div>
      {reader && (
        <UniverseReader target={reader} reducedMotion={reducedMotionRef.current}
          onClose={() => closeReader(true)} onOpenVersion={openVersionFromReader} onNeighbors={onNeighbors} />
      )}
      <div className="universe-chrome" data-hidden={reader !== null}>
        <p className="universe-crumb" aria-live="polite">{notFound ? '찾지 못했다' : crumbText}</p>
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
