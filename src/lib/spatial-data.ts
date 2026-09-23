import type {
  Anchor,
  ContentRef,
  Evidence,
  ObjectView,
  Source,
  ContextPage,
  LocationRef,
  PageInfo,
  Paged,
  RecordSummary,
  Relation,
  SearchHit,
  SearchRequest,
  SearchResponse,
  UnitLocator,
  Version,
  VersionView,
} from '../contracts/types';
import {apiGet, apiPost, excerpt, refHref} from './api-client';

export const SPATIAL_LIMIT = 20;
export const SPATIAL_RELATION_DISPLAY_LIMIT = 4;
const CACHE_LIMIT = 30;
const CACHE_TTL_MS = 60_000;

export type SpatialNode = {
  key: string;
  target: ContentRef;
  locator: UnitLocator | null;
  locators: UnitLocator[];
  title: string;
  snippet: string;
  href: string;
  isCurrent: boolean | null;
  versionState: 'current' | 'historical' | 'unknown';
  score: number | null;
  syntheticDemo: boolean;
  topic: string | null;
  untitled: boolean;
  /** Record id this record was marked a duplicate of (attributes.duplicate_of); such records are hidden from the galaxies. */
  duplicateOf: string | null;
  /** attributes.role: "star" marks the description document of its topic; it is shown on the star, not as a planet. */
  role: 'star' | null;
};

export type SpatialPage = {
  nodes: SpatialNode[];
  page: PageInfo;
  hasMore: boolean;
};

export type SpatialSearchOptions = Pick<SearchRequest, 'scope' | 'filters' | 'limit' | 'include_context'>;

export type RelationSide = 'left' | 'right' | 'context';

export type SpatialNeighbor = {
  node: SpatialNode;
  relation: Relation;
  side: RelationSide;
  direction: 'in' | 'out';
};

export type SpatialNeighbors = {
  items: SpatialNeighbor[];
  page: PageInfo;
  displayedLimit: number;
  hasMore: boolean;
  returnedCount: number;
};

type CacheEntry = {value: SearchResponse; expiresAt: number; usedAt: number};
const searchCache = new Map<string, CacheEntry>();

const emptyPage = (page?: Partial<PageInfo>): PageInfo => ({
  snapshot_at: null,
  next_cursor: null,
  snapshot_expires_at: null,
  truncated: false,
  ...page,
});

function nodeKey(target: ContentRef): string {
  return `${target.kind}:${target.id}`;
}

function versionState(value: boolean | null): SpatialNode['versionState'] {
  return value === true ? 'current' : value === false ? 'historical' : 'unknown';
}

function targetFromHit(hit: SearchHit): ContentRef {
  if (hit.version_id) return {kind: 'version', id: hit.version_id};
  if (hit.locator.kind === 'object') return hit.locator.target;
  return {kind: 'version', id: hit.locator.version_id};
}

function makeNode(input: {
  target: ContentRef;
  locator?: UnitLocator | null;
  title?: string | null;
  snippet?: string;
  isCurrent?: boolean | null;
  score?: number | null;
  syntheticDemo?: boolean;
  locators?: UnitLocator[];
  topic?: string | null;
  duplicateOf?: string | null;
  role?: string | null;
}): SpatialNode {
  const target = input.target;
  const snippet = input.snippet?.trim() || '';
  return {
    key: nodeKey(target),
    target,
    locator: input.locator ?? null,
    locators: input.locators ?? (input.locator ? [input.locator] : []),
    title: input.title?.trim() || excerpt(snippet, 72) || `${target.kind} ${target.id}`,
    snippet: excerpt(snippet, 240),
    href: refHref(target),
    isCurrent: input.isCurrent ?? null,
    versionState: versionState(input.isCurrent ?? null),
    score: input.score ?? null,
    syntheticDemo: input.syntheticDemo ?? false,
    topic: input.topic?.trim() || null,
    untitled: !input.title?.trim(),
    duplicateOf: input.duplicateOf?.trim() || null,
    role: input.role === 'star' ? 'star' : null,
  };
}

