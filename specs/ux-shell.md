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

M4 adds the pointer-picker dialog (`specs/ux-pointer-picker.md`'s `UX-9xx`, mounted once at
`App.tsx`'s top level like `ToastLayer`/`TestIdOverlay`, driven by the store's
`pointerPickerRequest`) and the scene-tree-row/Animations-tab-clip HTML5 drag SOURCES
`specs/ux-scene-tree.md`'s `UX-209` and `specs/ux-graph-canvas.md`'s `UX-508` need (the drop TARGET
and drop-menu live in `packages/graph-canvas`, which owns that gesture's other end) — both real as
of that milestone, alongside `specs/ux-graph-canvas.md`'s `UX-509` Data-tab jump.

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

### Play mode (M6)

- [UX-113] (active) The play-bar's Play/Pause/Stop buttons and engine-picker (`playbar.play`/`playbar.pause`/`playbar.stop`/`playbar.engine-picker`) drive `PlayController` per `specs/ux-viewport.md`'s `UX-310`; while `paused`, the locked banner (`UX-106`) reads "Playback paused — Stop to edit."; edit-affordances (Data tab, Inspector, gizmo, scene-tree drag/drop) are disabled while `playing` or `paused`, matching the same states in which `UX-107` shows the banner.

### Sample scene (checkpoint)

- [UX-114] (active) The viewport's empty-project state (`UX-3xx`'s "no document open" placeholder) additionally shows a "Load sample scene" button (`viewport.load-sample`) alongside the existing "Import a .glb to get started." note; clicking it fetches the repo's committed checkpoint sample asset (`samples/playground.glb`, generated by `scripts/make-sample.mjs`) as a static file this app's own build serves, and imports it through the exact same path a manually-picked file would (`importGlb`) — a failed fetch surfaces a toast (`UX-109`) rather than a silent no-op.

### Multi-file import (fix: `.gltf` + external references)

