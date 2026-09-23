# Spatial data handoff

The client data layer is in `src/lib/spatial-data.ts`. It uses the existing `/api/v2` routes through `apiGet` and `apiPost`; it does not access Supabase, credentials, or server-only modules.

## Exports

- `loadSpatialHome(signal?)` requests `GET /records?limit=20` and maps each current version to a stable `version:<id>` node.
- `loadSpatialSearch(query, {scope, filters, limit, include_context}, signal?)` requests `POST /search`. Empty or whitespace-only queries load home data. Search keys include query, scope, filters, limit, and context inclusion. Successful responses are cached in memory with a 60 second TTL and a 30 entry LRU bound; failures are not cached.
- `loadSpatialVersion(versionId, signal?)` requests the exact `GET /versions/:version_id` route.
- `loadSpatialContext(target, depth?, signal?)` requests `GET /context` for one exact content target and depth 1 or 2.
- `loadSpatialNeighbors(target, {limit?, displayLimit?}, signal?)` requests bounded `GET /relations` with `direction=both`. It returns displayed items, the returned count, page continuation, and whether more relations exist.
- `recordsToSpatialPage` and `searchHitsToSpatialNodes` are pure mapping helpers. Multiple hits for one target are grouped under one stable node and retain every original locator; the highest scoring hit supplies the primary title, excerpt, and locator.
- `relationSide(relation, target)` returns `left`, `right`, or `context`. Supports places the supporter left of the supported target; `depends_on`, `derived_from`, and `corrects` place the referenced target left of the referencing target. Other predicates remain context and are not forced into a hierarchy.
- `resetSpatialSearchCache()` is available for deterministic test setup.

All loaders accept `AbortSignal`. The UI should add request-generation checks around successive searches so an old success, failure, or `finally` cannot overwrite a newer query, including the transition to an empty query.

Nodes retain `target`, `locator`, `locators`, `href`, `title`, `snippet`, `isCurrent`, `versionState`, `score`, and `syntheticDemo`. A missing `version_id` is never turned into a fabricated version: object locators remain their original target, while body/field locators use their actual version ID as required by the contract.

Relation display is deliberately bounded. `page.next_cursor`, `page.truncated`, and `hasMore` indicate that the displayed slice is not the whole relation set. The adapter does not recursively expand neighbors or treat proximity/search rank as a logical relation.

## Reader fixes

`VersionReader` now keeps each annotations, relations, evidence, and reviews request as an independent `{data, error}` result. A failed auxiliary request is shown with a retry action while successful siblings remain visible. Evidence is deduplicated by evidence ID before rendering, and a truncated collection is labeled as “or more” rather than as its returned count. The pre-existing disclosure reader layout is retained.

## Verification

Passed: `npm run typecheck`, `npm run test:static`, `npm run test:server` (18 tests), and the independent passing cases in `npm run test:unit` (23/24; the suite is blocked by its pre-existing missing `../tools/contract_reference.mjs`). `npm run test:service` ran but has four pre-existing workspace-path/content failures under `/Users/nuanox/Documents`: missing `contracts/API_ROUTES.json` and `skills/nuanox/SKILL.md`, an expected legacy `name: nuanox` assertion, and a dependency allowlist mismatch. No DB or HTTP integration suite was run because the configured required local database was not available.

The adapter does not change the server contract or add migrations. The UI worker should implement debounce (the handoff default is 1000 ms), request-generation guards, deterministic coordinate layout, and visual loading/empty/error/partial/truncation states using these exports.

Implementation commit: the commit containing this handoff and adapter (reported to the parent agent).
