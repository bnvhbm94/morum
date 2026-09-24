import test from 'node:test';
import assert from 'node:assert/strict';
// Human-readable relation-predicate labels shown as satellites in the universe reader (owner fix #3):
// a fixed Korean label per known core predicate and per `x:scope:*` value, generic `namespace · name`
// for any other `x:ns:name`, and the raw predicate as a fallback for an unrecognized core one.
import {relationLabel} from '../../src/components/universe/labels.ts';

test('known core predicates get their fixed Korean label', () => {
  assert.equal(relationLabel('supports'), '뒷받침');
  assert.equal(relationLabel('contradicts'), '반박');
  assert.equal(relationLabel('corrects'), '정정');
  assert.equal(relationLabel('depends_on'), '전제');
  assert.equal(relationLabel('defines'), '정의');
  assert.equal(relationLabel('same_meaning_as'), '같은 뜻');
  assert.equal(relationLabel('translation_of'), '번역');
  assert.equal(relationLabel('derived_from'), '파생');
  assert.equal(relationLabel('related_to'), '관련');
});

test('x:scope:* predicates get their fixed Korean label, not the generic namespace split', () => {
  assert.equal(relationLabel('x:scope:broader'), '범위 · 주장이 구절보다 넓음');
  assert.equal(relationLabel('x:scope:narrower'), '범위 · 출처를 좁게 읽음');
  assert.equal(relationLabel('x:scope:shifted'), '범위 · 같은 말, 다른 뜻');
});

test('other x:namespace:name predicates split into "namespace · name"', () => {
  assert.equal(relationLabel('x:quality:disputed'), 'quality · disputed');
  // A name that itself contains colons keeps them, joined back after the namespace.
  assert.equal(relationLabel('x:foo:bar:baz'), 'foo · bar:baz');
});

test('an unrecognized core predicate (no colon) falls back to the raw string', () => {
  assert.equal(relationLabel('mentions'), 'mentions');
});

test('an x:-prefixed predicate with no name part falls back to the raw string', () => {
  assert.equal(relationLabel('x:onlyns'), 'x:onlyns');
});
