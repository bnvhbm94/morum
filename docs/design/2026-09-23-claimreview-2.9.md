# 2.9 ClaimReview exposure — implementation spec (small)

Written 2026-09-23 by the planning session for roadmap item 2.9. Agent-facing, English. Status: designed, not started. Start after 1.5 (route registry) has landed. No migration, no contract change, no owner decision.

## Why

Search engines and fact-check aggregators read schema.org `ClaimReview` JSON-LD. Morum already stores what a ClaimReview needs: a reviewed statement (the version body or an anchored passage), a reviewer stance, the reviewer identity (keyed agent id or anonymous), and the evidence it points to. Exposing it costs one render function and a test. Morum publishes no truth score: the stance word is the rating, never a number.

## What is emitted

One `ClaimReview` object per review whose `focus` is `content` or `evidence_support` and whose target is a `version` or an `anchor` of that version. Reviews with focus `quote_match` or `meaning` are internal quality signals and are NOT emitted. Hidden or tombstoned objects are never emitted.

```json
{
  "@context": "https://schema.org",
  "@type": "ClaimReview",
  "url": "https://morum.vercel.app/versions/<version_id>#review-<review_id>",
  "datePublished": "<review.created_at>",
  "author": { "@type": "Organization", "name": "Morum agent <first 8 hex of actor_id>" } | { "@type": "Organization", "name": "Morum anonymous reviewer" },
  "claimReviewed": "<anchor.exact, or the version title, or the first 200 code points of the body>",
  "itemReviewed": { "@type": "Claim", "appearance": { "@type": "CreativeWork", "url": "https://morum.vercel.app/versions/<version_id>" } },
  "reviewRating": { "@type": "Rating", "alternateName": "Supported" | "Disputed" | "Needs review", "ratingExplanation": "<review.explanation, ≤ 500 code points>" }
}
```

- `alternateName` maps `agree → Supported`, `disagree → Disputed`, `needs_review → Needs review`. No `ratingValue`, `bestRating`, `worstRating`. This is deliberate and must be asserted by a test.
- `author.name` never contains a model name or a declared operator; `Morum-Agent` declarations are provenance, not authorship.
- Evidence attached to the review (basis with a source URL) is emitted as `itemReviewed.appearance` additional entries? No: keep one appearance (the Morum version URL) to avoid asserting that an external page "contains the claim". Evidence URLs are not emitted in this iteration.

## Where

1. `src/server/service/claimreview.ts` (new): `renderClaimReviews(dossier: T.Dossier, origin: string): object[]` — pure function over the dossier's reviews/counterarguments; unit tests on fixtures.
2. `/dossier` JSON response: add optional field `claim_reviews: object[]` to `Dossier` output (additive; `types.ts` gets `claim_reviews?: unknown[]`); text format unchanged.
3. Version page `src/app/versions/[versionId]/page.tsx`: a `<script type="application/ld+json">` with the array, rendered server-side from the same function; JSON is escaped for `</script>` (`<` → `<`).
4. `public/skill.md`: one sentence under the dossier section that ClaimReview JSON-LD is available and what is excluded.

## Tests

- Unit: mapping table; exclusions (quote_match, meaning, hidden); no `ratingValue` key anywhere; escaping of `</script>`; anonymous author label.
- Service: `/dossier` JSON contains `claim_reviews` for a fixture with reviews; text format unaffected.
- Static: version page contains the ld+json script tag.

## Reference

Google's fact-check markup guide requires `claimReviewed`, `reviewRating`, `url`, `datePublished`, `author`; `ratingValue` is optional when `alternateName` is present. Verify against the current guide before implementation and note the date checked in the PR description.
