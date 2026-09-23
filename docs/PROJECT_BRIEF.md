# Morum project brief

Status snapshot: 2026-09-23 (Asia/Seoul). This is a navigation aid, not an authority over current source. Earlier briefs and handoffs are in [`archive/`](archive/README.md).

## Purpose

Morum is a knowledge store where records, immutable versions, meaning, evidence, relations, reviews, corrections, and history remain connected for people and external agents. The web UI is a reading and exploration entry point; the public API (`/api/v2`) and agent skill (`public/skill.md`) are part of the product. Distilled product intent: [`ORIGINAL_INTENT.md`](ORIGINAL_INTENT.md).

## Adopted constraints

- Preserve original text and prior versions. A correction is a new version/branch with reason and basis.
- Latest is not truth; relevance/ranking is not truth probability. Do not invent relations or groupings from visual proximity — galaxies come from `attributes.topic`, placement from declared relations.
- Contributions may use external evidence, internal explanation, or reasoning; URLs/raw experiments are not universally required.
- Keep titleless records and varied relation targets.
- Use the existing Next App Router → `/api/v2` → service → repository → Supabase path. The browser never receives service credentials.
- Out of scope: crypto/rewards, distributed preservation, automatic truth judgment, training-data extraction, server-side web fetching, `nuanox_` prefix/HMAC changes.

## Current state

- **Home:** three-level galaxy explorer (`spatial-explorer.tsx` + `spatial-data.ts`): far = topic galaxies (untagged → 미분류), mid = documents placed by relation, near = one document with history/evidence/relation/review satellites. Minimal chrome (search pill + crumb). Levels mirror to the URL.
- **Other pages:** search, exact version reader, record history, object/source readers under `reading-shell.tsx`.
- **Operations:** production on Vercel (`morum.vercel.app`) + Supabase; operator moderation via `scripts/moderate.mjs`. See [`OPERATIONS.md`](OPERATIONS.md).
- **Tests:** `npm run test:functional` runs reference (skips when the sibling suite is absent), unit, server, static, and service suites. DB/HTTP integration suites need a local database (`DB_TESTING.md`, `LOCAL_INTEGRATION.md`).

## Open work

1. Backend performance: measure `/records` (< 600 ms) and `/search` (< 1.5 s) in production; check Vercel/Supabase region alignment.
2. Galaxy scale: server-side topic aggregation endpoint; recommend `topic` in `skill.md`; split `spatial-explorer.tsx` by concern.
3. Document model (needs approval + rollback plan): heads exposure, `/impact` dependency query, lineage flags — one additive migration, contract 2.2.0.
4. Inline meaning references in the near view, rendered only when annotations exist.

## Minimal reading order

1. This brief, then [`CODE_MAP.md`](CODE_MAP.md).
2. `src/contracts/types.ts`, `src/server/service/routes.ts`, `src/lib/api-client.ts`.
3. The targeted component/service and its tests.
