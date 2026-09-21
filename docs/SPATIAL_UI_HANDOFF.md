# Spatial UI handoff

The home route now renders `SpatialExplorer` from `src/components/spatial-explorer.tsx`. It consumes the committed adapter in `src/lib/spatial-data.ts`; no mock document array, database access, credential, route, or migration was added.

## Implemented behavior

- Home and current-scope search results occupy deterministic integer coordinates in a borderless, line-free dotted field. One world layer receives `translate3d`; pointer movement is coalesced through `requestAnimationFrame`, and node lightness follows continuous distance from the viewport center.
- Drag selection, decaying inertia, click suppression after a drag, pointer capture/cancel, deterministic directional-arrow selection, Enter-to-read, editable/IME keyboard guards, and reduced-motion shortcuts are implemented.
- The bottom search control debounces for 1000 ms, aborts superseded requests, rejects stale generations, returns to home data on an empty query, stays visible while focused/composing, and otherwise returns after two idle seconds. Search status is described as search results without inferring logical relationships.
- Reading fetches the exact version and bounded relations together. Left and right columns use the adapter's relation semantics, show at most four items per side, keep non-hierarchical relations in “기타 관계”, expose fixed/raw/history routes, and disclose when more relations exist. Side navigation fetches the next full version before replacing the center. Escape and the 34 px glass close control return to the preserved map state.
- Desktop and mobile reader layouts, touch scrolling, focus-visible treatment, and reduced-motion styles are included. The existing dedicated `/records`, `/versions`, `/search`, `/objects`, and `/sources` routes remain intact.

## Verification

- `npm run typecheck` passed.
- `npm run test:static` passed: 18/18, including four new spatial UI checks.
- `npm run build` passed on Next.js 16.3.5; all expected routes were emitted.
- Local Chrome check at `http://localhost:3000` confirmed the desktop and 390 × 844 mobile failure states, focused search field, 1000 ms search request, retry action, and no browser console errors from the application. A mobile screenshot was captured in the browser verification session but was not written into the repository.

The local API could not return records because the required local database/configuration was unavailable. Consequently live-data drag, double-click-to-read, relation transition, history, and back/forward checks could not be exercised in the browser. The production build and source behavior tests cover their wiring, but this is not reported as live integration verification. The previously documented missing external reference fixture, four service-suite workspace/path failures, and unavailable DB integration remain unchanged.

Implementation commit: recorded in Git history immediately after this handoff was written.
