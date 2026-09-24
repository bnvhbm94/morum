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

/** A label's anchor relative to its dot: the four cardinal sides, then the four diagonals, tried in that order. */
export type LabelAnchor = 'b' | 't' | 'r' | 'l' | 'br' | 'bl' | 'tr' | 'tl';
export const LABEL_ANCHOR_ORDER: LabelAnchor[] = ['b', 't', 'r', 'l', 'br', 'bl', 'tr', 'tl'];

/** A label to place next to a dot: box dimensions and how urgently it should keep a spot. */
export type DotLabel = {id: string; x: number; y: number; width: number; height: number; priority: number};
export type PlacedDotLabel = {id: string; anchor: LabelAnchor; x: number; y: number; width: number; height: number};

function anchorCenter(px: number, py: number, anchor: LabelAnchor, width: number, height: number, gap: number): {x: number; y: number} {
  switch (anchor) {
    case 'b': return {x: px, y: py + gap + height / 2};
    case 't': return {x: px, y: py - gap - height / 2};
    case 'r': return {x: px + gap + width / 2, y: py};
    case 'l': return {x: px - gap - width / 2, y: py};
    case 'br': return {x: px + gap + width / 2, y: py + gap + height / 2};
    case 'bl': return {x: px - gap - width / 2, y: py + gap + height / 2};
    case 'tr': return {x: px + gap + width / 2, y: py - gap - height / 2};
    case 'tl': return {x: px - gap - width / 2, y: py - gap - height / 2};
  }
}

/**
 * Places labels around their dots, trying up to 8 fixed anchors (below, above, right, left, then the four
 * diagonals, in that order) before giving up on a label. Greedy by priority like resolveLabels, but each
 * label gets several chances at a clear spot instead of exactly one. `blockers` are pre-placed boxes (e.g.
 * higher-priority names) a candidate must also clear; `allowed` lets the caller reject a candidate for its
 * own reasons (off-screen, sitting on a dot) — a label whose id is always allowed (e.g. the selected one)
 * can bypass that check.
 */
export function placeDotLabels(labels: DotLabel[], opts: {gap?: number; pad?: number; blockers?: LabelBox[]; allowed?: (id: string, x: number, y: number, width: number, height: number) => boolean} = {}): Map<string, PlacedDotLabel> {
  const {gap = 12, pad = 6, blockers = [], allowed} = opts;
  const sorted = [...labels].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shown: LabelBox[] = [...blockers];
  const placed = new Map<string, PlacedDotLabel>();
  for (const label of sorted) {
    for (const anchor of LABEL_ANCHOR_ORDER) {
      const c = anchorCenter(label.x, label.y, anchor, label.width, label.height, gap);
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
