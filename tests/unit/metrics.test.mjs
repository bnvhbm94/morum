import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quantiles, powerLawHistogram, familyFromDeclared, actorIdentityKey, reviewerFamilyKey,
  classifySourceTextSignal, extractDossierCounts, computeVerificationMetrics, computeFamilyMetrics,
  computeCrossFamilyReuse, summarizePassHatK, summarizeInjectionRefusal, computeEvalMetrics,
  buildReport, formatReport,
} from '../../scripts/metrics.mjs';

// --- fixtures: shaped like GET /dossier?target_kind=version&target_id=... (src/contracts/types.ts Dossier) ---

const ACTOR_A = 'a1a1a1a1-0000-4000-8000-00000000000a';
const ACTOR_B = 'b2b2b2b2-0000-4000-8000-00000000000b';

function evidence(overrides = {}) {
  return {
    id: 'e0000000-0000-4000-8000-000000000000', target: {kind: 'version', id: 'v0'}, created_by: null,
    created_at: '2026-09-24T00:00:00Z', submission_state: 'submitted',
    basis: {kind: 'external', source_id: 's0000000-0000-4000-8000-000000000000', quote: 'a quote', explanation: 'why'},
    quote_check: {state: 'found_exact', source_id: 's0000000-0000-4000-8000-000000000000'},
    ...overrides,
  };
}

function review(overrides = {}) {
  return {
    id: 'r0000000-0000-4000-8000-000000000000', stance: 'disagree', focus: 'content',
    on: {kind: 'version', id: 'v0'}, created_by: ACTOR_A, created_at: '2026-09-24T00:00:00Z',
    declared: null, explanation: 'explanation',
    ...overrides,
  };
}

function correction(overrides = {}) {
  return {
    relation_id: 'c0000000-0000-4000-8000-000000000000', from: {kind: 'version', id: 'v9'},
    version_id: 'v9', title: 'correcting title', explanation: 'why', created_at: '2026-09-24T00:00:00Z',
    ...overrides,
  };
}

function dossier(overrides = {}) {
  return {
    version: {
      id: 'v0', record_id: 'rec0', version_no: 1, title: 't', is_current: true, current_version_id: 'v0',
      version_count: 1, parent_version_id: null, created_at: '2026-09-24T00:00:00Z', created_by: null,
      attributes: {}, synthetic_demo: false, body_sha256: 'x'.repeat(64), body_text: 'body',
    },
    corrections: [],
    counterarguments: {reviews: [], contradicts: [], groups: {keyed_actors: 0, anonymous_reviews: 0, declared_model_families: 0}},
    agreements: {agree_keyed: 0, agree_anonymous: 0},
    evidence: [], premises: [], meanings: [], related: [],
    omitted: {corrections: 0, counterarguments: 0, contradicts: 0, evidence: 0, premises: 0, meanings: 0, related: 0},
    blind: false, generated_at: '2026-09-24T00:00:00Z',
    ...overrides,
  };
}

// --- quantiles / histogram ---

test('quantiles: empty input returns nulls, not NaN or a throw', () => {
  assert.deepEqual(quantiles([]), {count: 0, min: null, p50: null, p90: null, max: null});
  assert.deepEqual(quantiles(undefined), {count: 0, min: null, p50: null, p90: null, max: null});
});

test('quantiles: min/p50/p90/max over a known distribution', () => {
  const q = quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(q.count, 10);
  assert.equal(q.min, 1);
  assert.equal(q.max, 10);
  assert.equal(q.p50, 5);
  assert.equal(q.p90, 9);
});

test('powerLawHistogram: buckets grow by power of two and every value lands once', () => {
  const h = powerLawHistogram([0, 0, 1, 2, 3, 4, 7, 8, 100]);
  const byRange = Object.fromEntries(h.map(b => [b.range, b.count]));
  assert.equal(byRange['0'], 2);
  assert.equal(byRange['1'], 1);
  assert.equal(byRange['2-3'], 2);
  assert.equal(byRange['4-7'], 2);
  assert.equal(byRange['8-15'], 1);
  assert.equal(byRange['64+'], 1);
  assert.equal(h.reduce((n, b) => n + b.count, 0), 9);
});

// --- family keys ---

