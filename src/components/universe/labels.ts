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
