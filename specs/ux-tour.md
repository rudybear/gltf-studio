# ux-tour

Mockup snapshot: none. Unlike every other `ux-*.md` file, this surface was never part of the
approved v5/v6 clickable mockups (`docs/ux/README.md`) — it is a net-new coach-marks tutorial layer
added directly on top of the real, shipped UI rather than a frozen-mockup surface, so there is no
`mockup-vN.html` reference to cite. The requirements below are interaction-contract level exactly
like every other `ux-*.md` file; there is simply no historical screenshot backing them.

Owns (`specs/ownership.json`): `packages/app/src/tour/**` — a dedicated source directory for the
tour engine, its step data, and its `localStorage` persistence seam, carved out of `packages/app`'s
general `ux-shell.md` catch-all so this file's own diff (not `ux-shell.md`'s) is what
`scripts/check-drift.mjs`'s ownership-drift check demands when tour-internal files change. The one
line this feature adds to `TopBar.tsx` (a new tour-entry button, `UX-1200`) is a `packages/app/**`
touch outside `packages/app/src/tour/**`, so it remains governed by `specs/ux-shell.md` — that file
gains its own new `UX-1xx` requirement describing the entry point's existence for that reason (see
its own diff), rather than this file trying to claim a single line inside `TopBar.tsx`.

Prefix: `UX`. This file owns the `UX-12xx` block.

## Requirements

### Entry points

- [UX-1200] (active) A top-bar button distinct from the existing `topbar.testid-toggle` "?" overlay toggle (its own icon/glyph and its own `data-testid`, `topbar.tour-start`) starts the tour at step 1, regardless of whether a prior run was completed, skipped, or never started.
- [UX-1201] (active) On first visit — no tour record in `localStorage` at all — a small dismissible banner offers "Take the tour"; the tour itself never auto-starts. Starting it from the banner behaves identically to starting it from `UX-1200`'s top-bar button.
- [UX-1202] (active) Dismissing the banner persists that choice (never reappears on a later load in the same browser) independently of whether the tour is ever subsequently started, completed, or skipped.

### Persistence

- [UX-1203] (active) Tour state (`bannerDismissed`, `completed`) is persisted as a single app-scoped `localStorage` record, not the `StorageProvider` per-project sidecar (`specs/storage-provider.md`) — a tutorial-seen flag is inherently app-level (the first-visit banner, `UX-1201`, must be able to render before any project exists to key a project-scoped save off of), and `ProjectData.sidecar` has no working read/write path in this codebase today (its only call site hardcodes `sidecar: null`) to build on regardless. All reads/writes go through one module (`packages/app/src/tour/tour-storage.ts`) rather than ad-hoc `localStorage` calls scattered across the tour engine.
- [UX-1204] (active) Completing the tour (reaching and closing its final step) sets `completed: true`; exiting early — Skip or Esc (`UX-1211`) at any other step — persists the banner-dismissed state if not already set, but does NOT set `completed: true`. Neither outcome blocks a later relaunch (`UX-1200`).

### Step content and anchoring

- [UX-1205] (active) The tour is an ordered sequence of steps, each naming exactly one real `data-testid` element to spotlight (or, for a step with no anchor, a centered card with no spotlight cutout); the step sequence's data (id, anchor, title, body, optional pre-action) is a single typed array (`packages/app/src/tour/steps.ts`), consumed as-is by both the runtime overlay and the e2e suite that iterates it — this file does not duplicate per-step title/body text, only the structural contract every step satisfies.
- [UX-1206] (active) Before measuring a step's anchor, the engine runs that step's optional pre-action (a store call switching the active dock tab and/or right-panel tab) so an anchor inside a currently-hidden tab becomes real DOM before positioning is attempted.
- [UX-1207] (active) Because a dock/right-panel tab switch can mount a panel lazily (e.g. the Script tab, `specs/ux-script.md`'s `UX-707`) rather than synchronously, the engine retries measuring the anchor for a short bounded window after a pre-action runs, rather than assuming the element exists on the very next paint.
- [UX-1208] (active) If the current step's anchor is not already fully within the viewport, the engine scrolls it into view before computing the spotlight cutout and card position.
- [UX-1209] (active) While a step is showing, the spotlight cutout and card position track the anchor's live bounding rect — both a window resize and a scroll of any scrollable ancestor while the step is open trigger recomputation, so the highlight never drifts away from a moving/resizing target.

### Chrome and controls

- [UX-1210] (active) Each step's card shows the step's title, body, Next/Back (Back disabled on the first step)/Skip controls, and one progress dot per step with the current step's dot visually distinguished; the dimmed overlay outside the spotlight cutout is opaque enough, and the card's text contrast high enough, to read clearly in both the light and dark theme (`specs/ux-shell.md`'s `UX-104`/`UX-105` theme mechanism) without a tour-specific theme override.
- [UX-1211] (active) Pressing Escape while the tour is open closes it immediately (same visible effect as Skip) and is treated as an early exit for persistence purposes (`UX-1204`), not as completion.

## Adopted defaults / open questions

- Esc is treated as equivalent to Skip (early exit, banner-dismissed persisted, `completed` left untouched) rather than as a silent no-op-on-persistence "dismiss" — chosen for consistency: the tour has exactly two ways to stop looking at it early (Skip's button, Esc's key) and only one way to complete it (advancing past the final step), so both early-exit paths share one persistence rule rather than each inventing its own.
- OPEN(UX-tour-analytics): nothing here tracks *which* step a user was on when they skipped/Esc'd, only the binary completed/not-completed + banner-dismissed state `UX-1203` persists — sufficient for "don't nag a user who's already seen this," not for any funnel/drop-off analysis. Left open since there is no analytics pipeline in this codebase to feed today.
- OPEN(UX-tour-gallery-coupling): the `starter-gallery` step (`steps.ts`) anchors on `viewport.gallery`, a surface owned by `specs/ux-viewport.md` and under active, concurrent rework at the time this file was written. This file does not re-specify the gallery itself (that remains `ux-viewport.md`'s), only that a tour step points at it; a future gallery redesign that removes or renames that testid will need a corresponding `steps.ts` update, caught by this file's own `UX-1205` contract test (every step's anchor must resolve to a real, visible element) rather than by anything gallery-specific here.
