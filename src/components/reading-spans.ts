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

// ---- Reader wording (1.9 §4 / B §2), kept free of JSX for the same reason as mergeSpans above: pure text
// and counting logic, unit-tested directly, then rendered by reader.tsx.

export type QuoteCheckState = 'found_exact' | 'found_normalized' | 'found_fragments' | 'not_found' | 'no_text' | 'no_quote' | 'not_applicable';

/** One row of B §2.1's quote-check table: worded against the submitted excerpt, never "원문" (the server
 *  never opens the source page). `compared` is the only thing colour may key off — found_* and not_found
 *  read the same, since the line never says right or wrong. `not_applicable` has no line at all. */
export const QUOTE_CHECK_TEXT: Record<QuoteCheckState, {text: string; compared: boolean} | null> = {
  found_exact: {text: '제출된 발췌에 글자 그대로 있음', compared: true},
  found_normalized: {text: '공백·따옴표 차이를 빼면 발췌에 있음', compared: true},
  found_fragments: {text: '‘…’로 나뉜 조각이 발췌에 차례로 있음', compared: true},
  not_found: {text: '제출된 발췌에서 찾지 못함', compared: true},
  no_text: {text: '발췌가 제출되지 않아 대조하지 않음', compared: false},
  no_quote: {text: '인용문이 없어 대조하지 않음', compared: false},
  not_applicable: null,
};

export type ReviewStance = 'agree' | 'disagree' | 'needs_review';
export type ReviewFocus = 'content' | 'evidence_support' | 'quote_match' | 'meaning';

/** Row order of B §2.2's table: 인용 일치 → 근거 뒷받침 → 내용 → 뜻 (the README's three questions, then meaning). */
export const REVIEW_FOCUS_ROWS: {focus: ReviewFocus; label: string}[] = [
  {focus: 'quote_match', label: '인용 일치'},
  {focus: 'evidence_support', label: '근거 뒷받침'},
  {focus: 'content', label: '내용'},
  {focus: 'meaning', label: '뜻'},
];
export const REVIEW_STANCES: {stance: ReviewStance; label: string}[] = [
  {stance: 'agree', label: '동의'},
  {stance: 'disagree', label: '반대'},
  {stance: 'needs_review', label: '검토 필요'},
];

/** Tally reviews into a focus × stance grid; every focus row is present (possibly all zero) so callers can
 *  filter empty rows themselves. */
export function countReviewsByFocus(reviews: {focus: ReviewFocus; stance: ReviewStance}[]): Map<ReviewFocus, Record<ReviewStance, number>> {
  const counts = new Map<ReviewFocus, Record<ReviewStance, number>>(
    REVIEW_FOCUS_ROWS.map(row => [row.focus, {agree: 0, disagree: 0, needs_review: 0}])
  );
  for (const review of reviews) {
    const bucket = counts.get(review.focus);
    if (bucket) bucket[review.stance] += 1;
  }
  return counts;
}
