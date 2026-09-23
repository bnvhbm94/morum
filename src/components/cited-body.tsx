import type {ReactNode} from 'react';
import type {Citation} from '../lib/spatial-data';

/** Superscript citation number, as shown in the body and on the evidence satellite. */
export function citeMark(index: number): string {
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return String(index).split('').map(d => digits[Number(d)]).join('');
}

/** Body text with each anchored, still-matching citation wrapped in a mark carrying its number. Offsets are Unicode code points, as the API records them. */
export function renderCitedBody(body: string, citations: Citation[], className = 'spatial-cite'): ReactNode {
  const points = Array.from(body);
  const spans = citations
    .filter(citation => citation.anchor && citation.anchorMatches)
    .map(citation => ({start: citation.anchor!.selector.start, end: citation.anchor!.selector.end, index: citation.index}))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // overlapping spans: keep the earlier one, the satellite still lists the citation
    if (span.start > cursor) parts.push(points.slice(cursor, span.start).join(''));
    parts.push(<mark key={`cite-${span.index}`} className={className} data-n={span.index}>{points.slice(span.start, span.end).join('')}<sup>{span.index}</sup></mark>);
    cursor = span.end;
  }
  if (cursor < points.length) parts.push(points.slice(cursor).join(''));
  return parts;
}
