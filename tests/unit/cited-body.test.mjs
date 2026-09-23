import test from 'node:test';
import assert from 'node:assert/strict';
// cited-body.tsx itself is JSX and cannot be imported under this plain-TS test harness, so the pure
// span-merging logic it shares with the reader lives in reading-spans.ts and is tested directly here.
import {mergeSpans} from '../../src/components/reading-spans.ts';

const cite = (start, end, key) => ({start, end, kind: 'cite', key, n: key});
const meaning = (start, end, key, text) => ({start, end, kind: 'meaning', key, n: key, meaning: text});

test('non-overlapping citation and meaning spans are both kept, sorted by start', () => {
  const merged = mergeSpans([meaning(10, 12, 'a', '선박'), cite(0, 3, 1)]);
  assert.deepEqual(merged.map(s => [s.kind, s.start, s.end]), [['cite', 0, 3], ['meaning', 10, 12]]);
});

test('on overlap the earlier-starting span wins and the later one is dropped', () => {
  const merged = mergeSpans([cite(0, 5, 1), meaning(2, 8, 'a', '선박')]);
  assert.deepEqual(merged.map(s => [s.kind, s.start, s.end]), [['cite', 0, 5]]);
});

test('a citation and meaning over the exact same range merge into one citation span carrying the meaning', () => {
  const merged = mergeSpans([cite(0, 3, 1), meaning(0, 3, 'a', '선박')]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].kind, 'cite');
  assert.equal(merged[0].coincidentMeaning, '선박');
});

test('the same coincidence is found regardless of input order', () => {
  const merged = mergeSpans([meaning(0, 3, 'a', '선박'), cite(0, 3, 1)]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].kind, 'cite');
  assert.equal(merged[0].coincidentMeaning, '선박');
});

test('a meaning that starts earlier than an overlapping citation wins, and the citation is dropped (no merge)', () => {
  const merged = mergeSpans([meaning(0, 5, 'a', '선박'), cite(1, 4, 1)]);
  assert.deepEqual(merged.map(s => [s.kind, s.start, s.end]), [['meaning', 0, 5]]);
});

test('multiple independent meanings keep their own text and order', () => {
  const merged = mergeSpans([meaning(5, 6, 'b', '두 번째'), meaning(0, 1, 'a', '첫 번째')]);
  assert.deepEqual(merged.map(s => [s.start, s.meaning]), [[0, '첫 번째'], [5, '두 번째']]);
});
