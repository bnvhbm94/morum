import type {ReactNode} from 'react';
import type {Citation, Meaning} from '../lib/spatial-data';
import {mergeSpans, type ReadingSpan} from './reading-spans';

/** Superscript citation number, as shown in the body and on the evidence satellite. */
export function citeMark(index: number): string {
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return String(index).split('').map(d => digits[Number(d)]).join('');
}

/**
 * Body text with each anchored, still-matching citation wrapped in a mark carrying its number, and each
 * anchored, still-matching meaning wrapped in a `<mark>` carrying its meaning as a tooltip. Offsets are
 * Unicode code points, as the API records them. On overlap the earlier span (by start) wins; a citation and
 * a meaning that cover the exact same range are merged into one citation mark carrying `data-meaning` too.
 */
export function renderCitedBody(body: string, citations: Citation[], className = 'spatial-cite', meanings: Meaning[] = []): ReactNode {
  const points = Array.from(body);
  const citeSpans: ReadingSpan[] = citations
    .filter(citation => citation.anchor && citation.anchorMatches)
    .map(citation => ({start: citation.anchor!.selector.start, end: citation.anchor!.selector.end, kind: 'cite' as const, key: citation.index, n: citation.index}));
  const meaningSpans: ReadingSpan[] = meanings
    .filter(meaning => meaning.anchor && meaning.anchorMatches)
    .map((meaning, position) => ({start: meaning.anchor!.selector.start, end: meaning.anchor!.selector.end, kind: 'meaning' as const, key: meaning.annotation.id, n: position + 1, meaning: meaning.annotation.meaning}));
  const spans = mergeSpans([...citeSpans, ...meaningSpans]);

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) parts.push(points.slice(cursor, span.start).join(''));
    const text = points.slice(span.start, span.end).join('');
    if (span.kind === 'cite') {
      const meaningAttr = span.coincidentMeaning;
      parts.push(
        <mark key={`cite-${span.key}`} className={className} data-n={span.n} {...(meaningAttr ? {'data-meaning': meaningAttr} : {})}>
          {text}<sup>{span.n}</sup>
        </mark>
      );
    } else {
      parts.push(
        <mark key={`meaning-${span.key}`} className="universe-meaning" data-meaning={span.meaning} data-n={span.n} tabIndex={0} role="note" aria-label={`의미: ${span.meaning}`}>
          {text}
        </mark>
      );
    }
    cursor = span.end;
  }
  if (cursor < points.length) parts.push(points.slice(cursor).join(''));
  return parts;
}