test('familyFromDeclared: joins present fields, ignores absent ones, null when nothing declared', () => {
  assert.equal(familyFromDeclared({model: 'x'}), 'model=x');
  assert.equal(familyFromDeclared({model: 'x', harness: 'h', operator: 'o'}), 'model=x;harness=h;operator=o');
  assert.equal(familyFromDeclared({}), null);
  assert.equal(familyFromDeclared(null), null);
  assert.equal(familyFromDeclared(undefined), null);
});

test('actorIdentityKey: keyed vs anonymous', () => {
  assert.equal(actorIdentityKey(ACTOR_A), `keyed:${ACTOR_A}`);
  assert.equal(actorIdentityKey(null), 'anonymous');
});

test('reviewerFamilyKey: prefers declared over created_by', () => {
  assert.equal(reviewerFamilyKey(review({declared: {model: 'gpt-x'}, created_by: ACTOR_A})), 'model=gpt-x');
  assert.equal(reviewerFamilyKey(review({declared: null, created_by: ACTOR_A})), `keyed:${ACTOR_A}`);
  assert.equal(reviewerFamilyKey(review({declared: null, created_by: null})), 'anonymous');
});

// --- quote_check -> source text signal ---

test('classifySourceTextSignal: no_text is definite; determinate states imply text was present', () => {
  assert.equal(classifySourceTextSignal('no_text'), 'no_text');
  for (const state of ['found_exact', 'found_normalized', 'found_fragments', 'not_found']) {
    assert.equal(classifySourceTextSignal(state), 'has_text');
  }
});

test('classifySourceTextSignal: no_quote and not_applicable are unknown, not no_text', () => {
  assert.equal(classifySourceTextSignal('no_quote'), 'unknown');
  assert.equal(classifySourceTextSignal('not_applicable'), 'unknown');
});

// --- extractDossierCounts: recovering true totals from capped arrays + omitted ---

test('extractDossierCounts: true total = visible length + omitted, even when nothing was capped', () => {
  const d = dossier({evidence: [evidence(), evidence({id: 'e2'})], omitted: {...dossier().omitted, evidence: 0}});
  const c = extractDossierCounts(d);
  assert.equal(c.evidence_total, 2);
});

test('extractDossierCounts: true total recovers items past the server-side cap', () => {
  const d = dossier({evidence: [evidence()], omitted: {...dossier().omitted, evidence: 9}});
  const c = extractDossierCounts(d);
  assert.equal(c.evidence_visible.length, 1);
  assert.equal(c.evidence_total, 10);
});

// --- metric 1: verification records ---

test('computeVerificationMetrics: tallies quote_check states across dossiers', () => {
  const d1 = dossier({evidence: [
    evidence({quote_check: {state: 'found_exact', source_id: 's1'}}),
    evidence({quote_check: {state: 'found_normalized', source_id: 's2'}}),
  ]});
  const d2 = dossier({evidence: [
    evidence({quote_check: {state: 'not_found', source_id: 's3'}}),
    evidence({basis: {kind: 'reasoning', explanation: 'x'}, quote_check: {state: 'not_applicable', source_id: null}}),
  ]});
  const m = computeVerificationMetrics([d1, d2]);
  assert.equal(m.evidence.found_exact, 1);
  assert.equal(m.evidence.found_normalized, 1);
  assert.equal(m.evidence.found_verified_total, 2);
  assert.equal(m.evidence.not_found, 1);
  assert.equal(m.evidence.not_applicable, 1);
  assert.equal(m.evidence.true_total, 4);
});

test('computeVerificationMetrics: reviews are itemized by stance|focus for disagree/needs_review; agree is aggregate only', () => {
  const d = dossier({
    counterarguments: {
      reviews: [review({stance: 'disagree', focus: 'quote_match'}), review({stance: 'needs_review', focus: 'evidence_support', id: 'r2'})],
      contradicts: [], groups: {keyed_actors: 0, anonymous_reviews: 0, declared_model_families: 0},
    },
    agreements: {agree_keyed: 3, agree_anonymous: 2},
  });
  const m = computeVerificationMetrics([d]);
  assert.equal(m.reviews.by_stance_and_focus['disagree|quote_match'], 1);
  assert.equal(m.reviews.by_stance_and_focus['needs_review|evidence_support'], 1);
  assert.equal(m.reviews.agree_keyed_total, 3);
  assert.equal(m.reviews.agree_anonymous_total, 2);
  assert.equal(m.reviews.agree_focus_breakdown_available, false);
});

