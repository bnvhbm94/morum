# 1.9 site details — implementation spec (owner's choices applied)

Written 2026-09-24. Agent-facing, English. Base design: docs/design/2026-09-23-site-details-B.md (Opus), with the owner's decisions below overriding it. Option A is superseded except where named.

## Owner decisions (2026-09-24)

1. **No first-screen paragraph and no "소개" link.** The introduction lives inside the "Morum" star as ordinary documents (already present: "Morum의 원칙", "Morum에서 할 수 있는 것", "지워지지 않는 저장소", …). The only requirement: the initial camera frames the Morum star (attributes.topic === 'Morum' or the star whose label is exactly "Morum") centred and at a zoom where its planet names are readable. Add `<meta name="description">` and `og:description` with one sentence from README's thesis, Korean: "확인은 한 번 하면 모두가 다시 쓸 수 있어야 합니다. Morum은 누가 어느 출처의 어느 구절로 무엇을 확인했는지 지우지 않고 적어 둡니다."
2. **Planets are not placed on a ring.** Replace the even-angle ring in `placeOrbits` (src/components/universe/layout.ts) with meaning-bearing placement:
   - Distance from the star encodes age and review: `score = 0.6 * ageRank + 0.4 * reviewRank`, both in [0,1] where 1 = oldest / most reviewed among the star's planets (ranks, not raw values, so outliers do not flatten the rest). `r = inner + (1 - score) * (outer - inner)`, then a small deterministic jitter (±6% of the band) from the id hash. Data: `created_at` of the record's first version (or the record) and the review count from `review_summary` if the spatial data has it; if a field is missing, the planet gets score 0.5 and the spec notes it. Do not add server calls for this.
   - Angle from a hash of the record id (`fnv1a32(id) / 2^32 * 2π`), so positions are stable across reloads and unaffected by new documents.
   - Each star gets its own ellipse: axis ratio in [0.72, 1.0] and rotation in [0, π) from a hash of the star id. Apply the ellipse to the (r, angle) point.
   - Many planets: keep area density roughly constant. `outer` grows with `sqrt(count / 12)` (clamped so the star's field never overlaps a neighbouring star: use the existing sibling gap as the ceiling), planet dot radius keeps the existing shrink rule. Above 60 planets, resolve collisions by pushing a planet outward along its own ray in steps of one planet diameter until it clears (deterministic order: by id), never by moving another planet. Above 200 planets, labels follow the existing LOD rule (names only where room); nothing else changes.
   - Keep the reserved meaning channels: size = mass, brightness/glow = review support, ring = relation, blur = reading state. Distance is a new channel; document it in the CSS header comment and in public/skill.md's "Time and language" or universe note in one sentence.
   - Unit tests in tests/unit for: stability (same input → same output), distance ordering by score, ellipse bounds, no two planets closer than one diameter for a 300-planet synthetic star, and outer radius never exceeding the ceiling.
3. **Search box**: on touch / narrow (`(pointer: coarse)` or width < 850px) the search pill stays always visible as today (apply B's §4 sizing: 48px, 16px input text, safe-area bottom). On desktop it is hidden by default and appears on `/` or `Cmd/Ctrl+K`, or when the user starts typing a printable character while nothing is focused; `Escape` or blur with empty input hides it again; while a reader is open, the shortcut still works but the pill renders above the reader. The hint crumb on desktop reads "검색 / · 항성 두 번 눌러 들어가기 · 행성 두 번 눌러 읽기" (Pretendard 12px, `#8a8496`). Focus management: opening puts the caret in the input; hiding returns focus to the previously focused body or the viewport.

## From option B, implement as written

- §2 reader: per-evidence "인용 대조 · <state>" line worded against the submitted excerpt (never "원문"), no ✓/✗ glyphs, no colour meaning; the focus × stance table at the top of the right column; stance words 동의/반대/검토 필요; use `dossier.agreements.reviews` and `counterarguments.reviews` now available (migration 0113 is live) instead of extra requests where possible.
- §3 legacy pages: `/` renders the universe; `/universe` → 308 to `/`; `/versions/:id` renders the universe with that document open (`?doc=`), keep `/versions/:id/raw`; `/records/:id` → 307 to the current version; `/search?q=` → 308 to `/?q=`; keep and restyle `/records/:id/history`, `/sources/:id`, `/objects/:kind/:id` (no card borders, same background, serif titles). Delete `spatial-explorer.tsx`, `search-results.tsx`, `service-introduction.tsx` and their CSS if nothing else imports them; keep `version-reader.tsx` only if the restyled pages still need it, otherwise delete. The version page must keep the ClaimReview JSON-LD injection (src/app/versions/[versionId]/page.tsx, roadmap 2.9) — render it in the server component that wraps the universe.
- §4 phone spacing, §5 `attributes.appearance` (OKLCH fixed lightness palette, five hues + default, texture only on the 20px reader disc, colour keyed to the parent star's on-screen stage), §6 small fixes (selected planet must not borrow the ring/glow channels; grey contrast ≥ 5.5:1).

## Not in scope

Any server or SQL change; any new dependency; the universe's far-field (nebula) rendering; the JS client.

## Acceptance

- `npx tsc --noEmit -p .`, `npm run -s test:unit`, `npm run -s test:static`, `npm run -s test:service`, `npm run -s test:server` pass; static tests that pinned the old ring layout or the old pages are updated, not deleted.
- Screenshots at 1280×800 and 375×812 of: first view (Morum star centred), a star opened, a document opened with evidence states and the review table, the search pill appearing on `/` (desktop) and always present (phone).
