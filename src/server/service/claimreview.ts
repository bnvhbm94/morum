import type * as T from '../../contracts/types.js';

/**
 * Renders schema.org ClaimReview JSON-LD from a Dossier (roadmap 2.9).
 *
 * Google fact-check markup guide, checked 2026-09-23 via WebFetch against
 * https://developers.google.com/search/docs/appearance/structured-data/factcheck:
 *  - Required on ClaimReview: claimReviewed, reviewRating, url.
 *  - Recommended: author, itemReviewed.
 *  - reviewRating.ratingValue is only RECOMMENDED, not required, once alternateName is
 *    present — so Morum omits ratingValue/bestRating/worstRating entirely. The stance word
 *    is the rating, never a number (see roadmap 2.9's "why"); this is deliberate, not an
 *    oversight, and is asserted by a unit test.
 *  - datePublished is recommended on the nested Claim, not required on ClaimReview itself;
 *    Morum still publishes it at the ClaimReview level (schema.org allows it there too, and
 *    the design spec's example does the same).
 *  - claimReviewed is recommended to stay under ~75 characters and to exclude the rating.
 *    The design spec's own fallback cap (200 code points, see claimReviewedText below) is
 *    wider than that recommendation; this function follows the design spec's number rather
 *    than silently tightening it, and the gap is noted here rather than invented away.
 *
 * === What data this draws from ===
 *
 * The design spec (docs/design/2026-09-23-claimreview-2.9.md) describes "one ClaimReview per
 * review" for stances agree/disagree/needs_review. In the actual `Dossier` shape
 * (src/contracts/types.ts, populated by kb_dossier in
 * supabase/migrations/202609200110_read_surfaces.sql, extended by
 * supabase/migrations/202609200113_dossier_agreements.sql):
 *
 *  - Agree reviews: individual review records for the disagree/needs_review stances live in
 *    `dossier.counterarguments.reviews`; individual review records for the agree stance live
 *    in `dossier.agreements.reviews` (added by 202609200113, same `DossierCounterargument[]`
 *    element shape). Both are read here, so a real "Supported" ClaimReview is emitted whenever
 *    a public agreeing review exists (previously only the aggregate `agree_keyed` /
 *    `agree_anonymous` counts were available; those two fields are unchanged and still exposed
 *    on `dossier.agreements`, just no longer the only agreement data). `agreements.reviews` may
 *    be `undefined` when talking to a not-yet-migrated database (pre-202609200113); that is
 *    treated as no agreeing reviews, never as an error.
 *  - `claimReviewed`: when a review's `on` is an anchor ref carrying non-empty resolved `exact`
 *    text (also added by 202609200113, via `knowledge.review_on_ref`), that anchor text is used
 *    (capped at 200 code points, per the design spec's own fallback cap — see the module
 *    comment above about the ~75-character recommendation this deliberately doesn't tighten).
 *    Otherwise it falls back to the version title, else the first 200 code points of the body,
 *    as before. This is per-review, not per-dossier: two reviews on the same version can now
 *    surface different claimed text when they target different anchors.
 *  - Hidden/tombstoned exclusion: kb_dossier already filters every row through
 *    `knowledge.is_public(...)` before any of this reaches the server, and
 *    `DossierCounterargument` carries no visibility field of its own for this function to
 *    re-check. Blind dossiers (`dossier.blind`) also already arrive with both
 *    `counterarguments.reviews` and `agreements.reviews` empty. Both are handled by
 *    construction, not by an extra filter.
 */

export interface ClaimReviewAuthor { '@type': 'Organization'; name: string; }
export interface ClaimReviewJsonLd {
 '@context': 'https://schema.org';
 '@type': 'ClaimReview';
 url: string;
 datePublished: string;
 author: ClaimReviewAuthor;
 claimReviewed: string;
 itemReviewed: { '@type': 'Claim'; appearance: { '@type': 'CreativeWork'; url: string } };
 reviewRating: { '@type': 'Rating'; alternateName: 'Supported' | 'Disputed' | 'Needs review'; ratingExplanation: string };
}

