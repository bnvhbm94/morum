// Keyboard reading of one document, shared by the home explorer and the universe reader.
// Up/Down step through the title and the blank-line separated paragraphs; the current one is marked with a
// CSS highlight that fades and disappears after about three seconds, so it helps find the place after a jump
// and then gets out of the way. Space / Page Down show the next screen without moving the mark.

const READING_HIGHLIGHT = 'reading-paragraph';
const READING_HIGHLIGHT_FADING = 'reading-paragraph-fading';
export const READING_MARK_MS = 3000;
export const READING_FADE_MS = 2500;
let readingMarkTimers: ReturnType<typeof setTimeout>[] = [];

export function clearReadingHighlight(): void {
  readingMarkTimers.forEach(clearTimeout); readingMarkTimers = [];
  if (typeof CSS !== 'undefined' && 'highlights' in CSS) { CSS.highlights.delete(READING_HIGHLIGHT); CSS.highlights.delete(READING_HIGHLIGHT_FADING); }
}

export function markReadingUnit(range: Range): void {
  clearReadingHighlight();
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
  CSS.highlights.set(READING_HIGHLIGHT, new Highlight(range));
  readingMarkTimers = [
    setTimeout(() => { CSS.highlights.delete(READING_HIGHLIGHT); CSS.highlights.set(READING_HIGHLIGHT_FADING, new Highlight(range)); }, READING_FADE_MS),
    setTimeout(clearReadingHighlight, READING_MARK_MS),
  ];
}

/** Text nodes of the reading body with their offsets, skipping citation numbers so offsets follow the body text. */
function readingTextNodes(root: HTMLElement): {node: Text; start: number}[] {
  const nodes: {node: Text; start: number}[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode: node => node.parentElement?.closest('sup') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
  let offset = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) { nodes.push({node, start: offset}); offset += node.data.length; }
  return nodes;
}

function rangeAt(nodes: {node: Text; start: number}[], start: number, end: number): Range | null {
  const locate = (offset: number) => { for (let i = nodes.length - 1; i >= 0; i -= 1) if (nodes[i].start <= offset) return {node: nodes[i].node, offset: Math.min(offset - nodes[i].start, nodes[i].node.data.length)}; return null; };
  const a = locate(start), b = locate(end);
  if (!a || !b) return null;
  const range = document.createRange(); range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset); return range;
}

export type ReadingParts = {
  /** The scrolling element that holds the document. */
  article: HTMLElement;
  /** The title element, if the document has a visible title; it is the first reading unit. */
  title: HTMLElement | null;
  /** The element that holds the body text. */
  body: HTMLElement;
};

/** Reading units in order: the title, then each paragraph of the body. */
export function readingUnits(parts: ReadingParts): Range[] {
  const units: Range[] = [];
  if (parts.title) { const range = document.createRange(); range.selectNodeContents(parts.title); units.push(range); }
  const nodes = readingTextNodes(parts.body);
  const text = nodes.map(entry => entry.node.data).join('');
  const pattern = /[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (!match[0].trim()) continue;
    const range = rangeAt(nodes, match.index, match.index + match[0].length);
    if (range) units.push(range);
  }
  return units;
}

/**
 * Move the reading position by one unit and mark it. Scrolls only as far as needed to show the unit; a unit
 * taller than the view is read a screen at a time before moving on. Returns the new position.
 */
export function stepReadingParagraph(parts: ReadingParts, current: number, direction: 1 | -1, smooth: boolean): number {
  const units = readingUnits(parts);
  if (!units.length) return current;
  const {article} = parts;
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
  const view = article.getBoundingClientRect(), margin = 24;
  if (current >= 0 && current < units.length) {
    const rect = units[current].getBoundingClientRect();
    const tall = rect.height > view.height - 2 * margin;
    const hiddenBelow = rect.bottom - (view.bottom - margin), hiddenAbove = (view.top + margin) - rect.top;
    if (tall && direction > 0 && hiddenBelow > 1) { article.scrollBy({top: Math.min(hiddenBelow, view.height * 0.8), behavior}); markReadingUnit(units[current]); return current; }
    if (tall && direction < 0 && hiddenAbove > 1) { article.scrollBy({top: -Math.min(hiddenAbove, view.height * 0.8), behavior}); markReadingUnit(units[current]); return current; }
  }
  const next = Math.max(0, Math.min(units.length - 1, current < 0 ? 0 : current + direction));
  const rect = units[next].getBoundingClientRect();
  let delta = 0;
  if (rect.top < view.top + margin) delta = rect.top - (view.top + margin);
  else if (rect.bottom > view.bottom - margin) delta = Math.min(rect.bottom - (view.bottom - margin), rect.top - (view.top + margin));
  if (delta) article.scrollBy({top: delta, behavior});
  markReadingUnit(units[next]);
  return next;
}

/** Space / Page Down: show the next screen of text without moving the mark. */
export function pageReading(article: HTMLElement, direction: 1 | -1, smooth: boolean): void {
  article.scrollBy({top: direction * article.clientHeight * 0.85, behavior: smooth ? 'smooth' : 'auto'});
}

/** Reading parts of the home explorer's document article. */
export function spatialReadingParts(article: HTMLElement): ReadingParts | null {
  const body = article.querySelector<HTMLElement>('.spatial-planet-text');
  if (!body) return null;
  return {article, title: article.querySelector<HTMLElement>('.spatial-planet-title'), body};
}
