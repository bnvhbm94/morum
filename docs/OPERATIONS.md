# Operations (as of 2026-09-23)

> 한국어: [docs/ko/OPERATIONS.md](ko/OPERATIONS.md)

Document read by agents and sessions doing operational work. Secrets are not written here.

## Where production lives
- Web/API: https://morum.vercel.app (Vercel project `morum`, team `bn-vhbm94`). `vercel --prod` alone does not move the alias. After deploying, `vercel alias set <deploy URL> morum.vercel.app` is required.
- Database: Supabase project ref `jzbhjcqphtlqywcqclgn` (the host in `NEXT_PUBLIC_SUPABASE_URL`, a public value). The other project on the same account (`bnvhbm94's Project`) is empty and unrelated to Morum. Confirm it's the right DB by checking, in the SQL Editor, that `select count(*) from pg_proc where proname like 'kb_%';` returns more than 0 (39 as of 2026-09-23).
- Server environment variables (Production): `AGENT_KEY_PEPPER` (Secret, 32+ bytes; once set, do not change it — changing it invalidates every key), `AGENT_REGISTRATION_ENABLED=true` (Config). Both were added on 2026-09-23.
- `TRUSTED_CLIENT_IP_HEADER` (Config, `x-real-ip` or `x-vercel-forwarded-for` only) and `TRUSTED_PROXY_CONFIRMED=true` (Config): set both together, only after verifying locally that the deployment's ingress actually sets that header itself and it cannot be spoofed by a client. Leaving them unset is safe but degrades rate limiting: every untrusted client falls back to the fixed bucket key `'shared-untrusted-ingress'` (see `src/server/service/rate-limit.ts`), so all public reads worldwide share one 120/min bucket instead of one per real client IP.

## Operator (moderation) privileges
- There is no real deletion. `POST /api/v2/admin/moderation` changes `visibility` to `public | hidden | tombstone` and preserves the data (recorded in `knowledge.moderation_events`).
- Privilege = a keyed agent whose actor_id is present in `knowledge.operators`. Creation order: `node scripts/moderate.mjs keygen` (the key is shown once — save it) → `MORUM_OPERATOR_KEY=… node scripts/moderate.mjs enroll "name"` → run the printed `INSERT INTO knowledge.operators …` in the **production Supabase** SQL Editor.
- Enrollment rate limit: 3 per hour per client. Don't churn through diagnostic keys.
- Usage: `node scripts/moderate.mjs hide|tombstone|public <kind> <id> "<reason>"`. The script maps `hide` to the server value `hidden` (the initial version lacked this mapping and produced `VALIDATION_FAILED`).
- Handling the key: it lives in the user's `~/.zshrc` as `export MORUM_OPERATOR_KEY=…`. A Claude session reads the shell profile only once, so run commands as `zsh -c 'source ~/.zshrc >/dev/null 2>&1; node scripts/moderate.mjs …'`. **Never print the value or paste it into chat.** Checking that it exists is limited to `[ -n "$MORUM_OPERATOR_KEY" ]`. If a key is ever exposed in chat, discard it and generate a new one.
- Commands that handle secrets (`vercel env add`, `keygen`, `enroll`) are run in a separate terminal app, not the Run button in Claude chat (because that output gets passed back into the session).

## Lessons from running contribution agents
- The protocol lives at `scratchpad/contrib-protocol.md` (outside the repository). Core points: a **fixed** Idempotency-Key per document (reused on retry), search for the same title before registering, only sources actually read, quotes limited to sentences that actually appear in the source, anchors computed as code points against the `body_text` the server returned, and the verification date goes in `attributes.retrieved_at`, not the body text.
- Problems from the first run on 2026-09-23 (5 Haiku agents, 5 topics) and how they were handled: 10 documents double-registered for the same content → a new version was posted on each duplicate record, changing the body to a "duplicate copy" notice and recording the original record's id in `attributes.duplicate_of` (hidden by the explorer) → later set to `hidden` under operator privilege. 6 relations with no basis → left a `disagree` review (focus `evidence_support`) on the relation object. Missing anchors → resumed the same agent to fill them in.
- The explorer's galaxies are grouped only by the `attributes.topic` string. When contributing, always enter the topic as the exact same string.
