# docs/ux

Populated at UX freeze **U4** (see the program plan's Phase U): the user approved mockup **v5** as
the v1 UX baseline. From this point forward, UX is iterated *in this repo* — the discipline
`specs/README.md` describes for requirements generally, applied to UX specifically. A later,
narrower round — **v6** — added usage mapping (below) on top of the same v5 baseline; both
snapshots are kept, each normative for what it covers.

## What's here

- `ux-brief.md` — the U1 brief (target users, golden path, core loops, v1 non-goals). Unchanged
  since U1; copied here verbatim from the private draft workspace now that it's authoritative.
- `mockups/mockup-v5.html` — the **approved snapshot**: a single self-contained clickable HTML
  mockup, checked in byte-for-byte as it was approved. It is a historical artifact, not a live
  component library — nobody builds against it by importing it; its DOM structure, `data-testid`
  attributes, and interaction logic (all inline `<script>`) are read as the **visual and behavioral
  reference** for the `UX-###` requirements in `specs/ux-*.md`. If a requirement and the snapshot
  ever disagree, the requirement wins (it may have been revised since the freeze); the snapshot
  stays frozen so "what did v5 actually do" is always answerable without git-archaeology.
- `mockups/mockup-v6.html` — a second **approved snapshot**, built as a v5 diff rather than a
  redo: same shell, same `data-testid` convention, same golden-path surfaces, PLUS usage mapping
  (`specs/ux-usage-mapping.md`'s `UX-11xx`) — the Inspector's "Used in behavior" section
  (`usageSectionHtml`/`usageRowsForSceneNode`), the forward/reverse reference-resolution rule
  (`graphNodeSceneRefIndex`), and the two-tier blue-selection/amber-reference highlight vocabulary
  (`setGraphRefHighlight`/`revealRefInViewport`, the `ref-highlight`-prefixed CSS). v6 is normative
  for those usage-mapping surfaces specifically; v5 remains normative for every surface it already
  covered and v6 does not touch (v6's own diff is additive-only against v5's markup/script, so
  nothing v5 already established changed underneath it).
- `mockups/mockup-v2.png` .. `mockups/mockup-v6.png` — screenshots from the iteration history
  (v2: shell + graph canvas; v3: pointer-address affordances; v4: agentic Copilot flow; v5:
  glTF-addressing — identity strip, mesh section, Data tab; v6: usage mapping). v5 and v6 are both
  normative (for their respective surfaces, per above); v2..v4 are provenance only.

`specs/ux-tour.md`'s coach-marks tutorial tour (`UX-12xx`) is the one surface here with **no**
mockup snapshot at all — it was built directly against the shipped real UI rather than iterated as
a private clickable mockup first, so there is nothing to add to the list above; its own spec file
carries the full normative contract instead.

## The freeze process

UX iterated as private clickable HTML mockups *outside* this repo (see each spec file's
"mockup snapshot" reference for which round introduced which surface). At U4, the user approved
round v5 as the v1 baseline. Landing the freeze means:

1. The approved snapshot and its brief are copied into this directory verbatim (above).
2. Every surface the mockup demonstrates gets one `specs/ux-*.md` file with numbered `UX-###`
   requirements — interaction-contract level ("what must be true, testable by Playwright"), not
   pixel-level. These are ordinary spec files: `specs/README.md`'s ID format, status values, and
   drift-detection rules all apply to them exactly as they do to `DOC-###`/`RH-###`/etc.
3. `specs/ownership.json` gains entries mapping this directory and the not-yet-scaffolded UI
   packages (`packages/app/**`, `packages/graph-canvas/**`, `packages/audio-canvas/**`,
   `packages/script-panel/**`) to the spec file that owns them, so `scripts/check-drift.mjs`'s
   ownership-drift check governs UI code and this directory from the moment either exists.
4. From here on, a UX change is a PR that touches the relevant `specs/ux-*.md` file (and, once
   Playwright e2e coverage exists at M2+, the test(s) citing the changed `UX-###` IDs) — not a new
   round of private mockup screenshots.

Every `UX-###` requirement is expected to be **warn-only orphaned** (cited by zero tests) until
Playwright coverage lands at M2+, exactly like every `DOC-###` requirement is today pending
`editor-core`: `node scripts/check-drift.mjs` reports these as warnings, never build failures (see
`specs/README.md`'s "Drift detection" section, point 4, and `STATUS.md`'s `⚠ uncited` markers).

## The `data-testid` convention (normative)

Every interactive or structurally-meaningful element in the mockup — and, going forward, in the
real implementation — carries a `data-testid` attribute in the shape:

```
panel.part[.index]
```

- **`panel`** identifies the top-level surface (`topbar`, `scene-tree`, `viewport`, `inspector`,
  `graph`, `audio-graph`, `script`, `data`, `pointer-picker`, `copilot`, `context-menu`, ...) — it
  is the surface a `UX-###` requirement block (e.g. `UX-500`'s graph-canvas block) is written
  against, not an arbitrary DOM ancestor.
- **`part`** names the specific control or sub-element within that surface (`palette.search`,
  `gizmo-w`, `identity.copy`, `equiv-badge`, ...). Compound parts chain additional dot segments
  the same way (`copilot.proposal.0.accept` is `copilot` → `proposal` (repeated, indexed) →
  `accept`).
- **`[.index]`** is a zero-based index appended when `part` repeats (a tree row, a palette op, a
  proposal card, a history entry) — e.g. `scene-tree.row.3`, `copilot.proposal.1.badge-count`.

This id is **derived from the UX spec ID it realizes**, not the other way around: a requirement
like `UX-304` ("gizmo modes are exactly W/E/R toolbar buttons") names the contract; the elements
that satisfy it carry `viewport.gizmo-w` / `viewport.gizmo-e` / `viewport.gizmo-r`. When the real
app is built, Playwright tests select elements by these ids and cite the `UX-###` id(s) they
exercise in the test title or an `@spec` docblock, exactly as `specs/README.md`'s test-citation
convention describes for every other prefix.

The mockup makes the mapping self-documenting: click the **`?`** button in the top bar
(`topbar.testid-toggle`) to toggle a debug overlay that draws every element's `data-testid` as a
floating label directly over it (see `mockup-v5.html`'s `renderOverlay()`). Open the snapshot in a
browser and toggle it on to see the convention applied to every surface at once.