export function recordsToSpatialPage(data: Paged<RecordSummary>): SpatialPage {
  return {
    nodes: data.items.map((record) => makeNode({
      target: {kind: 'version', id: record.current.id},
      locator: {kind: 'object', target: {kind: 'version', id: record.current.id}},
      title: record.current.title,
      snippet: record.current.body_text,
      isCurrent: true,
      syntheticDemo: record.current.synthetic_demo,
      topic: typeof record.current.attributes?.topic === 'string' ? record.current.attributes.topic : null,
      duplicateOf: typeof record.current.attributes?.duplicate_of === 'string' ? record.current.attributes.duplicate_of : null,
      role: typeof record.current.attributes?.role === 'string' ? record.current.attributes.role : null,
    })),
    page: data.page,
    hasMore: Boolean(data.page.next_cursor || data.page.truncated),
  };
}

export function searchHitsToSpatialNodes(hits: SearchHit[]): SpatialNode[] {
  const grouped = new Map<string, SpatialNode>();
  for (const hit of hits) {
    const target = targetFromHit(hit);
    const existing = grouped.get(nodeKey(target));
    if (!existing) {
      grouped.set(nodeKey(target), makeNode({
        target,
        locator: hit.locator,
        title: hit.title,
        snippet: hit.snippet,
        isCurrent: hit.is_current,
        score: hit.rrf_score,
        syntheticDemo: hit.synthetic_demo,
      }));
      continue;
    }
    existing.locators.push(hit.locator);
    if ((hit.rrf_score ?? -Infinity) > (existing.score ?? -Infinity)) {
      existing.locator = hit.locator;
      existing.score = hit.rrf_score;
      existing.title = hit.title?.trim() || existing.title;
      existing.snippet = excerpt(hit.snippet, 240) || existing.snippet;
      existing.isCurrent = hit.is_current;
      existing.versionState = versionState(hit.is_current);
    }
    if (hit.title?.trim()) existing.untitled = false;
  }
  return [...grouped.values()];
}

function stableKey(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableKey(item)}`).join(',')}}`;
}

function searchKey(query: string, options: SpatialSearchOptions): string {
  return stableKey({query, ...options});
}

function readCached(key: string): SearchResponse | undefined {
  const entry = searchCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return undefined;
  }
  entry.usedAt = Date.now();
  return entry.value;
}

function writeCached(key: string, value: SearchResponse): void {
  const now = Date.now();
  searchCache.set(key, {value, expiresAt: now + CACHE_TTL_MS, usedAt: now});
  while (searchCache.size > CACHE_LIMIT) {
    const oldest = [...searchCache.entries()].sort(([, a], [, b]) => a.usedAt - b.usedAt)[0];
    if (oldest) searchCache.delete(oldest[0]);
    else break;
  }
}

/** Home window: up to HOME_PAGES pages of HOME_PAGE_SIZE records, so every galaxy is counted client-side. A server-side topic aggregation should replace this once the repository outgrows the window. */
export const HOME_PAGE_SIZE = 50;
export const HOME_PAGES = 4;

export async function loadSpatialHome(signal?: AbortSignal): Promise<SpatialPage> {
  const nodes: SpatialNode[] = [];
  let cursor: string | null = null;
  let page: PageInfo = emptyPage();
  for (let index = 0; index < HOME_PAGES; index += 1) {
    const query = new URLSearchParams({limit: String(HOME_PAGE_SIZE)});
    if (cursor) query.set('cursor', cursor);
    const data: Paged<RecordSummary> = await apiGet<Paged<RecordSummary>>(`/records?${query}`, signal);
    nodes.push(...recordsToSpatialPage(data).nodes);
    page = data.page;
    cursor = data.page.next_cursor;
    if (!cursor) break;
  }
  return {nodes: nodes.filter(node => !node.duplicateOf), page, hasMore: Boolean(cursor || page.truncated)};
}

