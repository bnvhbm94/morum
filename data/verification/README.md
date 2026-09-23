# Verification target lists (ROADMAP 2.5)

Built 2026-09-24. Pure data + a checker script; nothing here writes to production or
touches `supabase/`. Feeds ROADMAP 2.6 (seed) and 2.7 (backfill 181 old sources).

## Files

- **`urls.json`** — 191 URLs (min. 180 required): domain, `submitted_text`-ready
  `excerpt` (120–300 chars, verbatim), `excerpt_location`, `topic`, `language`,
  `why_domain` (Perennial-sources status or which AI-citation list names the domain).
  33 distinct domains (≤8 each), 25 topics, 27 Korean-language pages. Every entry
  passed `check-urls.mjs` at `checked_at`.
- **`claims.json`** — 100 sampled claims/questions: 60 FEVER, 25 TruthfulQA, 15 FreshQA.
  Labels and evidence pointers copied verbatim from source, never invented.
- **`check-urls.mjs`** — re-fetches every `urls.json` entry (10s timeout, redirects
  followed, browser UA), strips tags, normalizes whitespace, asserts the excerpt is
  present verbatim, rewrites `urls.json` keeping only passing entries.

## How `urls.json` was built

Domains: seeded from Wikipedia's [Perennial sources](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources)
table (fetched + parsed, "generally reliable" rows only — see `why_domain`), plus the
primary/reference domains ROADMAP 2.5 names (NASA, WHO, CDC, NIH/MedlinePlus, NOAA,
gov.uk, europa.eu, UN, World Bank, IMF, OurWorldInData, arXiv, RFC editor, MDN, Python
docs) and Korean domains (ko.wikipedia.org, korea.kr, kostat.go.kr, kma.go.kr,
encykorea.aks.ac.kr). Pages were fetched with Node's global `fetch` (plain `urllib`
fails TLS on this machine), HTML stripped to text, and a real 120–300-char paragraph
picked programmatically — excerpts come from the actual fetched page, never memory.
Boilerplate (cookie/nav notices, MDN's "Baseline" badge, gov.uk's survey popup, the
`.gov` lock notice, Wikipedia maintenance banners, leaked JSON/embed widgets) was
excluded by pattern after a manual QA pass caught it slipping through once.

Dropped entirely: **Britannica, IMF.org, Science.org, Nature.com** (persistent 403 /
Cloudflare "Client Challenge" — not bypassed, per policy) and **NCBI/PMC** (started
serving a reCAPTCHA mid-session after repeated fetches). No PDFs, JS-rendered pages,
or paywalls attempted. ~55 of ~245 attempted URLs never passed (404 on a guessed
slug, a bot wall, no clean paragraph); the **final two `check-urls.mjs` runs against
the 191 committed entries dropped zero**.

## Datasets in `claims.json`

- **FEVER** (60): CC BY-SA 3.0. Sampled via the HF datasets-server rows API from
  `copenlu/fever_gold_evidence`, not `fever/fever` directly — the latter's own viewer
  returns HTTP 501 (needs `convert_to_parquet`) and isn't reachable via the rows API.
  The mirror faithfully reformats the same official claim/label/evidence data.
  **CC BY-SA 3.0 requires attribution + share-alike on redistribution — flag for
  owner decision D2 (contribution data license) before these 60 are re-published.**
- **TruthfulQA** (25): Apache-2.0, GitHub CSV, spread across 25 categories.
- **FreshQA** (15): Apache-2.0, live Google Sheet linked from its GitHub README.
  `label` is `never`/`slow`/`fast`/`false_premise`, from FreshQA's own columns.

## Re-running the checker, and how these feed 2.6 / 2.7

`node data/verification/check-urls.mjs` overwrites `urls.json` in place with only
what still verifies, printing drop counts/reasons — re-run periodically, pages get
edited. Each entry then becomes a `source` (`submitted_text` = `excerpt`), an
`evidence` item quoting it, and a `quote_match` review, so `url-report` reads
`found_exact`. `claims.json` rows seed matching `evidence_support` reviews, keeping
FEVER's own SUPPORTS/REFUTES/NEI verdict rather than re-deriving one.
