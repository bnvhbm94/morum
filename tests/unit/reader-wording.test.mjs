import test from 'node:test';
import assert from 'node:assert/strict';
// Reader wording is kept free of JSX in reading-spans.ts (same reason as mergeSpans) so it can be
// unit-tested directly, per the 1.9 §4 / design B §2 spec: the per-evidence quote-check line and the
// focus × stance review table.
import {countReviewsByFocus, QUOTE_CHECK_TEXT, REVIEW_FOCUS_ROWS, REVIEW_STANCES} from '../../src/components/reading-spans.ts';

test('quote-check text never says "원문" and never uses judgement words', () => {
  for (const state of Object.keys(QUOTE_CHECK_TEXT)) {
    const entry = QUOTE_CHECK_TEXT[state];
    if (!entry) continue; // not_applicable: no line
    assert.equal(entry.text.includes('원문'), false, `${state} must be worded against the submitted excerpt, not "원문"`);
    assert.equal(/[✓✗]/.test(entry.text), false, `${state} must not use a check/cross glyph`);
  }
});

test('not_applicable has no line', () => {
  assert.equal(QUOTE_CHECK_TEXT.not_applicable, null);
});

test('found_* and not_found are all "compared"; no_text and no_quote are not — colour never encodes right/wrong', () => {
  const compared = ['found_exact', 'found_normalized', 'found_fragments', 'not_found'];
  const notCompared = ['no_text', 'no_quote'];
  for (const state of compared) assert.equal(QUOTE_CHECK_TEXT[state].compared, true, state);
  for (const state of notCompared) assert.equal(QUOTE_CHECK_TEXT[state].compared, false, state);
  // found_exact and not_found read identically in colour terms: the state text alone tells them apart.
  assert.equal(QUOTE_CHECK_TEXT.found_exact.compared, QUOTE_CHECK_TEXT.not_found.compared);
});

test('review focus rows are ordered quote_match, evidence_support, content, meaning (README\'s three questions, then meaning)', () => {
  assert.deepEqual(REVIEW_FOCUS_ROWS.map(row => row.focus), ['quote_match', 'evidence_support', 'content', 'meaning']);
});

test('review stances are agree, disagree, needs_review with the fixed Korean labels', () => {
  assert.deepEqual(REVIEW_STANCES.map(s => s.stance), ['agree', 'disagree', 'needs_review']);
  assert.deepEqual(REVIEW_STANCES.map(s => s.label), ['동의', '반대', '검토 필요']);
});

test('countReviewsByFocus tallies every focus row, including zero rows', () => {
  const counts = countReviewsByFocus([
    {focus: 'quote_match', stance: 'agree'},
    {focus: 'evidence_support', stance: 'agree'},
    {focus: 'evidence_support', stance: 'disagree'},
    {focus: 'content', stance: 'needs_review'},
  ]);
  assert.deepEqual(counts.get('quote_match'), {agree: 1, disagree: 0, needs_review: 0});
  assert.deepEqual(counts.get('evidence_support'), {agree: 1, disagree: 1, needs_review: 0});
  assert.deepEqual(counts.get('content'), {agree: 0, disagree: 0, needs_review: 1});
  assert.deepEqual(counts.get('meaning'), {agree: 0, disagree: 0, needs_review: 0});
});

test('countReviewsByFocus with an empty list still returns all four zeroed rows', () => {
  const counts = countReviewsByFocus([]);
  assert.equal(counts.size, 4);
  for (const row of REVIEW_FOCUS_ROWS) assert.deepEqual(counts.get(row.focus), {agree: 0, disagree: 0, needs_review: 0});
});
