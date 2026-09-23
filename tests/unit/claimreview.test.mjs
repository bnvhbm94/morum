import test from 'node:test';
import assert from 'node:assert/strict';
import {renderClaimReviews, publicOrigin, claimReviewScript} from '../../src/server/service/claimreview.ts';

const ORIGIN = 'https://morum.vercel.app';
const VID = 'aaaaaaaa-0000-4000-8000-000000000001';
const ACTOR = 'b1c2d3e4-0000-4000-8000-000000000002';

function dossier(overrides = {}) {
 return {
  version: {
   id: VID, record_id: 'cccccccc-0000-4000-8000-000000000003', version_no: 1, title: 'A synthetic claim title',
   is_current: true, current_version_id: VID, version_count: 1, parent_version_id: null,
   created_at: '2026-09-23T00:00:00Z', created_by: null, attributes: {}, synthetic_demo: true,
   body_sha256: 'a'.repeat(64), body_text: 'Synthetic body text.',
  },
  corrections: [],
  counterarguments: {reviews: [], contradicts: [], groups: {keyed_actors: 0, anonymous_reviews: 0, declared_model_families: 0}},
  agreements: {agree_keyed: 0, agree_anonymous: 0},
  evidence: [], premises: [], meanings: [], related: [],
  omitted: {corrections: 0, counterarguments: 0, contradicts: 0, evidence: 0, premises: 0, meanings: 0, related: 0},
  blind: false, generated_at: '2026-09-23T00:00:00Z',
  ...overrides,
 };
}

function review(overrides = {}) {
 return {
  id: 'dddddddd-0000-4000-8000-000000000004', stance: 'disagree', focus: 'content',
  on: {kind: 'version', id: VID}, created_by: ACTOR, created_at: '2026-09-23T01:00:00Z',
  declared: null, explanation: 'Synthetic explanation of the disagreement.',
  ...overrides,
 };
}

test('mapping table: agree/disagree/needs_review map to Supported/Disputed/Needs review', () => {
 const d = dossier({counterarguments: {reviews: [
  review({id: 'r1', stance: 'agree'}),
  review({id: 'r2', stance: 'disagree'}),
  review({id: 'r3', stance: 'needs_review'}),
 ], contradicts: [], groups: {keyed_actors: 0, anonymous_reviews: 0, declared_model_families: 0}}});
 const out = renderClaimReviews(d, ORIGIN);
 assert.deepEqual(out.map(x => x.reviewRating.alternateName), ['Supported', 'Disputed', 'Needs review']);
});

test('focus content and evidence_support are emitted; quote_match and meaning are excluded', () => {
 const d = dossier({counterarguments: {reviews: [
  review({id: 'r1', focus: 'content'}),
  review({id: 'r2', focus: 'evidence_support'}),
  review({id: 'r3', focus: 'quote_match'}),
  review({id: 'r4', focus: 'meaning'}),
 ], contradicts: [], groups: {keyed_actors: 0, anonymous_reviews: 0, declared_model_families: 0}}});
 const out = renderClaimReviews(d, ORIGIN);
 assert.deepEqual(out.map(x => x.url.split('#review-')[1]), ['r1', 'r2']);
});

test('target must be the version or an anchor of it; other content-ref kinds are excluded', () => {
 const d = dossier({counterarguments: {reviews: [
  review({id: 'r1', on: {kind: 'version', id: VID}}),
  review({id: 'r2', on: {kind: 'anchor', id: 'eeeeeeee-0000-4000-8000-000000000005'}}),
  review({id: 'r3', on: {kind: 'relation', id: 'ffffffff-0000-4000-8000-000000000006'}}),
 ], contradicts: [], groups: {keyed_actors: 0, anonymous_reviews: 0, declared_model_families: 0}}});
 const out = renderClaimReviews(d, ORIGIN);
 assert.deepEqual(out.map(x => x.url.split('#review-')[1]), ['r1', 'r2']);
});

test('no ratingValue, bestRating or worstRating key anywhere in the emitted JSON', () => {
 const d = dossier({counterarguments: {reviews: [review()], contradicts: [], groups: {keyed_actors: 1, anonymous_reviews: 0, declared_model_families: 0}}});
 const out = renderClaimReviews(d, ORIGIN);
 const json = JSON.stringify(out);
 assert.doesNotMatch(json, /ratingValue/);
 assert.doesNotMatch(json, /bestRating/);
 assert.doesNotMatch(json, /worstRating/);
 assert.deepEqual(Object.keys(out[0].reviewRating).sort(), ['@type', 'alternateName', 'ratingExplanation']);
});

