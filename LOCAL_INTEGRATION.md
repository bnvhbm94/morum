> Updated for protocol2.1.0: core writes need no signup, credentials or Markdown. New107 is additive; prior migration bytes are retained. Default local HTTP preparation keeps legacy registration off. The old private Korean credential directory is no longer used.

# Stage 04 local integration runbook - NOT executed in the delivered environment

This runbook does not claim that PostgreSQL, PostgREST or Next ran. The delivered environment had no PostgreSQL/PostgREST/container runtime, and npm failed with EAI_AGAIN. All tests below require a separately acknowledged **disposable LOCAL cluster**, not a user's database, a hosted Supabase project, or a local port forwarding to a remote database. Do not use production secrets. No reset/drop command is part of this procedure.

## 1. Install the retained dependencies and obtain a real lock

From `knowledge_handoff/app`, on a network-enabled local machine with Node 22:

```sh
node --version
npm --version
npm install
npm run typecheck
npm run contracts:generate
npm run test:functional
npm run build
```

Keep the actual generated `package-lock.json`. Then verify reproducibility with `npm ci` and repeat full types/build. No lock exists in this handoff because installation did not complete. The retained pins are Next 16.3.5, React/React DOM 19.3.0 and TypeScript 5.8.3; do not replace them with an invented lock or fake React declarations. Record the resolved versions and lock hash. `TEST_NODE_TYPE_ROOT` was a transparently reported isolated-test fallback here, not a normal installation requirement; unset it after installation.

Use `python ../tools/record_execution.py --stage 4 --label NEW_UNIQUE_LABEL --cwd app --timeout 180 -- npm run test:functional` from `app/` to retain auditable output. Longer DB tests need a suitable timeout. The recorder resolves cwd relative to `knowledge_handoff`, refuses overwriting labels, and redacts known secrets. Do not put secrets in arguments, dump environment values or enable shell tracing.

## 2. Create a NEW local cluster under your non-root account

Install PostgreSQL 15+ and PostgREST locally through an approved package source; inspect and record `initdb --version`, `psql --version`, `postgrest --version`. Those tools were unavailable here. The commands below deliberately create a new private data directory. Confirm that high-numbered ports are unused; never stop a process you do not own to free a port.

```sh
umask 077
export LOCAL_PG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nuanox-stage04-pg.XXXXXX")"
export PGHOST=127.0.0.1
export PGPORT=55474
export PGUSER=nuanox_test_owner
export PGDATABASE=postgres
export PGPASSFILE="$LOCAL_PG_DIR/pgpass"
node --input-type=module <<'JS'
import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const password=randomBytes(32).toString('hex'),dir=process.env.LOCAL_PG_DIR;
writeFileSync(dir+'/initdb-password',password+'\n',{flag:'wx',mode:0o600});
writeFileSync(process.env.PGPASSFILE,`${process.env.PGHOST}:${process.env.PGPORT}:*:${process.env.PGUSER}:${password}\n`,{flag:'wx',mode:0o600});
JS
initdb -D "$LOCAL_PG_DIR/data" --username="$PGUSER" --encoding=UTF8 --auth-local=scram-sha-256 --auth-host=scram-sha-256 --pwfile="$LOCAL_PG_DIR/initdb-password"
pg_ctl -D "$LOCAL_PG_DIR/data" -l "$LOCAL_PG_DIR/postgres.log" -o "-h 127.0.0.1 -p $PGPORT -k $LOCAL_PG_DIR" start
export LOCAL_TEST_DB="kb_core_test_stage04_$(date -u +%Y%m%d%H%M%S)"
createdb "$LOCAL_TEST_DB"
export TEST_DATABASE_URL="postgresql://$PGUSER@$PGHOST:$PGPORT/$LOCAL_TEST_DB"
export ALLOW_TEST_DB_WRITES=1
export ACK_DISPOSABLE_POSTGRES=1
npm run db:apply:test
npm run test:db:required
```

`pg` must be installed for the Node scripts; its libpq-compatible password-file lookup reads the private `PGPASSFILE`. PostgreSQL's administrator password never needs to appear in chat or command arguments. The URL above deliberately omits it.

The migration runner checks loopback, database name, PostgreSQL >=15, UTF8, and absence of `knowledge`. It creates the test-only roles and applies exactly 101, 102, 103, 104, 105, 106, 107. The last schema tag is `stage04-open-contribution`. All six received Stage04 migration files101-106 are byte-for-byte unchanged by this revision. The preceding Stage04 edited104-106 while unexecuted relative toStage03; those earlier bytes are preserved under `baselines/stage03_before_stage04/`. This revision adds only107. **Do not reapply them to an existing database or treat this as a production upgrade plan.** If a previous environment applied Stage03, inspect its actual migration history and design an additive upgrade separately.