test('computeVerificationMetrics: sources_by_submitted_text approximates via quote_check, deduped by source_id', () => {
  const d = dossier({evidence: [
    evidence({basis: {kind: 'external', source_id: 'sX', quote: 'q', explanation: 'e'}, quote_check: {state: 'found_exact', source_id: 'sX'}}),
    evidence({id: 'e2', basis: {kind: 'external', source_id: 'sX', quote: 'q2', explanation: 'e'}, quote_check: {state: 'not_found', source_id: 'sX'}}),
    evidence({id: 'e3', basis: {kind: 'external', source_id: 'sY', quote: null, explanation: 'e'}, quote_check: {state: 'no_text', source_id: 'sY'}}),
    evidence({id: 'e4', basis: {kind: 'external', source_id: 'sZ', quote: null, explanation: 'e'}, quote_check: {state: 'no_quote', source_id: 'sZ'}}),
  ]});
  const m = computeVerificationMetrics([d]);
  assert.equal(m.sources_by_submitted_text.distinct_sources_seen, 3);
  assert.equal(m.sources_by_submitted_text.has_text_approx, 1); // sX: found_exact then not_found -> still has_text
  assert.equal(m.sources_by_submitted_text.no_text_approx, 1); // sY
  assert.equal(m.sources_by_submitted_text.unknown_approx, 1); // sZ: only ever saw no_quote
});

test('computeVerificationMetrics: a definite has_text/no_text signal overrides an earlier unknown one for the same source', () => {
  const d = dossier({evidence: [
    evidence({basis: {kind: 'external', source_id: 'sX', quote: null, explanation: 'e'}, quote_check: {state: 'no_quote', source_id: 'sX'}}),
    evidence({id: 'e2', basis: {kind: 'external', source_id: 'sX', quote: 'q', explanation: 'e'}, quote_check: {state: 'found_exact', source_id: 'sX'}}),
  ]});
  const m = computeVerificationMetrics([d]);
  assert.equal(m.sources_by_submitted_text.has_text_approx, 1);
  assert.equal(m.sources_by_submitted_text.unknown_approx, 0);
});

test('computeVerificationMetrics: per-record distributions and histogram are populated', () => {
  const d1 = dossier({evidence: [evidence(), evidence({id: 'e2'})]});
  const d2 = dossier({evidence: []});
  const m = computeVerificationMetrics([d1, d2]);
  assert.deepEqual(m.distributions.evidence_per_record, {count: 2, min: 0, p50: 0, p90: 2, max: 2});
  assert.ok(Array.isArray(m.distributions.evidence_per_record_histogram));
});

// --- metric 2: per operator family ---

test('computeFamilyMetrics: corrections have no per-family attribution, only a total', () => {
  const d = dossier({corrections: [correction()], omitted: {...dossier().omitted, corrections: 0}});
  const m = computeFamilyMetrics([d]);
  assert.equal(m.corrections_total, 1);
  assert.match(m.corrections_attribution_gap, /no created_by or declared field/);
});

test('computeFamilyMetrics: reviewer_families groups disagree/needs_review by declared family, else actor identity', () => {
  const d = dossier({
    counterarguments: {
      reviews: [
        review({stance: 'disagree', declared: {model: 'gpt-x'}, created_by: null}),
        review({id: 'r2', stance: 'disagree', declared: {model: 'gpt-x'}, created_by: null}),
        review({id: 'r3', stance: 'needs_review', declared: {model: 'gpt-x'}, created_by: null}),
        review({id: 'r4', stance: 'disagree', declared: null, created_by: ACTOR_B}),
      ],
      contradicts: [], groups: {keyed_actors: 1, anonymous_reviews: 3, declared_model_families: 1},
    },
  });
  const m = computeFamilyMetrics([d]);
  const gptX = m.reviewer_families.find(f => f.family === 'model=gpt-x');
  assert.equal(gptX.disagree, 2);
  assert.equal(gptX.needs_review, 1);
  assert.equal(gptX.disagree_share_of_family_reviews, 2 / 3);
  const keyedB = m.reviewer_families.find(f => f.family === `keyed:${ACTOR_B}`);
  assert.equal(keyedB.disagree, 1);
  assert.equal(keyedB.disagree_share_of_family_reviews, 1);
});