test('keyed author is "Morum agent <first 8 hex>"; never a model name or operator', () => {
 const d = dossier({counterarguments: {reviews: [review({created_by: ACTOR, declared: {model: 'gpt-x', harness: 'h', operator: 'someone'}})], contradicts: [], groups: {keyed_actors: 1, anonymous_reviews: 0, declared_model_families: 0}}});
 const out = renderClaimReviews(d, ORIGIN);
 assert.deepEqual(out[0].author, {'@type': 'Organization', name: `Morum agent ${ACTOR.replace(/-/g, '').slice(0, 8)}`});
 assert.doesNotMatch(JSON.stringify(out), /gpt-x|someone/);
});

test('anonymous author label for created_by:null', () => {
 const d = dossier({counterarguments: {reviews: [review({created_by: null})], contradicts: [], groups: {keyed_actors: 0, anonymous_reviews: 1, declared_model_families: 0}}});
 const out = renderClaimReviews(d, ORIGIN);
 assert.deepEqual(out[0].author, {'@type': 'Organization', name: 'Morum anonymous reviewer'});
});

test('claimReviewed falls back from version title to the first 200 code points of the body', () => {
 const withTitle = dossier({counterarguments: {reviews: [review()], contradicts: [], groups: {keyed_actors: 1, anonymous_reviews: 0, declared_model_families: 0}}});
 assert.equal(renderClaimReviews(withTitle, ORIGIN)[0].claimReviewed, 'A synthetic claim title');

 const longBody = '가'.repeat(250);
 const noTitle = dossier({
  version: {...withTitle.version, title: null, body_text: longBody},
  counterarguments: withTitle.counterarguments,
 });
 const claimReviewed = renderClaimReviews(noTitle, ORIGIN)[0].claimReviewed;
 assert.equal(Array.from(claimReviewed).length, 200);
 assert.equal(claimReviewed, Array.from(longBody).slice(0, 200).join(''));
});

test('ratingExplanation is capped at 500 code points', () => {
 const long = 'x'.repeat(600);
 const d = dossier({counterarguments: {reviews: [review({explanation: long})], contradicts: [], groups: {keyed_actors: 1, anonymous_reviews: 0, declared_model_families: 0}}});
 const out = renderClaimReviews(d, ORIGIN);
 assert.equal(Array.from(out[0].reviewRating.ratingExplanation).length, 500);
});

test('url, itemReviewed and datePublished are built from the version id, origin and review', () => {
 const d = dossier({counterarguments: {reviews: [review()], contradicts: [], groups: {keyed_actors: 1, anonymous_reviews: 0, declared_model_families: 0}}});
 const out = renderClaimReviews(d, ORIGIN)[0];
 assert.equal(out['@context'], 'https://schema.org');
 assert.equal(out['@type'], 'ClaimReview');
 assert.equal(out.url, `${ORIGIN}/versions/${VID}#review-dddddddd-0000-4000-8000-000000000004`);
 assert.equal(out.datePublished, '2026-09-23T01:00:00Z');
 assert.deepEqual(out.itemReviewed, {'@type': 'Claim', appearance: {'@type': 'CreativeWork', url: `${ORIGIN}/versions/${VID}`}});
});

test('blind dossiers already arrive with an empty reviews list, so nothing is emitted', () => {
 const d = dossier({blind: true, counterarguments: {reviews: [], contradicts: [], groups: {keyed_actors: 2, anonymous_reviews: 1, declared_model_families: 1}}});
 assert.deepEqual(renderClaimReviews(d, ORIGIN), []);
});

test('a dossier with no counterargument reviews emits nothing', () => {
 assert.deepEqual(renderClaimReviews(dossier(), ORIGIN), []);
});

test('publicOrigin collapses any *.vercel.app preview host to the canonical origin', () => {
 assert.equal(publicOrigin('https://morum-git-feature-someone.vercel.app'), ORIGIN);
 assert.equal(publicOrigin('https://morum.vercel.app'), ORIGIN);
 assert.equal(publicOrigin('https://morum.example'), 'https://morum.example');
 assert.equal(publicOrigin('http://localhost:3000'), 'http://localhost:3000');
});

test('claimReviewScript escapes "<" so </script> cannot terminate the tag early', () => {
 const d = dossier({counterarguments: {reviews: [review({explanation: 'ends with </script><script>alert(1)</script>'})], contradicts: [], groups: {keyed_actors: 1, anonymous_reviews: 0, declared_model_families: 0}}});
 const out = renderClaimReviews(d, ORIGIN);
 const script = claimReviewScript(out);
 assert.doesNotMatch(script, /<\/script>/);
 assert.doesNotMatch(script, /<script>/);
 assert.match(script, /\\u003c\/script>/);
 assert.deepEqual(JSON.parse(script.replace(/\\u003c/g, '<')), out);
});