/** Stance → alternateName. No numeric rating anywhere: the word IS the rating. */
const STANCE_LABEL: Record<T.ReviewStance, 'Supported' | 'Disputed' | 'Needs review'> = {
 agree: 'Supported', disagree: 'Disputed', needs_review: 'Needs review',
};
/** quote_match/meaning are internal quality signals, never published as fact-check reviews. */
const EMITTED_FOCUS = new Set<T.ReviewFocus>(['content', 'evidence_support']);
/** The review must target the version itself or one of its anchors. */
const EMITTED_TARGET_KIND = new Set<string>(['version', 'anchor']);

const CANONICAL_ORIGIN = 'https://morum.vercel.app';

function codePoints(s: string): string[] { return Array.from(s); }
function capCodePoints(s: string, max: number): string {
 const cp = codePoints(s);
 return cp.length <= max ? s : cp.slice(0, max).join('');
}
/** "Morum agent <first 8 hex of actor_id>", or the fixed anonymous label; never a model name or operator. */
function authorName(actorId: string | null): string {
 if (!actorId) return 'Morum anonymous reviewer';
 return `Morum agent ${actorId.replace(/-/g, '').slice(0, 8)}`;
}
/** Per-review claimReviewed: the anchor's resolved exact text when `on` is an anchor ref with
 * non-empty text (202609200113); otherwise the version title, else the first 200 code points
 * of the body. */
function claimReviewedFor(review: T.DossierCounterargument, dossier: T.Dossier): string {
 if (review.on.kind === 'anchor' && review.on.exact) return capCodePoints(review.on.exact, 200);
 if (dossier.version.title) return dossier.version.title;
 return capCodePoints(dossier.version.body_text, 200);
}

/**
 * Resolves the origin ClaimReview URLs should use: any `*.vercel.app` preview host collapses
 * to the canonical production origin, so search engines see one stable URL per claim across
 * preview deployments. Any other host (a custom domain, or localhost in development) passes
 * through unchanged.
 */
export function publicOrigin(requestOrigin: string): string {
 let host: string;
 try { host = new URL(requestOrigin).hostname; } catch { return CANONICAL_ORIGIN; }
 return /(^|\.)vercel\.app$/i.test(host) ? CANONICAL_ORIGIN : requestOrigin;
}

/** Pure, deterministic ClaimReview JSON-LD for a Dossier's public, non-quality-signal reviews.
 * Draws from both `counterarguments.reviews` (disagree/needs_review) and `agreements.reviews`
 * (agree, 202609200113; absent on a not-yet-migrated database, treated as empty). */
export function renderClaimReviews(dossier: T.Dossier, origin: string): ClaimReviewJsonLd[] {
 const versionUrl = `${origin}/versions/${dossier.version.id}`;
 const out: ClaimReviewJsonLd[] = [];
 const allReviews = [...dossier.counterarguments.reviews, ...(dossier.agreements.reviews ?? [])];
 for (const review of allReviews) {
  if (!EMITTED_FOCUS.has(review.focus)) continue;
  if (!EMITTED_TARGET_KIND.has(review.on.kind)) continue;
  out.push({
   '@context': 'https://schema.org',
   '@type': 'ClaimReview',
   url: `${versionUrl}#review-${review.id}`,
   datePublished: review.created_at,
   author: { '@type': 'Organization', name: authorName(review.created_by) },
   claimReviewed: claimReviewedFor(review, dossier),
   itemReviewed: { '@type': 'Claim', appearance: { '@type': 'CreativeWork', url: versionUrl } },
   reviewRating: {
    '@type': 'Rating',
    alternateName: STANCE_LABEL[review.stance],
    ratingExplanation: capCodePoints(review.explanation, 500),
   },
  });
 }
 return out;
}

/**
 * Serializes ClaimReview JSON-LD for embedding in a `<script type="application/ld+json">`
 * tag: `<` is escaped to `<` so the payload can never contain a literal `</script>` and
 * terminate the tag early (a review's explanation or title is untrusted stored content).
 */
export function claimReviewScript(claimReviews: ClaimReviewJsonLd[]): string {
 return JSON.stringify(claimReviews).replace(/</g, '\\u003c');
}
