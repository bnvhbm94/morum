// Pure span-merging logic shared by cited-body's citation marks and word-sense meaning marks.
// Kept free of JSX so it can be unit-tested directly under the plain-TS test harness.

export type ReadingSpan = {
  start: number;
  end: number;
  /** 'cite' sorts and wins ties the same way citations always have; 'meaning' is the new kind. */
  kind: 'cite' | 'meaning';
  /** Citation index (for 'cite') or annotation id (for 'meaning'), used as the React key. */
  key: string | number;
  /** Display number, shown as data-n; for citations this is the citation index, for meanings a 1-based position. */
  n: number | string;
  /** Only present on 'meaning' spans. */
  meaning?: string;
};

export type MergedSpan = ReadingSpan & {
  /** Set when a 'cite' span exactly coincides with a 'meaning' span: the citation mark also carries the meaning. */
  coincidentMeaning?: string;
};

/**
 * Merge citation and meaning spans into one non-overlapping sequence, sorted by start.
 * On overlap the earlier span (by start, then end) wins, matching the citation-only behavior.
 * An exact-range coincidence between a kept 'cite' span and a 'meaning' span attaches the meaning
 * to the citation instead of dropping it outright.
 */
export function mergeSpans(spans: ReadingSpan[]): MergedSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end || (a.kind === b.kind ? 0 : a.kind === 'cite' ? -1 : 1));
  const kept: MergedSpan[] = [];
  let cursor = 0;
  for (const span of sorted) {
    if (span.start < cursor) continue; // overlapping spans: keep the earlier one
    const coincident = span.kind === 'cite'
      ? sorted.find(other => other !== span && other.kind === 'meaning' && other.start === span.start && other.end === span.end)
      : undefined;
    if (span.kind === 'meaning') {
      // A meaning that exactly coincides with an earlier-sorted (or equal) citation was already folded into it above;
      // avoid emitting a redundant meaning-only span for the same range when a citation span will also cover it.
      const coincidesWithKeptCite = kept.some(k => k.kind === 'cite' && k.start === span.start && k.end === span.end);
      if (coincidesWithKeptCite) continue;
    }
    kept.push(coincident ? {...span, coincidentMeaning: coincident.meaning} : span);
    cursor = span.end;
  }
  return kept;
}
