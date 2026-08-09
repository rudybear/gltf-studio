# ux-shell

Mockup snapshot: `docs/ux/mockups/mockup-v5.html` (approved at UX freeze U4 — see
`docs/ux/README.md`). This file specifies the application shell: the top bar, the four-region
workspace layout (left panel / center column / right panel, with the bottom dock inside the center
column), theme, play-state chrome, the history dropdown, toasts, and the `data-testid` convention
every other `UX-###` spec assumes. The panel-internal contents (scene tree, viewport, inspector,
dock tabs) are specified by their own files (`specs/ux-scene-tree.md`, `specs/ux-viewport.md`,
`specs/ux-inspector.md`, `specs/ux-graph-canvas.md`, `specs/ux-audio-graph.md`, `specs/ux-script.md`,
`specs/ux-data-tab.md`); this file owns the chrome around them.

Owns (`specs/ownership.json`): `docs/ux/**`, and — once scaffolded — `packages/app/**` as the
catch-all for any editor UI code not owned by a canvas-specific package (`ux-graph-canvas.md`,
`ux-audio-graph.md`, `ux-script.md`). Requirements for surfaces not yet given their own package
(scene tree, viewport, inspector, data tab, pointer picker, Copilot panel) are specified in their
own files below but are governed, for drift-check purposes, only indirectly via this catch-all
until each surface earns a dedicated package.