export async function loadSpatialSearch(query: string, options: SpatialSearchOptions, signal?: AbortSignal): Promise<SpatialPage & {response: SearchResponse}> {
  const trimmed = query.trim();
  if (!trimmed) {
    const home = await loadSpatialHome(signal);
    return {...home, response: {hits: [], context: null, context_coverage: {requested: false, unique_targets: 0, expanded_targets: 0, omitted_targets: []}, status: {mode: 'keyword_only', query_embedding: 'not_attempted', reason: 'empty_input', profile_id: null, indexed_units: 0, eligible_units: 0, quality_gate: 'not_evaluated', result_state: 'no_match'}, page: home.page, suggested_work_request: null}};
  }
  const request: SearchRequest = {query: trimmed, scope: options.scope, limit: Math.min(options.limit ?? SPATIAL_LIMIT, SPATIAL_LIMIT), include_context: options.include_context ?? true, ...(options.filters ? {filters: options.filters} : {})};
  const key = searchKey(trimmed, request);
  const cached = readCached(key);
  const response = cached ?? await apiPost<SearchResponse>('/search', request, signal);
  if (!cached) writeCached(key, response);
  return {nodes: searchHitsToSpatialNodes(response.hits), page: response.page, hasMore: Boolean(response.page.next_cursor || response.page.truncated), response};
}

export async function loadSpatialVersion(versionId: string, signal?: AbortSignal): Promise<VersionView> {
  return apiGet<VersionView>(`/versions/${encodeURIComponent(versionId)}`, signal);
}

export async function loadSpatialContext(target: ContentRef, depth: 1 | 2 = 1, signal?: AbortSignal): Promise<ContextPage> {
  const params = new URLSearchParams({target_kind: target.kind, target_id: target.id, depth: String(depth)});
  return apiGet<ContextPage>(`/context?${params}`, signal);
}

export async function loadSpatialContextMany(seeds: ContentRef[], depth: 1 | 2 = 1, signal?: AbortSignal): Promise<ContextPage> {
  return apiPost<ContextPage>('/context', {seeds: seeds.slice(0, 5), depth}, signal);
}

export type LayoutEdge = {left: string; right: string; relation: Relation};