test('computeFamilyMetrics: author_identity_groups reports correction/disagree-review rate against each keyed-vs-anonymous author', () => {
  const authored = created_by => dossier({version: {...dossier().version, created_by}});
  const keyedCorrected = {...authored(ACTOR_A), corrections: [correction()]};
  const keyedClean = authored(ACTOR_A);
  const anonDisputed = {...authored(null), counterarguments: {reviews: [review({stance: 'disagree'})], contradicts: [], groups: {keyed_actors: 1, anonymous_reviews: 0, declared_model_families: 0}}};
  const m = computeFamilyMetrics([keyedCorrected, keyedClean, anonDisputed]);
  const keyed = m.author_identity_groups.find(g => g.identity === `keyed:${ACTOR_A}`);
  assert.equal(keyed.records, 2);
  assert.equal(keyed.correction_rate, 0.5);
  assert.equal(keyed.disagree_review_rate, 0);
  const anon = m.author_identity_groups.find(g => g.identity === 'anonymous');
  assert.equal(anon.records, 1);
  assert.equal(anon.disagree_review_rate, 1);
});

// --- metric 3: cross-family reuse ---

test('computeCrossFamilyReuse: internal evidence citing a different-author version counts as cross-family', () => {
  const other = dossier({version: {...dossier().version, id: 'vOther', created_by: ACTOR_B}});
  const citing = dossier({
    version: {...dossier().version, id: 'vCiting', created_by: ACTOR_A},
    evidence: [evidence({basis: {kind: 'internal', source: {kind: 'version', id: 'vOther'}, explanation: 'reuse'}, quote_check: {state: 'not_applicable', source_id: null}})],
  });
  const m = computeCrossFamilyReuse([other, citing]);
  assert.equal(m.internal_evidence.total, 1);
  assert.equal(m.internal_evidence.cross_family, 1);
  assert.equal(m.internal_evidence.same_family, 0);
});

test('computeCrossFamilyReuse: internal evidence citing the same author is same-family, not cross', () => {
  const other = dossier({version: {...dossier().version, id: 'vOther', created_by: ACTOR_A}});
  const citing = dossier({
    version: {...dossier().version, id: 'vCiting', created_by: ACTOR_A},
    evidence: [evidence({basis: {kind: 'internal', source: {kind: 'version', id: 'vOther'}, explanation: 'reuse'}, quote_check: {state: 'not_applicable', source_id: null}})],
  });
  const m = computeCrossFamilyReuse([other, citing]);
  assert.equal(m.internal_evidence.same_family, 1);
  assert.equal(m.internal_evidence.cross_family, 0);
});

test('computeCrossFamilyReuse: unresolved targets (outside walked set, or an anchor) are counted, not misclassified', () => {
  const citing = dossier({
    version: {...dossier().version, id: 'vCiting', created_by: ACTOR_A},
    evidence: [
      evidence({id: 'e1', basis: {kind: 'internal', source: {kind: 'version', id: 'vNotWalked'}, explanation: 'x'}, quote_check: {state: 'not_applicable', source_id: null}}),
      evidence({id: 'e2', basis: {kind: 'internal', source: {kind: 'anchor', id: 'anchor1'}, explanation: 'x'}, quote_check: {state: 'not_applicable', source_id: null}}),
    ],
  });
  const m = computeCrossFamilyReuse([citing]);
  assert.equal(m.internal_evidence.total, 2);
  assert.equal(m.internal_evidence.unresolved_target_outside_walked_set, 1);
  assert.equal(m.internal_evidence.unresolved_anchor_target, 1);
  assert.equal(m.internal_evidence.cross_family_share_of_resolved, null);
});

test('computeCrossFamilyReuse: reviews compare the reviewer identity against the target version author identity', () => {
  const d = dossier({
    version: {...dossier().version, created_by: ACTOR_A},
    counterarguments: {
      reviews: [review({created_by: ACTOR_B}), review({id: 'r2', created_by: ACTOR_A})],
      contradicts: [], groups: {keyed_actors: 2, anonymous_reviews: 0, declared_model_families: 0},
    },
  });
  const m = computeCrossFamilyReuse([d]);
  assert.equal(m.disagree_and_needs_review_reviews.total, 2);
  assert.equal(m.disagree_and_needs_review_reviews.cross_family, 1);
  assert.equal(m.disagree_and_needs_review_reviews.same_family, 1);
});

// --- metrics 4-5: eval results ---

