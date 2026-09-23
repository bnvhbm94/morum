/** SOURCE-ONLY: reads source text, no build or DB required. Roadmap 2.9 (ClaimReview exposure). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import nodePath from 'node:path';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const read = p => readFileSync(nodePath.join(rootDir, p), 'utf8');

const page = read('src/app/versions/[versionId]/page.tsx');
const claimreview = read('src/server/service/claimreview.ts');
const surfaces = read('src/server/service/handlers/surfaces.ts');
const skill = read('public/skill.md');

test('the version page renders a server-side application/ld+json script tag', () => {
 assert.match(page, /<script type="application\/ld\+json"/);
});

test('the version page derives claim reviews from the server service, not an HTTP call to itself', () => {
 assert.match(page, /from '\.\.\/\.\.\/\.\.\/server\/service\/claimreview'/);
 assert.match(page, /createServices\(\)/);
 assert.doesNotMatch(page, /fetch\(/);
});

test('the ld+json payload is escaped for </script> before being injected', () => {
 assert.match(page, /claimReviewScript\(/);
 assert.match(claimreview, /replace\(\/</);
 assert.match(claimreview, /\\\\u003c/);
});

test('claimreview.ts documents the Google fact-check guide check date', () => {
 // Whether ratingValue/bestRating/worstRating are ever actually emitted is a runtime property of
 // renderClaimReviews's output, not of the source text (this comment legitimately names them to
 // explain why they're omitted) — asserted directly against the emitted JSON in
 // tests/unit/claimreview.test.mjs instead.
 assert.match(claimreview, /checked 2026-09-23/);
});

test('the /dossier handler adds claim_reviews only to the json branch, using the request origin', () => {
 const jsonBranch = surfaces.slice(surfaces.indexOf("format==='text'"));
 assert.match(jsonBranch, /renderClaimReviews\(dossierData,publicOrigin\(url\.origin\)\)/);
});

test('skill.md documents ClaimReview JSON-LD, quote_match/meaning exclusion and no numeric rating', () => {
 assert.match(skill, /claim_reviews/);
 assert.match(skill, /ClaimReview/);
 assert.match(skill, /quote_match/);
 assert.match(skill, /meaning/);
});
