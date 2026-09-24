// Map-style label placement: labels are boxes on the screen; a label is shown only when it does not overlap a
// label of higher priority. Zooming in spreads the boxes apart, so labels appear one by one instead of piling up.

export type LabelBox = {id: string; x: number; y: number; width: number; height: number; priority: number};

/** Approximate rendered width: CJK glyphs are about one em, Latin and digits about 0.56 em. */
export function estimateLabelWidth(text: string, fontPx: number): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width += code > 0x2e7f ? fontPx : code === 0x20 ? fontPx * 0.3 : fontPx * 0.56;
  }
  return width;
}

function overlaps(a: LabelBox, b: LabelBox, pad: number): boolean {
  return Math.abs(a.x - b.x) * 2 < a.width + b.width + pad && Math.abs(a.y - b.y) * 2 < a.height + b.height + pad;
}

/** Ids of the labels to show. Greedy by priority (desc), then id, so the result is deterministic. */
export function resolveLabels(boxes: LabelBox[], pad = 6): Set<string> {
  const sorted = [...boxes].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shown: LabelBox[] = [];
  const ids = new Set<string>();
  for (const box of sorted) {
    if (shown.some(other => overlaps(box, other, pad))) continue;
    shown.push(box);
    ids.add(box.id);
  }
  return ids;
}

// Human-readable relation-predicate labels for the reader's satellites (B §2.1): a fixed Korean label for
// every known core predicate and for the `x:scope:*` namespace the moderation skill uses for scope
// judgements; any other `x:<namespace>:<name>` renders as `namespace · name`; an unrecognized core
// predicate (no colon, not in the map) falls back to the raw string as-is.
const RELATION_LABEL: Record<string, string> = {
  supports: '뒷받침',
  contradicts: '반박',
  corrects: '정정',
  depends_on: '전제',
  defines: '정의',
  same_meaning_as: '같은 뜻',
  translation_of: '번역',
  derived_from: '파생',
  related_to: '관련',
  'x:scope:broader': '범위 · 주장이 구절보다 넓음',
  'x:scope:narrower': '범위 · 출처를 좁게 읽음',
  'x:scope:shifted': '범위 · 같은 말, 다른 뜻',
};

export function relationLabel(predicate: string): string {
  const known = RELATION_LABEL[predicate];
  if (known) return known;
  if (predicate.startsWith('x:')) {
    const parts = predicate.split(':');
    if (parts.length >= 3) return `${parts[1]} · ${parts.slice(2).join(':')}`;
  }
  return predicate;
}

/** A label's anchor relative to its dot: below and the sides first (most legible), then the diagonals. */
export type LabelAnchor = 'b' | 't' | 'r' | 'l' | 'br' | 'bl' | 'tr' | 'tl';
export const LABEL_ANCHOR_ORDER: LabelAnchor[] = ['b', 'r', 't', 'l', 'br', 'bl', 'tr', 'tl'];

/** A label to place next to a dot: box dimensions and how urgently it should keep a spot. */
export type DotLabel = {id: string; x: number; y: number; width: number; height: number; priority: number};
export type PlacedDotLabel = {id: string; anchor: LabelAnchor; x: number; y: number; width: number; height: number};

function anchorCenter(px: number, py: number, anchor: LabelAnchor, width: number, height: number, axisGap: number, diagGap: number): {x: number; y: number} {
  switch (anchor) {
    case 'b': return {x: px, y: py + axisGap + height / 2};
    case 't': return {x: px, y: py - axisGap - height / 2};
    case 'r': return {x: px + axisGap + width / 2, y: py};
    case 'l': return {x: px - axisGap - width / 2, y: py};
    case 'br': return {x: px + diagGap + width / 2, y: py + diagGap + height / 2};
    case 'bl': return {x: px - diagGap - width / 2, y: py + diagGap + height / 2};
    case 'tr': return {x: px + diagGap + width / 2, y: py - diagGap - height / 2};
    case 'tl': return {x: px - diagGap - width / 2, y: py - diagGap - height / 2};
  }
}

/**
 * Places labels around their dots, trying up to 8 fixed anchors (below, right, above, left, then the four
 * diagonals, in that order) before giving up on a label. Greedy by priority like resolveLabels, but each
 * label gets several chances at a clear spot instead of exactly one. `blockers` are pre-placed boxes (e.g.
 * higher-priority names, or labels already placed for a neighbouring body in the same shared pass) a
 * candidate must also clear; `allowed` lets the caller reject a candidate for its own reasons (off-screen,
 * sitting on a dot) — a label whose id is always allowed (e.g. the selected one) can bypass that check.
 */
export function placeDotLabels(labels: DotLabel[], opts: {axisGap?: number; diagGap?: number; pad?: number; blockers?: LabelBox[]; allowed?: (id: string, x: number, y: number, width: number, height: number) => boolean} = {}): Map<string, PlacedDotLabel> {
  const {axisGap = 10, diagGap = 9, pad = 6, blockers = [], allowed} = opts;
  const sorted = [...labels].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shown: LabelBox[] = [...blockers];
  const placed = new Map<string, PlacedDotLabel>();
  for (const label of sorted) {
    for (const anchor of LABEL_ANCHOR_ORDER) {
      const c = anchorCenter(label.x, label.y, anchor, label.width, label.height, axisGap, diagGap);
      if (allowed && !allowed(label.id, c.x, c.y, label.width, label.height)) continue;
      const box: LabelBox = {id: label.id, x: c.x, y: c.y, width: label.width, height: label.height, priority: label.priority};
      if (shown.some(other => overlaps(box, other, pad))) continue;
      shown.push(box);
      placed.set(label.id, {id: label.id, anchor, x: c.x, y: c.y, width: label.width, height: label.height});
      break;
    }
  }
  return placed;
}

// ---- Motion stability (A1): while the camera is moving, the field freezes the last computed label
// visibility/anchor choice instead of recomputing it every frame — recomputing (and re-fading) only once the
// camera has been still for STILL_MS. Kept as a pure function so it is unit-testable without any DOM.
export type LabelState = {visible: Set<string>; anchors: Map<string, LabelAnchor>};

export const EMPTY_LABEL_STATE: LabelState = {visible: new Set(), anchors: new Map()};

/** Ids whose visibility or anchor differs between two label states — these are the only ones that should fade. */
export function diffLabelState(prev: LabelState, next: LabelState): Set<string> {
  const changed = new Set<string>();
  for (const id of next.visible) {
    if (!prev.visible.has(id) || prev.anchors.get(id) !== next.anchors.get(id)) changed.add(id);
  }
  for (const id of prev.visible) {
    if (!next.visible.has(id)) changed.add(id);
  }
  return changed;
}

/**
 * The motion-aware label state machine: while `moving` is true, returns `prev` unchanged (frozen) with no
 * changed ids; once still, calls `computeNext` and reports which ids actually changed so the caller can fade
 * only those in.
 */
export function resolveMotionLabels(moving: boolean, prev: LabelState, computeNext: () => LabelState): {state: LabelState; changed: Set<string>} {
  if (moving) return {state: prev, changed: new Set()};
  const next = computeNext();
  return {state: next, changed: diffLabelState(prev, next)};
}