- [UX-115] (active) The top bar's Import control (`topbar.import`/`topbar.import-input`) accepts a multi-file selection (the file input allows selecting more than one file) or a drag-and-drop file set dropped onto the `topbar.import` button, in addition to a single `.glb`: when a `.gltf` is among the chosen files, every external reference it makes (`buffers[].uri`, `images[].uri`, `KHR_audio_emitter.audio[].uri` — `data:` URIs are already self-contained and untouched) is resolved against the OTHER chosen files and packed into one self-contained GLB before import, so the resulting document never points outside itself and export (`UX-112`) always writes one coherent `.glb`. `UX-118` adds two more ways of assembling that same "chosen files" set — a `showOpenFilePicker` multi-select and a dropped folder's full contents — both of which still funnel through this same resolve-and-pack behavior.
- [UX-116] (active) A `.gltf` chosen without every external file it references fails the import outright — a toast (`UX-109`) names every missing filename (e.g. "select scene.bin, scene.wav together with scene.gltf") — and leaves whatever document was already open completely unchanged; the viewport never silently ends up empty or partially loaded. `UX-117` additionally opens a recovery dialog on this same failure rather than being a dead end.
- [UX-117] (active) (fix: user-reported "when I load drum-kit — it doesn't see the files in the same folder" — a plain `<input type="file">` pick genuinely cannot read a picked file's sibling files for security reasons, so a single `.gltf` chosen alone can never auto-resolve its own directory on its own) `UX-116`'s failure additionally opens a missing-files dialog (`missing-files.dialog`), naming every unresolved filename (`missing-files.list`) and explaining, in one sentence, exactly what to do next. When `window.showDirectoryPicker` is available (feature-detected; Chrome/Edge as of this writing), the dialog's PRIMARY action is `missing-files.grant-folder` ("Grant folder access…"): choosing the folder the `.gltf` lives in resolves every missing reference against that directory's contents (recursively, so a `textures/` subfolder still resolves) and completes the same pack-and-import path `UX-115` already uses, with no need to reselect anything already provided. When unsupported, that button is omitted entirely and the dialog's copy instead explains reselecting/dragging every named file together (`UX-115`'s existing paths). `missing-files.cancel`/`missing-files.close-x`/backdrop-click/Escape close the dialog without importing anything, leaving the current document (if any) exactly as `UX-116` already guarantees; granting a folder that still doesn't have everything updates the missing list in place rather than closing the dialog or failing outright.
- [UX-118] (active) Two more ways to build `UX-115`'s "chosen files" set, both aimed at the same bug report as `UX-117` — getting the user to a working import with as few manual steps as possible: (1) when `window.showOpenFilePicker` is available, clicking `topbar.import` uses it (a native multi-select dialog) instead of the hidden `topbar.import-input`, falling back to the `<input>` automatically when unsupported or if the picker throws for a reason other than the user cancelling it — this still can't grant directory access on its own, so a single `.gltf` picked this way with unresolved references still surfaces `UX-117`'s dialog; (2) dropping an entire FOLDER — onto `topbar.import`, or anywhere else on the window — walks its full contents via `DataTransferItem.webkitGetAsEntry()`'s directory-entry traversal and imports every file found exactly as a multi-select would, resolving `UX-115` in one step with no follow-up dialog at all when every reference is satisfied within the dropped folder — the true "it just sees the files" flow.

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
- M5 (`packages/script-panel`'s dock-tab wiring, `BottomDock.tsx` +
  `ScriptTabPanel.tsx`): the Script tab becomes real (`specs/ux-script.md` UX-707..713 — the
  freeze-time read-only pin, UX-701, retires) and gets the SAME mounted-but-hidden treatment as the
  Behavior graph tab, once opened — its Monaco buffer and edit-mode state are exactly the kind of
  per-tab local state `UX-103`'s own worked example already calls out ("script divergence state").
  Unlike the Behavior graph tab, the Script tab is additionally never mounted AT ALL until its first
  open (`BottomDock`'s `scriptEverOpened` gate) — `packages/script-panel` pulls in Monaco and (via a
  Worker) `@gltfi/parse-ts`'s ts-morph dependency, both too heavy to load at app boot on the chance a
  session never opens the tab; `packages/app/src/bundle-chunks.test.ts` asserts ts-morph never lands
  in the built app's main entry chunk.
  Follow-up (user-reported bug, "Script tab has no scripts or text is clamped"): `ScriptTabPanel.tsx`
  renders its own root as `<div className="script-tab-wrap">`, but `app.css` never actually had a
  `.script-tab-wrap` rule — a plain unstyled block element defaults to `height: auto` (shrink-to-fit
  its content). `script-panel.css`'s `.script-panel` (the real `<ScriptPanel>`'s own root, direct
  child of `.script-tab-wrap`) specifies `height: 100%`, which CSS resolves as `auto` — i.e. ignored
  — against an auto-height containing block (CSS2.1 §10.5), so `.script-panel` itself collapsed to
  its own content height (one toolbar row plus a sliver) regardless of the dock's actual height.
  That starved `.script-editor-wrap`'s flex-basis down to a few px, and Monaco's own
  `automaticLayout: true` faithfully rendered THAT correctly-measured few-px container — hence the
  reported symptom (only the very top of line 1 ever visible, a large blank area below, unaffected
  by dock-resize or tab-switch-away-and-back). `.graph-panel-wrap` (the Behavior graph tab's
  equivalent root, directly styled with `display: flex; flex-direction: column; height: 100%;
  min-height: 0;`) never had this gap, which is why only the newer Script tab hit it. Fixed by
  giving `.script-tab-wrap` the identical flex-column treatment in `app.css`, plus an explicit
  `flex: 1 1 auto; min-height: 0;` override on `.script-tab-wrap > .script-panel` (needed only once
  the optional multi-graph selector row, `.script-tab-toolbar`, is a sibling — see `app.css`'s
  comment for why `.script-panel`'s own `height: 100%` isn't sufficient as a flex-item basis in that
  case). Verified by screenshotting the built app (not dev server) at default and resized dock
  heights, both themes, and after a tab-switch-away-and-back — see `e2e/script.spec.ts`'s new visual
  assertions. The same audit (auditing every dock tab for this "hidden-mount measures 0" bug class)
  also found and fixed a related but distinct bug in the Behavior graph tab's `fitView` — see
  `specs/ux-graph-canvas.md`'s own bug-fix note, since that fix lives entirely in
  `packages/graph-canvas` (this file only owns the dock-tab wiring in `packages/app`, not the canvas
  package itself). The Audio graph, Console, and Data tabs were audited too and are NOT susceptible
  — `BottomDock.tsx` only gives the mounted-but-hidden treatment to the Behavior graph and Script
  tabs (per `UX-103`'s stateful-tab rationale above); the other three fully unmount/remount on every
  tab switch, so they never have a stale hidden-at-first-layout measurement to inherit.

- M7 (audio, `packages/app/src/App.tsx`, `Viewport.tsx`, `store/app-store.ts`, `components/inspector/AudioSection.tsx`, `components/dock/{BottomDock,AudioGraphTabPanel}.tsx`): the app store gains an `audioHost?: AudioHost` field and a `registerAudioHost()` action (registration side only — routing play-mode's `SceneAdapter.applyPointer -> renderHost ‖ audioHost` fan-out per PC-001 is `packages/play`'s concern, not this file's); `App.tsx` constructs a fresh `@gltf-studio/audio-webaudio` `WebAudioHost` per document and registers it — unconditionally ("emitters host always"), never gesture-gated itself, since `loadEmitters` never creates an `AudioContext` (only `init()` does, specs/engine-api.md AH-001). The Inspector's Audition control (`specs/ux-inspector.md` UX-406) becomes real: its own `onClick` is the first user gesture that calls `audioHost.init()`. The bottom dock's Audio graph tab (previously a placeholder) is now `AudioGraphTabPanel`, owning one `@gltf-studio/audio-graph` `AudioGraphJsHost` per document and rendering `@gltf-studio/audio-canvas`'s `<AudioGraphCanvas>` (`specs/ux-audio-graph.md`) — it keeps its own LOCAL node-selection state rather than reusing the store's `selectedGraphNodeIndex`, which is the behavior-graph canvas's own field (a second, independent canvas must not fight over one shared selection slot). `Viewport.tsx` gained a polled `audioHost.setListenerPose(...)` stopgap for `AudioHost.setListenerPose`'s intended "fed from the viewport camera per-frame ONLY while playing" behavior — the play-state flag that requirement is meant to gate on (`packages/play`) did not exist in this checkout yet, so the poll currently runs any time a document is loaded, not only during play; revisit once that flag lands. Follow-up (same day): the poll started life as a `requestAnimationFrame` loop (60 wakeups/sec, for the lifetime of every mounted `Viewport`) and measurably starved an unrelated, pre-existing, already timing-marginal e2e test (`e2e/graph-canvas.spec.ts:67`) under CI's tighter resource envelope by competing with React's own paint scheduling — switched to a 10Hz `setInterval` (a timer macrotask doesn't compete for the same per-frame budget, and spatial audio has no need for 60Hz listener updates regardless). Follow-up (audio-host-keying fix): the per-document `WebAudioHost`-construction effect described above was actually keyed on `EditorDocument` object identity, which `HistoryStack.freeze()`/`unfreeze()` (DOC-031/DOC-045, play-mode start/stop) swap for a new object even though `json`/`container`/`rev` are unchanged — so entering play mode silently disposed and recreated the host (and any `AudioContext` a pre-play Audition gesture, `specs/ux-inspector.md` UX-406, had already created on it, losing it to AH-001's gesture-gating). Fixed by keying the effect on the store's `HistoryStack` instance instead (stable for the life of one project, same pattern `Viewport.tsx` already used for `RenderHost`), reloading emitters via `HistoryStack.onApply` (DOC-040, real edits only) rather than on every `EditorDocument` reference change — `packages/app/src/lib/audio-host-lifecycle.ts`.

- M8 (Copilot phase 2, `packages/app/src/components/copilot/Copilot.tsx`, `store/app-store.ts`,
  `components/ContextMenu.tsx`): the Copilot tab (previously a placeholder) is now real, per
  `specs/ux-copilot.md`'s `UX-10xx` — `UX-108`'s own "Copilot-originated entries render as plain
  history-entry rows" is now exercisable, since `acceptCopilotProposal` actually pushes one
  `Copilot: <summary>`-labeled `HistoryStack` entry per accepted proposal. A new generic
  `<ContextMenu>` component backs `specs/ux-scene-tree.md`'s `UX-207`/`UX-208` right-click menu on
  both the scene-tree row and the viewport object (`Viewport.tsx`'s existing `pick()` raycast, reused
  for a right-click instead of a left-click). "Try in play" (`specs/ux-copilot.md` `UX-1007`)
  deliberately does NOT reuse this file's own `UX-106`/`UX-107` play-state chrome (see
  `store/app-store.ts`'s `startTryInPlay` doc comment for the full reasoning) — it renders its own
  small, distinct "Previewing Copilot proposal" strip in the viewport instead, so as not to
  misrepresent a non-committal preview as the document being locked.

- Checkpoint (`UX-114`, `Viewport.tsx`, `packages/app/scripts/copy-sample.mjs`, root
  `scripts/make-sample.mjs`): a "Load sample scene" button added to the viewport's existing
  empty-project placeholder, so a first-time session has one click to a fully-populated document
  exercising every shipped feature (behavior graph, script, audio, play, Copilot) without needing a
  local .glb on hand. The asset itself (`samples/playground.glb`) is a generated, committed build
  artifact — never hand-authored — of `scripts/make-sample.mjs`, which also verifies its embedded
  `KHR_interactivity` graph both structurally (`@gltfi/verify`) and behaviorally (a headless
  `@gltfi/runtime` run) before ever writing the file. `copy-sample.mjs` copies it into
  `packages/app/public/` at `predev`/`prebuild` (gitignored there, same convention as
  `bundle-runtime-lib.mjs`'s `gltfi-runtime-lib.mjs`) so it's served as a static asset — never
  pulled into the main JS bundle — and resolves correctly under a non-root `base` (GitHub Pages)
  via `import.meta.env.BASE_URL` rather than a hardcoded `"/"`. See `e2e/golden-path.spec.ts`.

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
