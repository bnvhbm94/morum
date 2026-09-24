// The reader's keyboard cursor over its own columns (left satellites, the centre article, right
// satellites) — a pure column/index state machine, kept out of reader.tsx (which is JSX and so cannot be
// imported directly into a plain Node unit test) so it can be tested on its own. It only tracks which column
// the cursor is in and, for a side column, which satellite index — never anything about *what* is at that
// index; reader.tsx supplies the side effects (focus(), scrolling, aria-current) around it. Up/Down inside
// the centre column is not a cursor move here — the caller scrolls the article by paragraph instead — so this
// always returns the same cursor unchanged for that case.
export type ReaderColumn = 'left' | 'center' | 'right';
export type ReaderCursor = {column: ReaderColumn; index: number};
export type ReaderArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export const INITIAL_READER_CURSOR: ReaderCursor = {column: 'center', index: 0};

/** `counts` is how many satellites are currently in each side column. `enterIndex` is which index to land on
 * when a side column is entered from the centre — the caller picks it (nearest to the current scroll
 * position) before calling in; it is clamped here and ignored for every other transition. No wrap: Up/Down at
 * the first/last satellite, or Left/Right past the outer edge, is a no-op; an empty side column is a no-op. */
export function moveReaderCursor(cursor: ReaderCursor, key: ReaderArrowKey, counts: {left: number; right: number}, enterIndex = 0): ReaderCursor {
  if (key === 'ArrowLeft') {
    if (cursor.column === 'center') return counts.left > 0 ? {column: 'left', index: clampIndex(enterIndex, counts.left)} : cursor;
    if (cursor.column === 'right') return {column: 'center', index: 0};
    return cursor; // already the left column: no third column further left
  }
  if (key === 'ArrowRight') {
    if (cursor.column === 'center') return counts.right > 0 ? {column: 'right', index: clampIndex(enterIndex, counts.right)} : cursor;
    if (cursor.column === 'left') return {column: 'center', index: 0};
    return cursor; // already the right column
  }
  // ArrowUp / ArrowDown: move within the current side column; a no-op in the centre (handled by the caller as
  // a paragraph scroll instead) or in an empty column.
  if (cursor.column === 'center') return cursor;
  const count = cursor.column === 'left' ? counts.left : counts.right;
  if (count === 0) return cursor;
  const delta = key === 'ArrowUp' ? -1 : 1;
  return {...cursor, index: Math.max(0, Math.min(count - 1, cursor.index + delta))};
}

function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(count - 1, index));
}
