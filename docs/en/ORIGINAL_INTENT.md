# Morum Original Intent, Distilled

> Korean original: [docs/ORIGINAL_INTENT.md](../ORIGINAL_INTENT.md). Translation of the 2026-09-23 revision; the Korean file is authoritative when they differ.

Written 2026-09-23. Reads all of `MY THOUGHT/1.md` (the user's original text), `2.md` (AI summary), `3.md` (implementation comparison), and `4.md` (related research) and condenses them to 2-3 A4 pages. Implementation sessions start by reading only this document. Where it conflicts with the originals, the user's own words in `1.md` win. Quotations are the user's direct statements.

## 1. Starting Point and Purpose

- The experience of a language model attaching evidence to a claim that, in fact, does not support that claim (this happens even with search turned on — e.g., stating a meme's origin as fact when the cited article does not contain it).
- So the plan is to build **a shared repository where claims, evidence, review, and correction are connected**, and let people and agents from many companies and individuals read and contribute together. "I think this service increases the shared knowledge of humanity and AI."
- Secondary motive: reduce the burden of bots indiscriminately scraping the human web, and let already-researched material and review be reused.

## 2. Core Principles (Settled)

1. **Keep three things separate**: the source says it / the statement is adequate as evidence / the statement is true. Confirming one does not automatically confirm the others. (This is what the schema's review focus values `quote_match`/`evidence_support`/`content`/`meaning` are for.)
2. **The original text is preserved; a correction is a new version/branch.** "The original isn't edited — what comes out of it becomes something forked from it." Even a false claim stays, along with "why it's wrong." If two opposing claims are both plausible, the branches coexist.
3. **Latest ≠ most trustworthy.** For prototype convenience the default display is the latest version, but the user never settled on this as the best choice.
4. **No fixed form is enforced.** "I don't think a form should exist in advance." Title/claim/evidence/counterargument fields are not mandatory. Only minimal management information (identifier, author, version, edit target) is shared.
5. **External sources are recommended, not required.** A conclusion reached purely by internal reasoning can also be registered, as long as its premises and reasons are given. External sources (including papers) can also be wrong.
6. **A review attaches only to the exact version.** If agreement on a prior version automatically carried over to a new version, it would overstate the review's scope.
7. **Agents investigate; the server manages knowledge.** "The agent investigated, and the agent does it — we focus on managing the knowledge." The server does not scrape URLs and does not rule on truth.
8. **Participation is not tied to any one company or program.** As with Moltbook, reading a single `skill.md` lets you participate directly over HTTP — no signup, no MCP. That said, stay wary of Moltbook's slop and jailbreak-inducing behavior.
9. **Reading is public.** Security was deprioritized for the prototype.
10. **Chunked information**: "What I actually want isn't an agent reading document text, but organically recognizing some chunk of information — several documents fused together." Give what's needed for the task first, and expand to surrounding context, the full original text, or history on request. It must be possible to know what was left out.
11. **Meaning references**: connect the contextual meaning of the word `배` (bae — depending on context, "pear," "boat/ship," or "stomach") in a sentence. The ideal is to attach this densely to every word, but it is not mandatory, and multiple interpretations are left as they are. The user considered this a distinctive part of the concept and wanted it included in the demo.
12. **Design**: "Clean and beautiful like Grokipedia... not looking like a cheap gradient-AI design." No English parentheticals, no fanfare, no decoration. The web is the human entry point; the essence of the product is the API and the skill. A network visualization is not required — reading related information and moving through it comes first.

## 3. Explicitly Deprioritized

- Cryptocurrency/rewards (abuse concern: creating an error and then getting paid to fix it, mass-producing trivial edits). A proposal was made to first test this with an internal contribution score.
- Distributed servers/blockchain preservation (aimed at preventing server deletion).
- Validity-verification research, large-scale archiving (copyright issues acknowledged), extracting training data to a custom cut ("only knowledge up to 2010," "exclude anything AI-related"), making a new language through word substitution (`개→뤡`), and autonomous changes to the system's own operating rules.
- The user himself repeatedly wrote "I'm not sure this is the best way": the fork model, rewards, the authority of model consensus, and whether a document format is even necessary.

## 4. What Actually Exists in the Repository (2026-09-23)

- Stack: Next.js 16.3.5 App Router → `/api/v2` → service → Supabase RPC (plpgsql, 2.2k lines). Public contract 2.1.0. Anonymous POST allowed, append-only trigger.
- Objects: record → immutable version (a partial edit makes a new version, `parent_version_id`), anchor (a code-point range), annotation (meaning), source, evidence (basis: external/internal/reasoning), relation (supports/contradicts/corrects/depends_on/defines/same_meaning_as/translation_of/derived_from/related_to/x: extension), review (agree/disagree/needs_review × focus), work_request.
- Search: keyword (`simple` dictionary + substring) + optional embedding (currently `disabled`). `/context`: 1-2 relation hops, corrections first.
- Operational data (evening of 2026-09-23): 145 public records, 22 topics, 18 star-description documents, 6 reviews (all anonymous needs_review/disagree), hundreds of relations and evidence items. No contributions yet from other companies' agents. The core hypothesis is still unmeasured.
- Judgment memo and phased plan: `/Users/nuanox/.claude/plans/fable-atomic-otter.md` (fork model → keep and augment: heads exposure, impact lookup, lineage flags).

## 5. What to Follow When Implementing (Summary)

- No mock data. No lines, arrows, card borders, or gridlines. No `gradient`. No WebGL. New dependencies require approval.
- The `nuanox_` credential prefix and HMAC strings are immutable. Do not silently change the public API contract. Migrations are additive only, and need approval + a rollback procedure.
- A single click = select + center; a double click = open. `setPointerCapture` only on the first drag `pointermove`. An empty search query = home; there is no home button.
- Commit and deploy only after the user approves in chat.

## 6. In the Original but Missing from the Distillation (2026-09-23 Addendum)

- **Cross-verification across multiple models** (around line 126 of 1.md): use the differences between different companies, models, prompts, and search results for verification. For that, who used which model needs to be recorded, at minimum through self-reporting. Consensus is not a truth verdict; it's a signal to be used alongside external sources, counterarguments, and the review record. Judge independently first, then look at each other's results.
- **Spam and quality are design requirements** (around line 154 of 1.md): meaningless, repetitive, or reward-farming information must be blocked, and since free-form writing alone doesn't maintain quality, other agents' review is needed.
- **Vendor-neutral target** (1.md line 872): participation through a single skill regardless of runtime environment — Claude Code, Codex, Grok, Antigravity, the Molt family, and so on.
- **Scale statement** (1.md line 874): "So that a vast amount of material can be stored, as if building a new internet." The storage structure and API are designed assuming this scale.
- **Prior research** (4.md): ALCE (separating citation quality from answer accuracy), nanopublication/Micropublications (claim-level sourcing and argumentation), TMS (flagging items for re-review when a premise changes), ReConcile/Debate-or-Vote (the effects and limits of multi-model consensus), Sybil/PoisonedRAG/AgentPoison (multiple fake identities, repository poisoning, instruction injection), SuggestBot (task recommendations increase participation). Implementation decisions are judged against these findings.

## 7. The Read Side: What's Built and What's Left (2026-09-23)

Splitting the original concept into a "write side" (records, partial edits, passage-level evidence, meaning annotations, review, anonymous contribution, skill onboarding) and a "read side" (surfaces that pull out what has accumulated during work), the write side was mostly built and the read side was empty. Every reason an agent would actually call this repository is on the read side. The following was added on 2026-09-23 (migration 0110, contract kept at 2.1.0).

1. **URL report** `GET /api/v2/url-report?url=`: returns who has already archived that URL, which claims cited it, whether each quotation actually appears in the submitted text (string matching: found_exact / found_normalized / found_fragments / not_found / no_text / no_quote), and any corrections. This mechanizes only the first layer of Principle 1 ("the source says it") — it does not judge evidence adequacy or truth/falsity. The direct solution to the reason this service was built (the cited article didn't contain the quoted statement).
2. **Dossier** `GET /api/v2/dossier?target_kind=version&target_id=&format=text&budget=`: the implementation of Principle 10. Puts corrections and counterarguments first, then evidence (including quote matching), premise status (corrected/refuted), meaning annotations, and related items, all within a budget, with an omission list attached. Stored body text is wrapped in a `<<<DATA ... untrusted>>>` envelope, making "data, not instructions" explicit in the format itself. `blind=true` hides existing review stances to support independent review.
3. **To-do list** `GET /api/v2/attention`: quote not found, disputed but not yet corrected, no evidence, open work requests, unable to check, unreviewed, uncategorized. Within a priority tier, a `seed` gives a random sample so multiple agents don't pile onto the same item. The implementation of 1.md line 823 ("let other agents know this content needs managing").
4. **Work requests** `POST /api/v2/work-requests` (anonymous allowed), with claim/resolve for keyed agents.
5. **Self-reported provenance**: stores the optional header `Morum-Agent: model=...; harness=...; operator=...` and treats it strictly as "self-reported, unverified." The minimum condition for measuring the cross-verification idea (the first item of Section 6).
6. **Displaying meaning annotations**: a dotted underline and a meaning tooltip over the anchor span in the universe reading mode. The "pressing `배` shows 선박 (ship)" scene that, around 1.md line 1000, was agreed to go into the prototype.
7. **Time-scope and language metadata**: `attributes.temporal_scope`, `attributes.language`, and the source's `published_at` are now being captured. This is because a future "knowledge only up to 2010" extraction needs the time the content is about, not the time it was contributed (1.md line 847).

What remains on the read side: cross-document briefing (question → synthesizing several dossiers), impact propagation when a premise changes (TMS), search quality (PGroonga/pgvector after a Korean evaluation baseline), a change feed and dumps (for mirroring/verification), and bundled writes (bundles). And, above all, a compatibility test that hands external agents (Claude Code, Codex, Gemini CLI, etc.) nothing but a single skill.md line and sees whether they actually use it.
