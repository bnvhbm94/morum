# Morum code map

Use this as a lookup index. Verify names and behavior in current source; paths below are stable navigation anchors, not frozen line references.

| Task | Start here | What it owns |
| --- | --- | --- |
| Home (galaxy explorer) | `src/app/page.tsx`, `src/components/spatial-explorer.tsx`, `src/app/globals.css` | Three zoom levels (far = topic galaxies, mid = documents by relation, near = document + satellites), camera/drag input, URL-mirrored levels via pushState. |
| Reading shell | `src/components/reading-shell.tsx`, `src/components/Aurora.tsx`, `src/components/nuanox-modal.tsx` | Shared header, agent guide dialog, background for non-home pages. |
| Search UI | `src/app/search/page.tsx`, `src/components/search-results.tsx` | Query/scope form, search response states, result links and pagination. |
| Search service | `src/server/service/retrieval.ts` | Search validation, ranking response, semantic status, context expansion and cursors. |
| Spatial data | `src/lib/spatial-data.ts` | Loaders for home/search/version/context/history/citations; `groupGalaxies` (from `attributes.topic`), `placeGalaxy`/`layoutNodes`/`layoutEdges` (declared relations only), duplicate hiding. |
| Context | `src/server/service/retrieval.ts`, `src/contracts/types.ts` (`ContextPage`, `ContextBundle`, `ContextItem`) | Seed expansion, bounded items/relations, truncation and continuation. |
| Relations | `src/contracts/types.ts` (`Relation`, `KnownPredicate`), `src/server/db/knowledge-repository.ts`, `src/components/version-reader.tsx` | Relation DTO/predicates, paged reads, current reader display. |
| Exact reading | `src/app/versions/[versionId]/page.tsx`, `src/app/records/[recordId]/page.tsx`, `src/components/version-reader.tsx` | Exact version vs current record, full body, correction links, related panels. |
| Version history | `src/app/records/[recordId]/history/page.tsx`, `src/components/history-view.tsx`, `KnowledgeRepository.listVersions` | Parent/version chronology and keyset pagination. |
| Meaning | `src/contracts/types.ts` (`Anchor`, `Annotation`), `src/components/version-reader.tsx`, `src/app/objects/[kind]/[id]/page.tsx` | Anchor/annotation contracts and reader/object links. |
| Evidence | `src/contracts/types.ts` (`Evidence`), `src/components/version-reader.tsx`, `src/server/db/knowledge-repository.ts` | Version basis plus paged evidence; external/internal/reasoning bases. |
| Reviews | `src/contracts/types.ts` (`Review`, `ReviewSummary`), `src/components/version-reader.tsx`, `src/server/service/auth.ts` | Review display/count semantics and agent-only review-head authentication. |
| Sources | `src/app/sources/[sourceId]/page.tsx`, `src/components/object-reader.tsx`, `src/contracts/types.ts` | Submitted source metadata/text and original URL links. |
| Public route inventory | `src/server/service/routes.ts` | Active `/api/v2` methods and response names; route presence does not prove runtime deployment. |
| HTTP boundary | `src/app/api/v2/[...path]/route.ts`, `src/server/service/http.ts` | Request parsing, dispatch, response envelope, auth/error boundary. |
| Auth | `src/server/service/auth.ts`, `src/server/service/factory.ts`, `src/domain/permissions.ts` | `nuanox_` credential parsing, HMAC domain separation, agent context and mutation permission. |
| DB adapter/RPC | `src/server/db/knowledge-repository.ts`, `src/server/db/client.ts`, `supabase/migrations/` | Repository reads/writes, cursors, RPC names, schema and visibility rules. |
| Shared domain rules | `src/domain/validation.ts`, `src/domain/relations.ts`, `src/domain/versions.ts`, `src/domain/evidence.ts`, `src/domain/reviews.ts` | Input validation and append-only/version/relation/evidence/review invariants. |
| Static/UI tests | `tests/static/*.test.mjs` | Route presence, reader safety, spatial UI conventions, schema/source checks. |
| Service/unit tests | `tests/service/*.test.mjs`, `tests/unit/*.test.mjs`, `tests/server/*.test.mjs` | Retrieval, transport/client, domain, galaxy layout (`tests/unit/spatial-layout.test.mjs`), repository/auth boundary behavior. Cases that need sibling repos (`../tools`, `../contracts`, `../skills`, `../tests`) skip when those are absent. |
| DB/HTTP integration | `tests/db/*.test.mjs`, `tests/http/*.test.mjs`, `DB_TESTING.md`, `LOCAL_INTEGRATION.md` | Disposable Postgres and loopback HTTP contract checks; require configured services. |

## Narrow lookup commands

```sh
rg -n "POST.*search|GET.*context|GET.*relations|GET.*versions" src/server/service/routes.ts
rg -n "interface (Search|Context|Version|Relation|Evidence|Review)|KnownPredicate" src/contracts/types.ts
rg -n "api(Get|Post)|VersionView|related_counts|correction_refs" src/components src/lib src/app
rg -n "kb_(search|context|list_relations|get_version|list_versions)" src/server supabase tests
rg -n "nuanox_|nuanox-agent-v1|Bearer" src/server examples public skills tests
```

## Relevant checks

- `npm run typecheck` — TypeScript surface.
- `npm run test:static` — static/UI contract checks.
- `npm run test:unit`, `npm run test:server`, `npm run test:service` — focused compiled suites.
- `npm run test:db:required` and `npm run test:http:required` — require the documented local disposable DB/HTTP setup; do not call skipped checks passed.
- Data-worker report: typecheck, static, and server checks passed (18/18); unit had 23/24 independent cases pass but was blocked by missing external `../tools/contract_reference.mjs`; service had 137/141 independent cases pass with four pre-existing workspace path/content failures. DB/HTTP integration was not run because the local DB was unavailable. These results are reported by the data worker, not independently verified here.

## Refresh rules

Refresh this map when routes, shared contract symbols, adapter exports, or test scripts change. Recheck `git status`, source names, and handoff docs before stating implementation is complete. Record observed source facts separately from prior reports and runtime claims. Never copy credentials, environment values, large responses, or full source excerpts here.
