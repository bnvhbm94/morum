# Spatial UI visual QA handoff

Date: 2026-09-21 (Asia/Seoul)

Scope: reviewed the current spatial explorer and reader implementation after reading `지휘자 지침.md`, `docs/PROJECT_BRIEF.md`, `docs/SPATIAL_UI_HANDOFF.md`, `src/components/spatial-explorer.tsx`, `src/app/page.tsx`, and the spatial section of `src/app/globals.css`. Existing user and inherited changes were preserved.

## Browser evidence

- Chrome development render at the default desktop viewport (1648 × 873): the explorer root now fills the viewport, the dotted field is visible edge to edge, the bottom glass search stays centered, and the 503 error/retry state remains legible at the top left.
- Chrome responsive render at 390 × 844: the root and viewport both measured 390 × 844 with document scroll size equal to the viewport; the search control measured 358 × 52 at x=16 and remained within the screen; the wrapped 503 message and retry control stayed readable.
- Focused search field remained visible and readable. Entering a query triggered the expected debounced request after 1000 ms and returned the same explicit connection failure state.
- Browser console had no application errors. The only warning was the expected Next.js Fast Refresh full-reload notice during editing.

## Fixes

- `src/app/globals.css`: restored the fixed containing block for `.spatial-explorer` when it is a direct child of `.site-shell`. The shared shell rule had changed the root to `position: relative` with `height: 0`, collapsing the world and dot layers behind the independently positioned overlays.
- `src/components/spatial-explorer.tsx`: gave loading and error reader dialogs an accessible fallback name when the loaded document heading does not yet exist.

## Checks

- `npm run typecheck` passed.
- `npm run test:static` passed (18/18).
- `npm run build` passed; expected routes emitted.

## Limitations

The local API returned HTTP 503 because the required database/configuration is unavailable. No live document nodes, reader content, relation navigation, drag/inertia, history transition, or browser back/forward behavior could be exercised, and no live-data success state was fabricated. Reduced-motion behavior was verified from the existing source/static checks; a browser-level OS preference override was not available in this session.