If any migration fails, preserve the first SQLSTATE/position and logs. Do not reset/drop/truncate. Use another new database for the corrected migration sequence. Save fixture results before any manual cleanup. Stopping the exact cluster created above, after all checks, is `pg_ctl -D "$LOCAL_PG_DIR/data" stop`; do not remove its files as part of the test.

## 3. Actual Next -> PostgREST -> same PostgreSQL

A direct SQL Request/Response harness is not this test. With the fresh cluster still running and the same DB acknowledgements:

```sh
export ACK_LOCAL_HTTP_STACK=1
export LOCAL_STACK_PRIVATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nuanox-stage04-http.XXXXXX")"
node scripts/prepare-local-http.mjs
```

The preparer creates only a restricted authenticator role **in the acknowledged disposable cluster**, a local HS256 service-role JWT, private app secrets, and a 0600 JSON configuration outside the handoff. It never creates a human owner or an application operator. Keep the private parent directory user-owned and non-symlinked. PostgreSQL statement/error logs can include CREATE ROLE password text on failure; do not enable statement tracing, keep cluster logs private, and redact them before exporting evidence. This DB logging path was not executed here. Its output says `local_configuration_prepared_not_started`, not deployment complete. Set `LOCAL_STACK_FILE` to the exact file path it reports; do not paste its contents into chat. Keep `PGPASSFILE` available for DB tests.

In separate foreground terminals, each with `LOCAL_STACK_FILE` and `ACK_LOCAL_HTTP_STACK=1` set:

```sh
# Terminal A - real PostgREST, loopback only
node scripts/run-local-http.mjs postgrest
# Terminal B - prefix forwarding only, no response fabrication
node scripts/run-local-http.mjs proxy
# Terminal C - production Next build, then real Next server
node scripts/run-local-http.mjs build
node scripts/run-local-http.mjs next
# Terminal D - actual HTTP acceptance against the same database
node scripts/run-local-http.mjs http
```

Each terminal command stays in the foreground. Stop only these processes with Ctrl+C. Native PostgREST exposes `/rpc`; the tiny local proxy maps `/rest/v1/rpc` without changing JSON/authentication or replacing a database. This is a real local PostgREST test using **explicit legacy JWT mode**, not proof of hosted Supabase `sb_secret_*` gateway mapping. The default published-key mode still requires a separately authorized actual Supabase test. PostgREST official configuration/authentication references: `https://docs.postgrest.org/en/stable/references/configuration.html` and `https://docs.postgrest.org/en/stable/references/auth.html` (checked 2026-09-19 UTC).

The default HTTP suite uses actual `fetch`, two anonymous clients without identity files, direct raw text and minimal JSON, committed versions checked through SQL, meaning/evidence/review/context/search, null authors, BOM/CRLF and denied operator/retired routes. It does not enroll agents. The preserved optional legacy HTTP suite is `npm run test:http:legacy-keyed`; it requires explicitly preparing with `LOCAL_INCLUDE_LEGACY_KEYED_TESTS=1`, and is not the public flow. Expected 4xx and provider-disabled 503 are not successful feature demonstrations. No server is started by `npm run test:http`; absent configuration skips a suite with zero passes. `test:http:required` fails instead. Retain both successful and failed logs.

## 4. Korean retrieval using the preserved 30 cases

Use another **fresh evaluation database** in the disposable cluster, apply the same nine migrations, prepare another private HTTP configuration, and restart the three foreground services with it. Do not mix regression fixtures with the evaluation corpus or erase a corpus to make a metric better.

```sh
export KOREAN_EVAL_SPLIT=dev
node scripts/run-local-http.mjs korean
```

The evaluator saves original title/slug/hash -> actual source/version/record IDs, creates children by immutable revision, sends the recorded Korean questions over HTTP, and records first-page recall/MRR, default bounded context recall, and exact **body-locator** accuracy. Empty denominators are null, not perfect scores. Errors abort; no empty-list success or synthetic embedding substitution is allowed. Raw responses and omission/truncation flags are retained. A successful measurement does not itself mean the relevance thresholds passed. Field/object locators are outside its body-locator denominator and need separate coverage.

Only after development choices are frozen, use another fresh evaluation database/configuration for `KOREAN_EVAL_SPLIT=test` and `ACK_KOREAN_HOLDOUT=1`. Do not tune on the 18 held-out questions and call them a holdout again. The default is the 12 development questions. No optional provider is allowed by this runner. Actual semantic quality needs a separate approved local configuration with explicit budget AND data-sharing approval; do not send keys in chat.

## 5. Still separate

Browser rendering/XSS/accessibility, a real Codex/Claude Code session, actual live provider output, SQL query plans/load limits, Supabase hosted key mapping, backup restoration and any deployment remain distinct checks. An exit-zero syntax/source check cannot substitute for them. No cloud preparation plan is an accomplished deployment fact.
