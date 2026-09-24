import test from 'node:test';
import assert from 'node:assert/strict';
// The reader's keyboard cursor (left satellites / centre article / right satellites) is a pure column+index
// state machine, unit-tested here without any DOM: universe/reader.tsx (JSX, so not importable directly into
// a plain Node test) only supplies the side effects (focus(), scroll, aria-current) around it. See
// moveReaderCursor's own comment for the exact rules.
import {INITIAL_READER_CURSOR, moveReaderCursor} from '../../src/components/universe/reader-cursor.ts';

test('starts on the centre article', () => {
  assert.deepEqual(INITIAL_READER_CURSOR, {column: 'center', index: 0});
});

test('Left/Right from the centre enter the chosen side column at the given index, or do nothing if it is empty', () => {
  const counts = {left: 3, right: 2};
  assert.deepEqual(moveReaderCursor(INITIAL_READER_CURSOR, 'ArrowLeft', counts, 1), {column: 'left', index: 1});
  assert.deepEqual(moveReaderCursor(INITIAL_READER_CURSOR, 'ArrowRight', counts, 0), {column: 'right', index: 0});
  assert.deepEqual(moveReaderCursor(INITIAL_READER_CURSOR, 'ArrowLeft', {left: 0, right: 2}), INITIAL_READER_CURSOR);
  assert.deepEqual(moveReaderCursor(INITIAL_READER_CURSOR, 'ArrowRight', {left: 3, right: 0}), INITIAL_READER_CURSOR);
});

test('the opposite arrow returns from a side column to the centre; the outer arrow at the edge is a no-op', () => {
  const counts = {left: 3, right: 2};
  const left = {column: 'left', index: 1};
  const right = {column: 'right', index: 0};
  assert.deepEqual(moveReaderCursor(left, 'ArrowRight', counts), {column: 'center', index: 0});
  assert.deepEqual(moveReaderCursor(right, 'ArrowLeft', counts), {column: 'center', index: 0});
  assert.deepEqual(moveReaderCursor(left, 'ArrowLeft', counts), left);
  assert.deepEqual(moveReaderCursor(right, 'ArrowRight', counts), right);
});

test('Up/Down move within a side column by one, with no wrap at either end', () => {
  const counts = {left: 3, right: 2};
  assert.deepEqual(moveReaderCursor({column: 'left', index: 0}, 'ArrowDown', counts), {column: 'left', index: 1});
  assert.deepEqual(moveReaderCursor({column: 'left', index: 1}, 'ArrowDown', counts), {column: 'left', index: 2});
  assert.deepEqual(moveReaderCursor({column: 'left', index: 2}, 'ArrowDown', counts), {column: 'left', index: 2});
  assert.deepEqual(moveReaderCursor({column: 'left', index: 0}, 'ArrowUp', counts), {column: 'left', index: 0});
  assert.deepEqual(moveReaderCursor({column: 'right', index: 1}, 'ArrowDown', counts), {column: 'right', index: 1});
});

test('Up/Down in the centre column is a no-op (the reader scrolls by paragraph instead, outside this function)', () => {
  const counts = {left: 3, right: 2};
  assert.deepEqual(moveReaderCursor(INITIAL_READER_CURSOR, 'ArrowUp', counts), INITIAL_READER_CURSOR);
  assert.deepEqual(moveReaderCursor(INITIAL_READER_CURSOR, 'ArrowDown', counts), INITIAL_READER_CURSOR);
});

test('Up/Down does nothing in an emptied side column', () => {
  const cursor = {column: 'left', index: 0};
  assert.deepEqual(moveReaderCursor(cursor, 'ArrowDown', {left: 0, right: 0}), cursor);
});

test('enterIndex is clamped to the target column\'s bounds', () => {
  assert.deepEqual(moveReaderCursor(INITIAL_READER_CURSOR, 'ArrowLeft', {left: 2, right: 0}, 99), {column: 'left', index: 1});
  assert.deepEqual(moveReaderCursor(INITIAL_READER_CURSOR, 'ArrowLeft', {left: 2, right: 0}, -5), {column: 'left', index: 0});
});