test('summarizePassHatK: pass^k is 1 only when EVERY attempt for a task passed, not "at least one"', () => {
  const s = summarizePassHatK([
    {task_id: 'T1', attempt: 1, passed: true}, {task_id: 'T1', attempt: 2, passed: true},
    {task_id: 'T2', attempt: 1, passed: true}, {task_id: 'T2', attempt: 2, passed: false},
  ]);
  assert.equal(s.tasks_evaluated, 2);
  assert.equal(s.pass_hat_k_rate, 0.5);
  const t1 = s.per_task.find(t => t.task_id === 'T1');
  assert.equal(t1.all_passed, true);
  const t2 = s.per_task.find(t => t.task_id === 'T2');
  assert.equal(t2.all_passed, false);
});

test('summarizePassHatK: no runs -> null rate, not zero (distinguishes "no data" from "0% pass")', () => {
  assert.equal(summarizePassHatK([]).pass_hat_k_rate, null);
  assert.equal(summarizePassHatK(undefined).pass_hat_k_rate, null);
});

test('summarizeInjectionRefusal: refusal_rate counts only entries carrying an injection_refused boolean', () => {
  const s = summarizeInjectionRefusal([
    {task_id: 'T8', injection_refused: true}, {task_id: 'T8', injection_refused: false},
    {task_id: 'T1', passed: true}, // not an injection probe
  ]);
  assert.equal(s.probes, 2);
  assert.equal(s.refused, 1);
  assert.equal(s.refusal_rate, 0.5);
});

test('computeEvalMetrics: null when no eval docs exist yet', () => {
  assert.equal(computeEvalMetrics([]), null);
  assert.equal(computeEvalMetrics(undefined), null);
});

test('computeEvalMetrics: pools runs across files and also breaks down by provider', () => {
  const docs = [
    {provider: 'claude-code', runs: [{task_id: 'T1', attempt: 1, passed: true}, {task_id: 'T1', attempt: 2, passed: true}]},
    {provider: 'codex', runs: [{task_id: 'T1', attempt: 1, passed: false}]},
  ];
  const m = computeEvalMetrics(docs);
  assert.equal(m.files, 2);
  assert.equal(m.overall.pass_hat_k.tasks_evaluated, 1); // both files' T1 runs pool into one task_id
  const claude = m.by_provider.find(p => p.provider === 'claude-code');
  assert.equal(claude.pass_hat_k.pass_hat_k_rate, 1);
  const codex = m.by_provider.find(p => p.provider === 'codex');
  assert.equal(codex.pass_hat_k.pass_hat_k_rate, 0);
});

// --- report assembly + text rendering ---

test('buildReport: n/a placeholders for metrics 4-5 when no eval docs are supplied', () => {
  const report = buildReport({origin: 'https://example.test', records_scanned: 1, requests_made: 2, dossiers: [dossier()], evalDocs: []});
  assert.equal(report.metric_4_task_pass_hat_k, 'n/a (no data/eval results yet)');
  assert.equal(report.metric_5_injection_refusal_rate, 'n/a (no data/eval results yet)');
  assert.deepEqual(report.metric_4_5_by_provider, []);
});

test('formatReport: renders a non-empty plain-text table without throwing, for empty and populated reports', () => {
  const empty = buildReport({origin: 'https://example.test', records_scanned: 0, requests_made: 1, dossiers: [], evalDocs: []});
  const text = formatReport(empty);
  assert.match(text, /MORUM METRICS/);
  assert.match(text, /1\. Verification records/);
  assert.match(text, /2\. Per operator family/);
  assert.match(text, /3\. Cross-family reuse/);
  assert.match(text, /4\. Task pass\^k/);
  assert.match(text, /5\. Injection refusal rate/);

  const withData = buildReport({
    origin: 'https://example.test', records_scanned: 1, requests_made: 2,
    dossiers: [dossier({evidence: [evidence()], counterarguments: {reviews: [review()], contradicts: [], groups: {keyed_actors: 1, anonymous_reviews: 0, declared_model_families: 0}}})],
    evalDocs: [{provider: 'claude-code', runs: [{task_id: 'T1', attempt: 1, passed: true}, {task_id: 'T8', attempt: 1, passed: true, injection_refused: true}]}],
  });
  const text2 = formatReport(withData);
  assert.match(text2, /found_exact=1/);
  assert.match(text2, /claude-code/);
});
