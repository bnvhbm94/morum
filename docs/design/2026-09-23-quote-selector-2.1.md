# 2.1 Quote-first selectors — implementation spec

Written 2026-09-23 by the planning session for roadmap item 2.1. Agent-facing, English. Status: designed, not started. Depends on: nothing (1.5 route registry should land first so the new route is registered the new way). Production push of the migration is done by the owner.

## Why

Agents know the sentence they mean; they rarely know its code-point offset. Today `anchor.create` and `version.create` edits require `start`/`end` and fail with `TEXT_MISMATCH` when the offset is stale. W3C Web Annotation treats TextQuoteSelector (`exact`, `prefix`, `suffix`) as primary and positions as brittle hints. Morum keeps exact code-point ranges as the stored truth (anchors are ranges) but lets the caller locate them by quote. The server finds the range; it never guesses. Zero matches or several matches are errors, never a silent attachment at the wrong place.

## Contract (additive, 2.1.x)

1. `TextSelector` input: `start` and `end` become optional; `prefix` and `suffix` become optional (default `""`). `unit` and `exact` stay required. Output `Anchor.selector` is unchanged (all fields present, resolved).
2. `TextEdit` input: `start`/`end` optional; new optional `prefix`/`suffix` (max 32 code points each, like anchors). Output (`version_changes`) stores the resolved edit with `start`/`end` filled in, so `project_anchor` and history readers see the same shape as before.
3. Resolution rule, identical for anchors and edits:
   - `start` and `end` present: exactly today's behaviour (strict; `TEXT_MISMATCH` on mismatch, prefix/suffix checked when given). No change for existing clients.
   - `start`/`end` absent, `exact` non-empty: find every occurrence of `exact` in the body (code-point positions). If `prefix` is given, keep only occurrences immediately preceded by it; same for `suffix`. Exactly one left: use it. None: `SELECTOR_NOT_FOUND` (409, same family as `TEXT_MISMATCH`). More than one: `AMBIGUOUS_SELECTOR` (422). Comparison is exact code points; no normalisation (normalisation belongs to evidence quote checks, not to anchors).
   - `exact` empty (an insertion) without `start`/`end`: allowed only when both `prefix` and `suffix` are non-empty; the point is the unique boundary where `prefix` ends and `suffix` begins. Otherwise `VALIDATION_FAILED`.
4. New error codes in `ErrorCode`: `SELECTOR_NOT_FOUND` (409), `AMBIGUOUS_SELECTOR` (422). Error `details` stay `null` on the wire (existing rule: details are never serialised), so candidates are not returned by the write. They are obtained from the new read surface below.
5. New public read route `POST /versions/:version_id/locate`, body `{ "exact": string, "prefix"?: string, "suffix"?: string }` (JSON, ≤16 KiB), response `LocateResult`:
   ```json
   { "version_id": "...", "body_sha256": "...", "state": "unique" | "ambiguous" | "not_found",
     "candidates": [ { "start": 120, "end": 168, "prefix": "…32 cp…", "suffix": "…32 cp…" } ] }
   ```
   `candidates` has 1 entry for `unique`, 2–10 for `ambiguous` (the scan stops after the 11th match; `truncated: true` is then set), 0 for `not_found`. `body_sha256` is returned so the caller can send it straight to `anchor.create`. Public visibility rules apply (hidden/tombstoned versions → `NOT_FOUND`). Rate limit: the normal `read:` bucket.

## SQL — migration `202609200112_quote_selectors.sql` (+ `supabase/rollback/202609200112_quote_selectors_down.sql`)

- `knowledge.locate_quote(p_body text, p_exact text, p_prefix text, p_suffix text, p_max integer DEFAULT 11) RETURNS jsonb` — IMMUTABLE, `SET search_path=''`, loops with `pg_catalog.strpos` on the remaining text (code-point arithmetic like the rest of the file), filters by prefix/suffix, returns `{state, candidates:[{start,end,prefix,suffix}], truncated}`; the empty-`exact` boundary case implemented by locating `prefix||suffix` and returning the point after `prefix`.
- `knowledge.resolve_selector(p_body text, p_sel jsonb) RETURNS jsonb` — returns the selector with `start`/`end` filled in, raising `KB:SELECTOR_NOT_FOUND` / `KB:AMBIGUOUS_SELECTOR`; when `start`/`end` are present it returns the input unchanged (the existing strict checks still run afterwards).
- `knowledge.mutate`: in `anchor.create`, `sel = knowledge.resolve_selector(v.body_text, j->'selector')` before the existing checks; in `version.create`, resolve every edit against `base.body_text` before `apply_edits` and store the resolved array in `version_changes`. Validation branches (`validate_command`) accept the optional fields.
- `public.kb_locate(p_query jsonb) RETURNS jsonb` — SECURITY DEFINER, service_role-only EXECUTE, REVOKE from PUBLIC/anon/authenticated, public-visibility check, calls `locate_quote`. Add to `RPC_NAMES` and `rpc-shapes.ts` (`checkLocate`). Schema tag `stage08-quote-selectors`; `kb_health` tag updated.
- Rollback: restore the 0110 `knowledge.mutate` body verbatim, drop `kb_locate`, `resolve_selector`, `locate_quote`, restore tag `stage07-read-surfaces`.
- Committed migrations are never edited; pin the new file with `node scripts/pin-migrations.mjs`.

## TypeScript

- `src/contracts/types.ts`: optional fields as above, `LocateRequest`, `LocateResult`, two error codes. `CONTRACT_VERSION` stays `2.1.0` (additive).
- `src/domain/validation.ts`: `anchor.create` selector — `unit`, `exact` required; `start`,`end`,`prefix`,`suffix` optional with the same bounds; if one of `start`/`end` is present the other must be. `version.create` edits — same, plus `prefix`/`suffix` optional ≤32.
- `src/domain/errors.ts`: `STATUS` entries for the two codes.
- Route entry `{method:'POST', path:'/versions/:version_id/locate', auth:'public', response:'LocateResult', summary:'Find where a quoted passage occurs in a version body.', query:[]}`; handler in `handlers/reads.ts`; response max 262144 bytes.
- `public/skill.md`: new short section "Locate by quote, not by offset" (anchor and edit examples without `start`/`end`; what `AMBIGUOUS_SELECTOR` means and how to resolve it with `/locate`; positions still accepted). `public/agent/api-routes.json` regenerated.

## Tests

- DB (`tests/db/quote-selectors.integration.test.mjs`, fresh DB): unique quote → anchor created with resolved range equal to the position path; two occurrences → `AMBIGUOUS_SELECTOR`, then `prefix` disambiguates; missing → `SELECTOR_NOT_FOUND`; insertion by `prefix`+`suffix`; edits by quote produce the same new body as edits by position; `version_changes` row has resolved `start`/`end`; positional path still raises `TEXT_MISMATCH` on stale offsets; `kb_locate` on a hidden version → `NOT_FOUND`; `kb_locate` truncation at 10.
- Service: validation matrix for the optional fields; `/locate` route (public, POST, body limits, 404 on unknown version).
- Static: RPC count derives from files (nothing to edit); registry test picks up the new route automatically.

## Out of scope

Fuzzy re-anchoring (diff-match-patch as in Hypothesis) and normalised matching for anchors. Those change what an anchor means and need a proposal.
