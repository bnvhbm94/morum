# Actual PostgreSQL verification - Stage04 open-contribution revision

**Not run here.** No local PostgreSQL/PostgREST executable or acknowledged disposable DB was available. Three actual-DB suites are authored; zero DB tests passed. Full runtime setup is in [LOCAL_INTEGRATION.md](LOCAL_INTEGRATION.md). The final machine-readable result is `../reports/stage04_revision/TEST_RESULTS.json`.

## Current acceptance

`npm run test:db:required` first requires explicit local DB acknowledgements, then compiles the real adapter and runs three suites. An unconfigured `test:db` skips all three; an exit-zero runner is not a successful database test.

- `tests/db/open-contribution.integration.test.mjs`: real minimal/raw text storage with null authors, concurrent anonymous receipts, same-parent forks, atomic rollback, append-only anonymous reviews and no fabricated shared identity, meaning supplements, table/RPC privileges, hidden receipt replay.
- `tests/db/stage04.integration.test.mjs`: retained optional keyed-agent compatibility, grants/RLS/search paths, rollback, review-head contention, Unicode/edit vectors, visibility/snapshot rechecks, provider-disabled worker leases/retries, enrollment replay versus revocation. Keyed test enrollment is an explicit synthetic fixture, not a public participation prerequisite.
- `tests/db/stage03.integration.test.mjs`: retained keyed protocol flow over actual SQL and the Request/Response dispatcher. It is not an actual Next/PostgREST server.

For anonymous actual **Next -> PostgREST -> PostgreSQL** execution, use `npm run test:http:required` after following the local runbook. This is a different suite and has not run here. Its default clients never enroll. The optional older keyed HTTP suite is `test:http:legacy-keyed`, only with explicitly enabled local legacy fixtures.

## Migration history

This revision retains `202609200107_open_contribution.sql` after the six received Stage04 migrations and adds `202609200108_deferred_trigger_security.sql` for the commit-time deferred-trigger permission fix found by real PostgreSQL execution. The first seven files remain unchanged. Fresh test DBs apply exactly101-108; final schema version2.1.0/tag`stage05-deferred-trigger-security`. Never reset an existing schema to satisfy a test. The runner refuses an existing `knowledge` schema.

The preceding Stage04 had changed104-106 relative toStage03 while unexecuted. Therefore an actual preexisting Stage03 DB cannot safely be treated as matching this baseline. Inspect its real migration history and design an additive upgrade; do not blindly reapply historical files. Earlier snapshots/logs and the received Stage04 ZIP remain in `../baselines/`.

## Limits of these authored tests

Tests may expose SQL or harness defects on first real execution. A source-only SQL test is neither a PostgreSQL parse nor evidence of correct locking, grants or transactions. Malformed JavaScript surrogate inputs are rejected before SQL; PostgreSQL UTF8 cannot represent them, and skipped SQL vectors are not counted as passes. Raw CRLF/BOM/combining scalars are legitimate preserved data.

Worker tests do not enable a provider or create fake vectors. Live-provider semantic quality, saturated graph/context behavior, crash-retry exhaustion, cross-operator worker interleavings, query plans/load capacity, hosted Supabase key mapping, backup restore, browser behavior and real external-agent sessions require separate evidence. Semantic retrieval remains disabled, not an empty-list success.

The historical v1 `tests/db/core.integration.test.mjs` is reference material, not the current product acceptance. Do not restore human owners, approval or work-management behavior merely to make it pass.

Only use an acknowledged **new disposable local** PostgreSQL15+ UTF8 DB named `kb_core_test_*`, with `ALLOW_TEST_DB_WRITES=1` and `ACK_DISPOSABLE_POSTGRES=1`. A loopback port may be a remote tunnel; exclude that explicitly. No user, shared, hosted or production database is authorized by this handoff.