function locationKey(ref: LocationRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function layoutEdges(relations: Relation[], nodeKeys: Set<string>): LayoutEdge[] {
  const edges: LayoutEdge[] = [];
  const seenPairs = new Set<string>();
  for (const relation of relations) {
    if (relation.from.kind !== 'version' || relation.to.kind !== 'version') continue;
    const fromKey = locationKey(relation.from), toKey = locationKey(relation.to);
    if (!nodeKeys.has(fromKey) || !nodeKeys.has(toKey)) continue;
    let left: string, right: string;
    if (relation.predicate === 'supports') { left = fromKey; right = toKey; }
    else if (relation.predicate === 'corrects' || relation.predicate === 'derived_from' || relation.predicate === 'depends_on') { left = toKey; right = fromKey; }
    else continue;
    const pairKey = [left, right].sort().join('|');
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    edges.push({left, right, relation});
  }
  return edges;
}

export function layoutNodes<T extends {key: string}>(nodes: T[], edges: LayoutEdge[], spiral: (index: number) => {x: number; y: number}): (T & {x: number; y: number})[] {
  const result: (T & {x: number; y: number})[] = [];
  const occupied = new Map<string, number>();
  const byKey = new Map<string, T & {x: number; y: number}>();

  const cellKey = (x: number, y: number) => `${x},${y}`;
  const place = (node: T, x: number, y: number) => {
    const placed = {...node, x, y};
    occupied.set(cellKey(x, y), result.length);
    result.push(placed);
    byKey.set(node.key, placed);
  };

  nodes.forEach((node, index) => {
    if (index === 0) { place(node, 0, 0); return; }
    let target: {x: number; y: number} | null = null;
    for (const edge of edges) {
      let otherKey: string | null = null, isLeft = false;
      if (edge.left === node.key && byKey.has(edge.right)) { otherKey = edge.right; isLeft = true; }
      else if (edge.right === node.key && byKey.has(edge.left)) { otherKey = edge.left; isLeft = false; }
      if (!otherKey) continue;
      const other = byKey.get(otherKey)!;
      const wantX = isLeft ? other.x - 1 : other.x + 1;
      const wantY = other.y;
      if (!occupied.has(cellKey(wantX, wantY))) { target = {x: wantX, y: wantY}; break; }
      const offsets = [1, -1, 2, -2];
      let found: {x: number; y: number} | null = null;
      for (const offset of offsets) {
        const candidate = {x: wantX, y: wantY + offset};
        if (!occupied.has(cellKey(candidate.x, candidate.y))) { found = candidate; break; }
      }
      if (found) { target = found; break; }
    }
    if (!target) {
      let i = 0;
      while (true) {
        const candidate = spiral(i);
        if (!occupied.has(cellKey(candidate.x, candidate.y))) { target = candidate; break; }
        i += 1;
      }
    }
    place(node, target.x, target.y);
  });

  return result;
}

function sameRef(a: LocationRef, b: LocationRef): boolean { return a.kind === b.kind && a.id === b.id; }

export function relationSide(relation: Relation, target: LocationRef): RelationSide {
  const targetIsFrom = sameRef(relation.from, target);
  const targetIsTo = sameRef(relation.to, target);
  if (!targetIsFrom && !targetIsTo) return 'context';
  switch (relation.predicate) {
    case 'supports': return targetIsTo ? 'left' : 'right';
    case 'depends_on':
    case 'derived_from':
    case 'corrects': return targetIsFrom ? 'left' : 'right';
    default: return 'context';
  }
}

function otherTarget(relation: Relation, target: LocationRef): ContentRef | null {
  if (sameRef(relation.from, target)) return relation.to;
  if (sameRef(relation.to, target)) return relation.from;
  return null;
}

export async function loadSpatialNeighbors(target: LocationRef, options?: {limit?: number; displayLimit?: number}, signal?: AbortSignal): Promise<SpatialNeighbors> {
  const fetchLimit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  const displayLimit = Math.min(Math.max(options?.displayLimit ?? SPATIAL_RELATION_DISPLAY_LIMIT, 1), fetchLimit);
  const query = new URLSearchParams({target_kind: target.kind, target_id: target.id, direction: 'both', limit: String(fetchLimit)});
  const data = await apiGet<Paged<Relation>>(`/relations?${query}`, signal);
  const items: SpatialNeighbor[] = [];
  for (const relation of data.items) {
    const other = otherTarget(relation, target);
    if (!other) continue;
    items.push({node: makeNode({target: other, title: null, snippet: relation.explanation}), relation, side: relationSide(relation, target), direction: sameRef(relation.from, target) ? 'out' : 'in'});
  }
  return {items: items.slice(0, displayLimit), page: data.page, displayedLimit: displayLimit, hasMore: Boolean(data.page.next_cursor || data.page.truncated || items.length > displayLimit), returnedCount: items.length};
}

export function resetSpatialSearchCache(): void { searchCache.clear(); }

export type Galaxy = {key: string; topic: string | null; label: string; nodes: SpatialNode[]};

export function groupGalaxies(nodes: SpatialNode[]): Galaxy[] {
  const tagged = new Map<string, Galaxy>();
  const order: string[] = [];
  const untagged: SpatialNode[] = [];
  for (const node of nodes) {
    if (node.topic === null) { untagged.push(node); continue; }
    const key = `topic:${node.topic}`;
    let galaxy = tagged.get(key);
    if (!galaxy) {
      galaxy = {key, topic: node.topic, label: node.topic, nodes: []};
      tagged.set(key, galaxy);
      order.push(key);
    }
    galaxy.nodes.push(node);
  }
  const taggedGalaxies = order.map((key) => tagged.get(key)!);
  taggedGalaxies.sort((a, b) => {
    const diff = b.nodes.length - a.nodes.length;
    if (diff !== 0) return diff;
    return order.indexOf(a.key) - order.indexOf(b.key);
  });
  const result = [...taggedGalaxies];
  if (untagged.length > 0) {
    result.push({key: 'untagged', topic: null, label: '미분류', nodes: untagged});
  }
  return result;
}

export type MidPlacement = {node: SpatialNode; x: number; y: number; foreign: boolean; dim: boolean};

export function placeGalaxy(galaxy: Galaxy, allNodes: SpatialNode[], relations: Relation[], spiral: (index: number) => {x: number; y: number}): MidPlacement[] {
  const memberKeys = new Set(galaxy.nodes.map((node) => node.key));
  const foreignNodes: SpatialNode[] = [];
  for (const relation of relations) {
    if (relation.from.kind !== 'version' || relation.to.kind !== 'version') continue;
    const fromKey = locationKey(relation.from), toKey = locationKey(relation.to);
    const fromInGalaxy = memberKeys.has(fromKey), toInGalaxy = memberKeys.has(toKey);
    if (!fromInGalaxy && !toInGalaxy) continue;
    for (const otherKey of [fromKey, toKey]) {
      if (memberKeys.has(otherKey)) continue;
      const foreignNode = allNodes.find((node) => node.key === otherKey);
      if (!foreignNode) continue;
      memberKeys.add(otherKey);
      foreignNodes.push(foreignNode);
    }
  }
  const foreignByAllOrder = allNodes.filter((node) => foreignNodes.includes(node));
  const members = [...galaxy.nodes, ...foreignByAllOrder];
  const memberKeySet = new Set(members.map((node) => node.key));
  const edges = layoutEdges(relations, memberKeySet);

  const dimmed = new Set<string>();
  for (const relation of relations) {
    if (relation.predicate !== 'corrects') continue;
    if (relation.to.kind !== 'version') continue;
    const toKey = locationKey(relation.to);
    if (memberKeySet.has(toKey)) dimmed.add(toKey);
  }

  const placed = layoutNodes(members, edges, spiral);
  const galaxyKeySet = new Set(galaxy.nodes.map((node) => node.key));
  return placed.map((node) => ({
    node,
    x: node.x,
    y: node.y,
    foreign: !galaxyKeySet.has(node.key),
    dim: dimmed.has(node.key),
  }));
}

export async function loadSpatialHistory(recordId: string, signal?: AbortSignal): Promise<Version[]> {
  const data = await apiGet<Paged<Version>>(`/records/${encodeURIComponent(recordId)}/versions?limit=20`, signal);
  return data.items;
}

// ---- Citations for one document: every evidence that supports it (whole document or an anchored span),
// resolved to the source it quotes. Bounded: at most CITATION_LIMIT evidence, one request per unknown object.
export const CITATION_LIMIT = 8;

export type Citation = {
  index: number;
  evidence: Evidence;
  source: Source | null;
  anchor: Anchor | null;
  /** True when the anchor's exact text still matches the document body at the recorded code-point range. */
  anchorMatches: boolean;
};

function codePointSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join('');
}

