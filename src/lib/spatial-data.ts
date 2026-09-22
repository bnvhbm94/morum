import type {
  ContentRef,
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

export async function loadSpatialHome(signal?: AbortSignal): Promise<SpatialPage> {
  const data = await apiGet<Paged<RecordSummary>>(`/records?limit=${SPATIAL_LIMIT}`, signal);
  return recordsToSpatialPage(data);
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