`packages/app` is scaffolded at M2: a Vite + React + zustand shell implementing UX-100..105/
UX-108..111 for real (UX-106/107's play-state chrome has no play-mode state machine to drive yet,
so it isn't rendered rather than faked), plus the scene-tree/asset-browser surfaces from
`specs/ux-scene-tree.md` and the Data (glTF) tab from `specs/ux-data-tab.md` (both real — cheap
once `editor-core`'s document layer exists). Behavior graph/audio graph/script/Copilot render as
placeholders; the play bar remains a disabled-with-tooltip stub. Export (`UX-112`) becomes real at
M3 (`editor-core`'s byte-preserving `save()`, `specs/document-model.md`'s DOC-024..026/034, to a
browser download). See `e2e/shell.spec.ts`, `e2e/import.spec.ts`, and (M3) `e2e/export.spec.ts` for
the Playwright coverage citing these IDs.

Prefix: `UX`. This file owns the `UX-1xx` block (`UX-100`..`UX-1xx`); each other `ux-*.md` file
owns its own hundred-block (`UX-200` scene tree, `UX-300` viewport, `UX-400` inspector, `UX-500`
graph canvas, `UX-600` audio graph, `UX-700` script, `UX-800` data tab, `UX-900` pointer picker,
`UX-1000` Copilot) per `docs/ux/README.md`'s freeze process.

## Requirements

### Layout regions

- [UX-100] (active) The workspace is four regions: a left panel (scene tree over an asset browser), a center column (viewport over a bottom dock), a right panel (Inspector/Copilot tabs), and a top bar spanning the full window width above all three; a play-state locked banner appears between the top bar and the workspace only while play mode is active or paused.
- [UX-101] (active) The left and right panels and the bottom dock are each independently resizable via a drag handle on their shared edge (left panel: right edge; right panel: left edge; bottom dock: top edge); dragging live-resizes the region with no separate commit step.
- [UX-102] (active) Panel resize is clamped: left panel width to `[190px, 480px]` (default `260px`), right panel width to `[220px, 480px]` (default `300px`), bottom dock height to `[140px, 70vh]` (default `300px`); a drag cannot move a region's size outside its own bound regardless of drag distance.

### Bottom dock

- [UX-103] (active) The bottom dock has exactly five tabs — Behavior graph, Audio graph, Script, Console, Data (glTF) — with exactly one active/visible at a time; switching tabs does not reset the state of the tab being left (e.g. graph canvas scroll position, script divergence state).

### Theme

- [UX-104] (active) On first load, the shell's theme (light/dark) follows the OS `prefers-color-scheme` media query with no explicit override recorded.
- [UX-105] (active) The top bar's theme toggle sets an explicit theme override (independent of `prefers-color-scheme`) that persists across further OS-theme changes until the toggle is used again; every themed surface in the shell (not only the top bar) reflects the override.

### Play-state chrome

- [UX-106] (active) While play mode is `playing`, the top bar is tinted with the accent color and a locked banner reading "Document locked while playing — Stop to edit." is shown; while `paused`, the top bar is tinted a distinct (warning/neutral) color and the banner instead reads a paused-specific message; while `stopped`, neither tint nor banner is shown.
- [UX-107] (active) The play-state locked banner and top bar tint are the shell's visible expression of `EditorDocument` being frozen for the duration of play mode (`DOC-031`) — they are shown for exactly the states in which `DOC-031` forbids `Command` application, and hidden otherwise.

### History dropdown

- [UX-108] (active) The top bar's History control opens a dropdown listing every history entry in order, with the most recently pushed or redone entry visually marked as current; the dropdown's entry list is agnostic to whether an entry was manually authored or Copilot-originated (see `UX-1007`) — both render as plain history-entry rows.

### Toasts

- [UX-109] (active) Toasts are transient, non-modal notifications anchored to the bottom-right of the window, auto-dismissing after a fixed duration (~1.8s) without requiring user interaction, and never block input to the rest of the shell while shown.

### `data-testid` convention (normative)

- [UX-110] (active) Every interactive or structurally-meaningful element carries a `data-testid` in the shape `panel.part[.index]` (`panel` = the top-level surface the owning `UX-###` requirement is written against; `part` = the specific control, chainable for compound parts; an optional zero-based `.index` when `part` repeats), derived from the `UX-###` requirement(s) the element realizes — never invented ad hoc once a requirement exists for the surface. See `docs/ux/README.md` for the full convention and worked examples.
- [UX-111] (active) A top-bar toggle (the `?` control) switches a debug overlay on/off that draws every on-screen element's `data-testid` as a floating label positioned over it, recomputed on window resize and on any layout-affecting state change while the overlay is on; the overlay is purely a debugging aid and has no effect on any other requirement's behavior.

### Export (M3)

- [UX-112] (active) The top bar's Export control is disabled (with a tooltip) whenever no document is open; with a document open, clicking it writes the current document's bytes — via `editor-core`'s `save()` (`specs/document-model.md` DOC-024..026) — to a browser download (or, once a File-System-Access-backed `StorageProvider` is wired in, a native save-to-handle dialog when `capabilities.fileHandles` is true, `specs/storage-provider.md` SP-013) and confirms via a toast (`UX-109`) summarizing the save report (spliced roots, or a full reserialize).

## Implementation notes

- M4 (`packages/graph-canvas`'s dock-tab wiring, `packages/app/src/components/dock/BottomDock.tsx`):
  the Behavior graph tab surfaced a real instance of `UX-103`'s own worked example ("switching tabs
  does not reset the state of the tab being left (e.g. graph canvas scroll position...)") — the
  canvas has real local view state (React Flow pan/zoom, palette search/collapse) that the dock's
  pre-M4 conditional-mount-per-tab pattern (fine for stateless placeholders, and for Console/Data,
  whose state already lives in the store) would have discarded on every tab switch. `BottomDock`
  now keeps the Behavior graph tab's content mounted (hidden via `display: none`/`contents` rather
  than conditionally rendered) so this state survives; the other four tabs keep the simpler
  conditional-mount pattern since they don't need this.

## Open questions

- OPEN(UX-history-jump-tbd): `UX-108` specifies listing every history entry with the current one
  marked, but says nothing about clicking a non-current entry — whether that should jump (undo/redo
  to that point, the common DCC-app convention) or is inert. M2's `packages/app` implementation
  (`HistoryDropdown`, real as of the viewport-integration PR) renders the list read-only pending
  this decision — entries are not clickable — rather than guessing at jump semantics `UX-108` does
  not commit to.
- OPEN(UX-theme-reset-tbd): once an explicit theme override (`UX-105`) is set, there is no
  specified way to return to following `prefers-color-scheme` again short of toggling back and
  forth manually; whether a "follow system" third state is needed is deferred.
- OPEN(UX-dock-placement-tbd): the bottom dock spans the full window width below the viewport,
  sitting between the left and right panels' bottom edges (the adopted default, per the approved
  mockup) rather than being nested only under the center column while the side panels run full
  height. A dock-under-viewport-only layout was considered but not adopted for v1.
- OPEN(UX-toast-queue-tbd): the mockup shows at most one or two toasts at a time in the natural
  course of clicking through it; a queuing/stacking-limit policy for many toasts firing in quick
  succession is not specified.