export async function loadSpatialCitations(view: VersionView, signal?: AbortSignal): Promise<Citation[]> {
  const known = new Map<string, Evidence>(view.basis.map(item => [item.id, item]));
  let context: ContextPage | null = null;
  try { context = await loadSpatialContext({kind: 'version', id: view.version.id}, 1, signal); } catch { context = null; }
  const extraIds = (context?.items ?? [])
    .filter(item => item.target.kind === 'evidence' && !known.has(item.target.id))
    .map(item => item.target.id);
  const extra = await Promise.all(extraIds.slice(0, CITATION_LIMIT).map(async id => {
    try { const object = await apiGet<ObjectView>(`/objects/evidence/${encodeURIComponent(id)}`, signal); return object.value as Evidence; }
    catch { return null; }
  }));
  for (const item of extra) if (item) known.set(item.id, item);
  const evidence = [...known.values()].slice(0, CITATION_LIMIT);

  const sourceIds = new Set(evidence.flatMap(item => item.basis.kind === 'external' ? [item.basis.source_id] : []));
  const anchorIds = new Set(evidence.flatMap(item => item.target.kind === 'anchor' ? [item.target.id] : []));
  const [sources, anchors] = await Promise.all([
    Promise.all([...sourceIds].map(async id => {
      try { const object = await apiGet<ObjectView>(`/objects/source/${encodeURIComponent(id)}`, signal); return [id, object.value as Source] as const; }
      catch { return [id, null] as const; }
    })),
    Promise.all([...anchorIds].map(async id => {
      try { const object = await apiGet<ObjectView>(`/objects/anchor/${encodeURIComponent(id)}`, signal); return [id, object.value as Anchor] as const; }
      catch { return [id, null] as const; }
    })),
  ]);
  const sourceById = new Map(sources), anchorById = new Map(anchors);
  return evidence.map((item, index) => {
    const anchor = item.target.kind === 'anchor' ? anchorById.get(item.target.id) ?? null : null;
    const anchorMatches = Boolean(anchor && anchor.version_id === view.version.id && codePointSlice(view.version.body_text, anchor.selector.start, anchor.selector.end) === anchor.selector.exact);
    return {index: index + 1, evidence: item, source: item.basis.kind === 'external' ? sourceById.get(item.basis.source_id) ?? null : null, anchor, anchorMatches};
  });
}
