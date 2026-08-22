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

**Deploy URL restructure (project-landing checkpoint, no new `UX-###`s — a build/hosting change,
not a shell-behavior one):** the app itself no longer occupies the Pages root. A hand-written
static landing page (`/site/index.html`, outside `packages/app` entirely — plain HTML/CSS, no
build step of its own) now serves from `https://rudybear.github.io/gltf-studio/`, and the editor
this file specifies moves one level down, to `.../gltf-studio/app/`. `packages/app/vite.config.ts`'s
`base` therefore defaults to `/app/` (previously `/`) for local dev/preview/e2e — matching where
the editor actually lives even outside of Pages — with `BASE_PATH` still available to override it
for the deploy build's deeper `/<repo>/app/` path (`.github/workflows/deploy.yml`, which now also
assembles the landing page and `docs/media/` screenshots into the same deployed artifact
alongside the built app). `packages/app/index.html`'s import map (the compiled-engine play path's
`@gltfi/runtime-lib` resolution — see that file's own comment) uses Vite's `%BASE_URL%` HTML env
replacement rather than a hardcoded `/`, since a raw `<script type="importmap">` body is static
text Vite does not rewrite as an asset reference the way it does a `<script src>`. `playwright.config.ts`'s
`baseURL` and every e2e spec's `page.goto(...)` call were updated to match (`"./"` rather than
`"/"`, so Playwright's URL-combining rules append to `baseURL`'s own `/app/` path instead of
replacing it) — the full e2e suite runs against this `/app/` path now, the same shape production
actually serves, rather than an untested root path.

**DX: tsconfig strict inheritance + shipped source maps (external feedback, no new `UX-###`s — a
build/debuggability change, not a shell-behavior one):** `packages/app/vite.config.ts` now sets
`build.sourcemap: true` (plus `rollup-plugin-sourcemaps2`, chaining the workspace packages' own
`tsc -b`-emitted `.js.map`s through to the app bundle) so the built/deployed app is steppable in
devtools instead of shipping one-lined minified JS with no map at all. Unrelated to this file's own
UX-1xx surface, but `packages/app/**` is this spec's ownership catch-all
(`specs/ownership.json`), and root `tsconfig.json` now `extends: "./tsconfig.base.json"` so
`strict` (and the rest of the base options) resolve correctly for files outside any package
(`e2e/**`, `playwright.config.ts`, `vitest.config.ts`) too — see the README's "Debugging" section
and `scripts/check-tsconfig-strict.mjs` for the regression guard.

Prefix: `UX`. This file owns the `UX-1xx` block (`UX-100`..`UX-1xx`); each other `ux-*.md` file
owns its own hundred-block (`UX-200` scene tree, `UX-300` viewport, `UX-400` inspector, `UX-500`
graph canvas, `UX-600` audio graph, `UX-700` script, `UX-800` data tab, `UX-900` pointer picker,
`UX-1000` Copilot, `UX-1100` usage mapping, `UX-1200` tour) per `docs/ux/README.md`'s freeze
process.

## Requirements

### Layout regions

- [UX-100] (active) The workspace is four regions: a left panel (scene tree over an asset browser), a center column (viewport over a bottom dock), a right panel (Inspector/Copilot tabs), and a top bar spanning the full window width above all three; a play-state locked banner appears between the top bar and the workspace only while play mode is active or paused.
- [UX-101] (active) The left and right panels and the bottom dock are each independently resizable via a drag handle on their shared edge (left panel: right edge; right panel: left edge; bottom dock: top edge); dragging live-resizes the region with no separate commit step.
- [UX-102] (active) Panel resize is clamped: left panel width to `[190px, 480px]` (default `260px`), right panel width to `[220px, 480px]` (default `300px`), bottom dock height to `[140px, 70vh]` (default `300px`); a drag cannot move a region's size outside its own bound regardless of drag distance.

### Bottom dock

- [UX-103] (active) The bottom dock has exactly six tabs — Behavior graph, Audio graph, Script, Audio script, Console, Data (glTF) — with exactly one active/visible at a time; switching tabs does not reset the state of the tab being left (e.g. graph canvas scroll position, script divergence state). The Audio script tab (`specs/ux-audio-script.md` `UX-1400`) was added after the original five-tab count and given the SAME mounted-but-hidden treatment as the Script tab it sits beside, for the same "Monaco buffer/edit-mode state must survive a tab-away-and-back" reason.

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

- [UX-114] (retired) Superseded by UX-119: the single "Load sample scene" button no longer holds — the empty-project state now shows a two-card starter gallery instead of one button.

### Multi-file import (fix: `.gltf` + external references)

- [UX-115] (active) The top bar's Import control (`topbar.import`/`topbar.import-input`) accepts a multi-file selection (the file input allows selecting more than one file) or a drag-and-drop file set dropped onto the `topbar.import` button, in addition to a single `.glb`: when a `.gltf` is among the chosen files, every external reference it makes (`buffers[].uri`, `images[].uri`, `KHR_audio_emitter.audio[].uri` — `data:` URIs are already self-contained and untouched) is resolved against the OTHER chosen files and packed into one self-contained GLB before import, so the resulting document never points outside itself and export (`UX-112`) always writes one coherent `.glb`. `UX-118` adds two more ways of assembling that same "chosen files" set — a `showOpenFilePicker` multi-select and a dropped folder's full contents — both of which still funnel through this same resolve-and-pack behavior.
- [UX-116] (active) A `.gltf` chosen without every external file it references fails the import outright — a toast (`UX-109`) names every missing filename (e.g. "select scene.bin, scene.wav together with scene.gltf") — and leaves whatever document was already open completely unchanged; the viewport never silently ends up empty or partially loaded. `UX-117` additionally opens a recovery dialog on this same failure rather than being a dead end.
- [UX-117] (active) (fix: user-reported "when I load drum-kit — it doesn't see the files in the same folder" — a plain `<input type="file">` pick genuinely cannot read a picked file's sibling files for security reasons, so a single `.gltf` chosen alone can never auto-resolve its own directory on its own) `UX-116`'s failure additionally opens a missing-files dialog (`missing-files.dialog`), naming every unresolved filename (`missing-files.list`) and explaining, in one sentence, exactly what to do next. When `window.showDirectoryPicker` is available (feature-detected; Chrome/Edge as of this writing), the dialog's PRIMARY action is `missing-files.grant-folder` ("Grant folder access…"): choosing the folder the `.gltf` lives in resolves every missing reference against that directory's contents (recursively, so a `textures/` subfolder still resolves) and completes the same pack-and-import path `UX-115` already uses, with no need to reselect anything already provided. When unsupported, that button is omitted entirely and the dialog's copy instead explains reselecting/dragging every named file together (`UX-115`'s existing paths). `missing-files.cancel`/`missing-files.close-x`/backdrop-click/Escape close the dialog without importing anything, leaving the current document (if any) exactly as `UX-116` already guarantees; granting a folder that still doesn't have everything updates the missing list in place rather than closing the dialog or failing outright.
- [UX-118] (active) Two more ways to build `UX-115`'s "chosen files" set, both aimed at the same bug report as `UX-117` — getting the user to a working import with as few manual steps as possible: (1) when `window.showOpenFilePicker` is available, clicking `topbar.import` uses it (a native multi-select dialog) instead of the hidden `topbar.import-input`, falling back to the `<input>` automatically when unsupported or if the picker throws for a reason other than the user cancelling it — this still can't grant directory access on its own, so a single `.gltf` picked this way with unresolved references still surfaces `UX-117`'s dialog; (2) dropping an entire FOLDER — onto `topbar.import`, or anywhere else on the window — walks its full contents via `DataTransferItem.webkitGetAsEntry()`'s directory-entry traversal and imports every file found exactly as a multi-select would, resolving `UX-115` in one step with no follow-up dialog at all when every reference is satisfied within the dropped folder — the true "it just sees the files" flow.

### Starter gallery (supersedes the checkpoint's single sample button)

- [UX-119] (retired) Superseded by UX-120: the "Playground" card is retired from the starter gallery (user feedback: it made a confusing first-run default) and replaced by an "Empty scene" card; R4 Racer is unchanged.

- [UX-120] (active) Supersedes UX-119: the viewport's empty-project state (`UX-3xx`'s "no document open" placeholder) shows a starter-experience gallery (`viewport.gallery`) of cards instead of a single button, alongside the existing "Import a .glb to get started" note. There are exactly two cards, each with a small static preview, a short one-sentence description, and a Load control. The FIRST card is Empty scene (`viewport.gallery.card.empty`, card copy "Empty scene — start from scratch; use + Add to build."): clicking its Load control builds a minimal document entirely in memory — an `asset` header plus one default scene with ZERO nodes, no fetch involved (`packages/app/src/lib/empty-scene.ts`'s `buildEmptySceneGlb`, a real `.glb` produced via `@gltfi/gltf`'s own `writeContainer`) — then imports those bytes through the exact same path a manually-picked file would (`importGlb`), so the result is a real, storage-persisted, undo-historied project from the first tick, not a special-cased blank-slate mode. The SECOND card, R4 Racer (`viewport.gallery.card.racer`, `samples/r4-racer.glb`, described in-card as "a complete racing game authored as TypeScript, compiled into the asset; click the pads to steer"), is unchanged from `UX-119`: clicking its Load control fetches that card's asset as a static file this app's own build serves and imports it the same way. A failed R4 Racer fetch surfaces a toast (`UX-109`) naming the card's label, rather than a silent no-op. Card testids use a semantic `<key>` (`empty`/`racer`), not a numeric index — the same non-numeric-but-repeated-part pattern `UX-110`'s own convention note permits and `specs/ux-viewport.md`'s play-overlay variable rows (`viewport.play-overlay.variable.<key>`) already establish. Zero-node tolerance (verified for the Empty scene card, and true generally of every surface that reads `document.json`): the scene tree shows a dedicated empty note (`scene-tree.empty-scene`, `specs/ux-scene-tree.md`'s owned surface — distinct from the no-document `scene-tree.empty`) instead of a bare blank list; the viewport renders its usual chrome with no geometry and no crash (`buildRenderScene`'s existing `!json.meshes` short-circuit already covered this); the Behavior graph tab shows `specs/ux-script.md` `UX-714`'s existing no-graph empty state, since the empty scene carries no `KHR_interactivity` extension at all; and both the scene tree's `+ Add` (creates the document's first node immediately — `SceneEdit.addNode`'s existing missing-array-creation fallback needed no changes) and Export (`UX-112`, a real, valid, zero-node `.glb`) work with no special-casing anywhere. `samples/playground.glb` and `scripts/make-sample.mjs` (the retired card's asset) are kept as a test-only fixture, not shipped in the built app: `e2e/golden-path.spec.ts` loads it directly through the top bar's Import control (`topbar.import-input`) instead of a gallery card, and `copy-sample.mjs` no longer copies it into `packages/app/public/`.

### Tour entry point

- [UX-121] (active) The top bar exposes a tutorial/tour entry point (`topbar.tour-start`) distinct from `UX-111`'s `?` testid-overlay toggle — its own icon/glyph, placed in the same trailing `topbar-group` — that launches the coach-marks tutorial tour specified in full by `specs/ux-tour.md`'s `UX-12xx` block; this file only pins down that the control exists in the top bar, not the tour's own content or behavior once running.

### Project manager (persistence & sharing)

- [UX-122] (active) The top bar exposes a `topbar.projects` entry point that opens the project-manager dialog (`project-manager.dialog`), listing every project `StorageProvider.listProjects()` returns (`specs/storage-provider.md` SP-022's `updatedAt`-descending order — the same order backs an "open recent" reading of the list, with no separate control needed) as rows (`project-manager.row.<index>`) showing the project's name, a relative "updated" timestamp, and its thumbnail (`project-manager.row.<index>.thumbnail`, `ProjectMeta.thumbnail` per `SP-011`; a placeholder swatch when absent — a project autosaved before any renderable frame existed, or one whose viewport never mounted). Each row exposes Open (`project-manager.row.<index>.open` — loads that project per `UX-125`'s recovery check, then closes the dialog), Rename (`project-manager.row.<index>.rename`, an inline text field committed on Enter/blur, cancelled on Escape — updates `ProjectMeta.name` via `save()` and, when the row IS the open project, the top bar's own `topbar.project-name`), Duplicate (`project-manager.row.<index>.duplicate` — `create()`s a new project named "`<name>` copy" with the same `container`/`sidecar`, leaving the original untouched, and appends it to the list), and Delete (`project-manager.row.<index>.delete`, gated behind a confirm step — `project-manager.delete-confirm` names the project and offers `.confirm`/`.cancel` — before calling `StorageProvider.delete()`, SP-021). A `project-manager.new` control builds a fresh empty scene (`UX-120`'s own `buildEmptySceneGlb`, the identical starter every "Empty scene" gallery card click already produces — no second empty-project code path) and opens it as the current project. Zero saved projects shows a dedicated empty state (`project-manager.empty`) instead of a bare empty list, with its own `project-manager.new`-equivalent call to action. `project-manager.close-x`/backdrop-click/Escape close the dialog without side effects beyond whatever row actions were already explicitly taken.

### Autosave status (persistence & sharing)

- [UX-123] (active) The top bar shows a save-status indicator (`topbar.save-status`) next to `topbar.project-name` (superseding that element's own bare `*`-suffix dirty marker) reading exactly one of "Saved", "Saving…", or "Unsaved changes": a dispatched command, an accepted Copilot proposal, or an undo/redo (`UX-128`) immediately flips it to "Unsaved changes" (and appends the applied forward-direction patches to `StorageProvider.autosaveJournal` right away, per `SP-004`/`SP-014`, so a crash before the debounce below fires still has a durable journal to recover from) and schedules a debounced full checkpoint — after 1.5s with no further edit, the indicator reads "Saving…" while `StorageProvider.save(id, data)` writes the current container/sidecar (clearing the journal per `SP-016`), then "Saved" once it resolves; a save that fails (`StorageError`, e.g. `"quota-exceeded"`) leaves the indicator on "Unsaved changes" and surfaces a toast (`UX-109`) naming the failure rather than silently claiming success. No document open shows no indicator at all (same visibility rule as `topbar.export`'s disabled state — nothing to save yet).
- [UX-124] (active) A `save()` triggered by `UX-123`'s debounce additionally best-effort captures a viewport thumbnail (`RenderHost.snapshot()`, `specs/render-host.md` RH-024) and writes it as the project's `ProjectMeta.thumbnail` when a `RenderHost` is registered and its snapshot resolves; a missing `RenderHost` (no viewport mounted yet) or a rejected snapshot leaves the project's existing thumbnail (if any) untouched rather than failing the save itself.

### Crash recovery (persistence & sharing)

- [UX-125] (active) Opening a project (from `UX-122`'s project manager, or the automatic reopen of the last-open project on a fresh app load — the project's id is remembered in `localStorage`, a plain UI convenience distinct from any `StorageProvider`-governed state) first calls `StorageProvider.loadJournal(id)` (`SP-015`); an empty `patches` array opens the project immediately with no prompt (the ordinary case — the prior session's last debounced save, `UX-123`, already consolidated everything). A non-empty `patches` array — the prior session ended (crash, closed tab, etc.) after `UX-123`'s immediate journal append but before its debounced full save consolidated it — instead opens the project at its last-saved (`load(id)`) state and shows a non-blocking recovery prompt (`recovery.dialog`, naming the project) offering `recovery.recover` (replays the journal's patches, per `SP-015`'s replay definition, on top of the loaded document, marks the result "Unsaved changes" so `UX-123`'s own debounce consolidates it on the next edit-idle window) and `recovery.discard` (keeps the last-saved state as-is and immediately calls `save()` with that same, unchanged data so `SP-016` clears the stale journal — without this, reopening the same project again would re-offer the same recovery prompt indefinitely for patches the user already declined).

### Sharing (persistence & sharing)

- [UX-126] (active) A top-bar `topbar.share` control (enabled whenever a document is open, mirroring `topbar.export`'s own gating) opens a share dialog (`share.dialog`) offering two independent things, both derived from the exact same bytes `UX-112`'s Export already produces (`editor-core`'s byte-preserving `save()`): (1) `share.download`, identical to clicking `topbar.export`; (2) a link that reopens the editor with this asset pre-loaded, built by gzip-compressing those bytes (`CompressionStream("gzip")`) and placing the result, base64url-encoded, in the URL fragment as `#share=<data>` — chosen over a query parameter so the payload is never sent to any server (moot for a static host today, but keeps the mechanism honest as one) and over server-side storage, since there is no backend (`specs/storage-provider.md`'s `remote` capability is future work, not this). Fragment links only stay practical up to a size limit — a few hundred KB gzipped (`share.ts`'s `SHARE_LINK_MAX_GZIPPED_BYTES`, 300,000 bytes) — so the dialog checks the compressed size before building one: under the limit, `share.copy-link` copies the full URL to the clipboard (confirmed via a toast, `UX-109`) and the link is also shown read-only (`share.link-output`) for manual copying; at or over the limit, no link is offered at all — `share.too-large-note` explains, in one sentence, that this asset is too large for a link and to use the download instead, with `share.download` remaining the only (and clearly signposted) way to share it. This is explicitly a stopgap, not real link-shortening: a proper server-backed short link (arbitrary size, a stable short id instead of the asset re-encoded into the URL itself) is future/backend work, same bucket as `StorageProvider`'s planned HTTP implementation.
- [UX-127] (active) On app load, a URL carrying `#share=<data>` (`UX-126`) is decompressed and imported as a new project through the exact same `importFiles`/`importGlb` path a manually-picked file would use (so it is a real, storage-persisted, undo-historied project from the first tick, matching `UX-120`'s own "not a special-cased mode" precedent) — this takes priority over `UX-125`'s last-open-project reopen when both would otherwise apply, since following an explicit share link is the more specific user intent. The fragment is stripped from the URL (`history.replaceState`) immediately after a successful import so reloading the resulting session afterward behaves like any other open project, not a repeated share-import. A share fragment that fails to decode/decompress (corrupted or truncated link) surfaces a toast (`UX-109`) naming the failure and otherwise leaves the app at its normal empty/gallery start, rather than a blank or crashed shell.

### Journal-consistent undo/redo (task #36)

- [UX-128] (active) Closes a gap `UX-123`/`UX-125` had left standing since they were introduced (PR #40): `store/app-store.ts`'s `undo()`/`redo()` actions changed `history.document` exactly like `dispatchCommand`/`acceptCopilotProposal` do, but — unlike those two — never appended anything to `StorageProvider.autosaveJournal`, so `SP-015`'s journal replay could reproduce a forward edit but not an undo/redo. Concretely: edit, then undo, then crash strictly between the undo and `UX-123`'s 1.5s debounced checkpoint — `UX-125`'s recovery prompt replayed the journal (edit only, since undo was invisible to it) and silently landed back on the PRE-undo state, undoing the user's own undo out from under them. Fixed with `specs/document-model.md`'s `DOC-061`: `HistoryStack.undo()`/`redo()` now return the exact forward-direction patches they applied, which `undo()`/`redo()` append to the journal the same way `dispatchCommand` already appends a pushed command's own `patches` — one call, `storage.autosaveJournal(projectId, journalSinceRev, patches)`, same fire-and-forget error handling (a failed journal write logs via `log("error", ...)` but never blocks the UI, matching every other autosave call site). No new debounce tier and no `UX-123` full-checkpoint change were needed — the existing debounced checkpoint already correctly captures `history.document` after an undo/redo regardless of the journal; this fix is purely about closing the gap for the crash window BEFORE that checkpoint fires. `e2e/crash-recovery.spec.ts`'s "recovering from a crash strictly between an undo and the next checkpoint" test is the end-to-end regression guard: edit, wait for the journal write to land, undo, wait for ITS journal write to land, reload before the debounce, Recover — asserts the restored state is the POST-undo value, not the pre-undo edit.

### Settings entry point (docs/adr/0005)

- [UX-129] (active) The top bar exposes a settings entry point (`topbar.settings`) — a gear icon, own `topbar-group` placement alongside `topbar.theme-toggle`/`topbar.testid-toggle`/`topbar.tour-start` — that opens the settings dialog specified in full by `specs/ux-settings.md`'s `UX-13xx` block; this file only pins down that the control exists in the top bar, following the same "entry point here, content in the owning file" split `UX-121` uses for the tour. The dialog's content itself (including its model-recommendation hint, `UX-1306`, and its CORS help text's concrete `OLLAMA_ORIGINS` example, `UX-1305`) is `specs/ux-settings.md`'s to own, per that same split — this entry only notes that a real-model validation pass (see `specs/agent-service.md` `AG-023`'s implementation note) is what informed that content.

### Debugger entry point (D1, docs/adr/0006)

- [UX-130] (active) The play-bar exposes a Debug toggle (`playbar.debug-toggle`), placed beside `UX-113`'s `playbar.engine-picker`, following the same "entry point here, content in the owning file" split `UX-121`/`UX-129` use for the tour/settings: this file only pins down that the control exists in the play bar, is enabled only while `playbar.engine-picker`'s current selection is `"compiled"` (disabled — with a tooltip explaining why — for `"interpreter"`, and while `playState !== "stopped"`, matching `playbar.engine-picker`'s own disabled-while-not-stopped rule), and that its checked state is passed as `PlayStartOptions.debug` (`PC-009`) the next time Play starts. The toggle's own on/off state persists only for the life of the current app session (same persistence tier as `UX-111`'s `topbar.testid-toggle` — an in-memory store field, not `localStorage` or a per-project setting) — reloading the app or opening a different project does not remember it. The toggle's full behavior contract while debug play is actually running (the play-overlay hint, the virtual-file naming, the text-identity guarantee) is `specs/ux-debugger.md`'s `UX-1500` block to own, per that same split.

## Implementation notes

- Clip management + source/emitter lifecycle (Track A audio task — the substance lives in
  `specs/document-model.md`'s `DOC-066`, `specs/ux-inspector.md`'s `UX-425`..`428`, and
  `specs/ux-scene-tree.md`'s `UX-218`..`222`; this file's own `packages/app/**` catch-all is what
  makes touching `AssetBrowser.tsx`/`AudioSection.tsx`/`AudioEnvironmentSection.tsx`/`Inspector.tsx`/
  `SceneTree.tsx`/`App.tsx`/`app-store.ts`/the new `AudioClipsPanel.tsx`/`lib/audio-file-resolve.ts`/
  `lib/audio-clip-bytes.ts`/`lib/audio-clip-preview.ts` also a `specs/ux-shell.md` change): a new
  session-only `audioFolderHandle` store field + `grantAudioFolder` action (DOC-030: ephemeral,
  never persisted, distinct from `UX-117`'s one-time import-fixup folder grant) backs live
  referenced-clip resolution; no `UX-1xx`-owned shell requirement itself changed.
- D2 script debugger (specs/ux-debugger.md UX-1505..UX-1508): `app-store.ts` gained `scriptBreakpoints`/
  `audioScriptBreakpoints`/`playDebugBreakpointCount` state and `toggleScriptBreakpoint`/
  `setScriptBreakpoint`/`breakHereOnNode`/`toggleAudioScriptBreakpoint` actions, and
  `BehaviorGraphPanel.tsx`/`ScriptTabPanel.tsx`/`AudioScriptTabPanel.tsx`/`PlayOverlay.tsx` wired them
  into the Script tab's gutter, the Behavior graph canvas's breakpoint badge/"Break here" action, and
  the play overlay's breakpoint-count row — all under this file's `packages/app/**` catch-all
  ownership, but the substance is `specs/ux-debugger.md`'s `UX-1505` block, not a shell-level change;
  noted here only to satisfy this repo's ownership-drift check, per `OPEN(P0-nospec-label-tbd)`'s
  documented workaround (same pattern the r2 audio-graph migration note below already establishes).
- r2 audio-graph migration: `packages/app/src/components/inspector/AudioSection.tsx` (the Audio
  Emitter inspector section, `specs/ux-inspector.md` `UX-406`/`UX-419`/`UX-420`) gained a Source Type
  (Clip/Oscillator) toggle per Sources sub-list row and `packages/app/src/lib/gltf-scene.ts` gained
  the corresponding `GltfAudioSourceOscillatorJson` type — both under this file's `packages/app/**`
  catch-all ownership, but the substance (r2's oscillator-as-source-data shape) is
  `specs/ux-inspector.md`'s `UX-424` and `specs/ux-audio-graph.md`'s r2 updates, not a shell-level
  change; noted here only to satisfy this repo's ownership-drift check for the `packages/app/**`
  path, per `OPEN(P0-nospec-label-tbd)`'s documented workaround.
- r2 code-review follow-up: `AudioSection.tsx`'s Clip/Oscillator toggle helpers (`toOscillatorSource`/
  `toClipSource`) were rewritten to preserve `extras`/other un-modeled source fields across the
  toggle (a from-scratch object literal was silently dropping the canvas's synthetic source-terminal
  position, `specs/ux-audio-graph.md`'s `UX-617`) and to not fabricate an invalid clip binding when
  switching to Clip mode on a document with zero audio clips; a new `AudioSection.test.ts` covers both
  regressions directly. Same `packages/app/**` ownership-drift note as above, no shell-level change.
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
  tabs (per `UX-103`'s stateful-tab rationale above; the Audio script tab, added later, gets the same
  treatment for the same reason — see `specs/ux-audio-script.md`'s own `UX-1408`); the other three
  fully unmount/remount on every tab switch, so they never have a stale hidden-at-first-layout
  measurement to inherit.

- M7 (audio, `packages/app/src/App.tsx`, `Viewport.tsx`, `store/app-store.ts`, `components/inspector/AudioSection.tsx`, `components/dock/{BottomDock,AudioGraphTabPanel}.tsx`): the app store gains an `audioHost?: AudioHost` field and a `registerAudioHost()` action (registration side only — routing play-mode's `SceneAdapter.applyPointer -> renderHost ‖ audioHost` fan-out per PC-001 is `packages/play`'s concern, not this file's); `App.tsx` constructs a fresh `@gltf-studio/audio-webaudio` `WebAudioHost` per document and registers it — unconditionally ("emitters host always"), never gesture-gated itself, since `loadEmitters` never creates an `AudioContext` (only `init()` does, specs/engine-api.md AH-001). The Inspector's Audition control (`specs/ux-inspector.md` UX-406) becomes real: its own `onClick` is the first user gesture that calls `audioHost.init()`. The bottom dock's Audio graph tab (previously a placeholder) is now `AudioGraphTabPanel`, owning one `@gltf-studio/audio-graph` `AudioGraphJsHost` per document and rendering `@gltf-studio/audio-canvas`'s `<AudioGraphCanvas>` (`specs/ux-audio-graph.md`) — it keeps its own LOCAL node-selection state rather than reusing the store's `selectedGraphNodeIndex`, which is the behavior-graph canvas's own field (a second, independent canvas must not fight over one shared selection slot). `Viewport.tsx` gained a polled `audioHost.setListenerPose(...)` stopgap for `AudioHost.setListenerPose`'s intended "fed from the viewport camera per-frame ONLY while playing" behavior — the play-state flag that requirement is meant to gate on (`packages/play`) did not exist in this checkout yet, so the poll currently runs any time a document is loaded, not only during play; revisit once that flag lands. Follow-up (same day): the poll started life as a `requestAnimationFrame` loop (60 wakeups/sec, for the lifetime of every mounted `Viewport`) and measurably starved an unrelated, pre-existing, already timing-marginal e2e test (`e2e/graph-canvas.spec.ts:67`) under CI's tighter resource envelope by competing with React's own paint scheduling — switched to a 10Hz `setInterval` (a timer macrotask doesn't compete for the same per-frame budget, and spatial audio has no need for 60Hz listener updates regardless). Follow-up (audio-host-keying fix): the per-document `WebAudioHost`-construction effect described above was actually keyed on `EditorDocument` object identity, which `HistoryStack.freeze()`/`unfreeze()` (DOC-031/DOC-045, play-mode start/stop) swap for a new object even though `json`/`container`/`rev` are unchanged — so entering play mode silently disposed and recreated the host (and any `AudioContext` a pre-play Audition gesture, `specs/ux-inspector.md` UX-406, had already created on it, losing it to AH-001's gesture-gating). Fixed by keying the effect on the store's `HistoryStack` instance instead (stable for the life of one project, same pattern `Viewport.tsx` already used for `RenderHost`), reloading emitters via `HistoryStack.onApply` (DOC-040, real edits only) rather than on every `EditorDocument` reference change — `packages/app/src/lib/audio-host-lifecycle.ts`. Follow-up (M7 audio-graph editing, `specs/ux-audio-graph.md` UX-608..614): `AudioGraphTabPanel` now also pulls `dispatchCommand` from the store (mirroring `BehaviorGraphPanel`'s own wiring) and passes it, plus its own `AudioGraphJsHost` instance, down to the now-editable `<AudioGraphCanvas>` — that component, not this thin dock-tab wrapper, is where every `AudioGraphEdit` command actually gets built (`packages/audio-canvas`'s own concern, per `specs/ux-audio-graph.md`'s implementation notes). `AudioGraphTabPanel` also gained a `window.__gltfStudioAudioGraphTest` test-only document-readback hook, the audio-graph tab's equivalent of `BehaviorGraphPanel`'s pre-existing `window.__gltfStudioGraphTest` — installed only while this (plain conditionally-mounted, not hidden-mounted like the Behavior graph/Script tabs) tab is actually active. Follow-up (M7 audio-graph gaps closed + deeper runtime, `specs/ux-audio-graph.md` `UX-617`): `AudioGraphTabPanel` now also passes `extensions.KHR_audio_emitter.sources` down to `<AudioGraphCanvas>` as a new `sources` prop (alongside the pre-existing `emitters` one) — needed so `map-audio-graph.ts` can carry a bound source's own `extras` through onto its synthetic `audio-buffer-source` terminal node, the same way it already did for `emitters`, so that terminal's persisted canvas position (`extras.gltfi`, written via `SceneEdit.setAudioSourceProperty`) actually renders.

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
- Follow-up (user-reported bug, "I can't select objects on the screen, only in the scene panel",
  `Viewport.tsx`, `packages/engine-three/src/render-host.ts`): `specs/ux-viewport.md`'s `UX-302`/
  `UX-303` (viewport click-to-select / empty-click-deselect) held under every existing e2e test yet
  didn't hold for real users, because `e2e/viewport.spec.ts`'s clicks — while genuine CDP mouse
  input at genuine screen coordinates — always pressed and released with zero intervening pointer
  movement (`page.mouse.click()`), something no real mouse or trackpad ever actually does.
  `OrbitControls` (the underlying camera control, `specs/render-host.md`) has no click-vs-drag
  threshold of its own: it starts rotating the camera on the very first `pointermove` after
  `pointerdown`, however small, so a real click's incidental few-pixel jitter had usually already
  rotated the camera by the time `pick()` ran, desyncing the ray from the pixel the object actually
  rendered at. Fixed by having `Viewport.tsx` disable `OrbitControls` (via the new
  `ThreeRenderHost.setControlsEnabled`, `specs/render-host.md`'s own DECISION note) on `pointerdown`
  and re-enable it only once movement crosses a small threshold (a real drag) — see that spec file
  for the full mechanism. `e2e/viewport-real-click.spec.ts` (new) covers `UX-301`/`UX-302`/`UX-303`
  with real mouse input against the actual DEFAULT camera (no `setCameraPose` test hook) on both the
  single-file and packed-multi-file import paths, plus dedicated jitter/deliberate-drag regression
  coverage for the mechanism itself — verified to fail on the pre-fix code and pass after.

- Follow-up (user-reported bug, "clicking the checkpoint pylons in the R4 Racer viewport does not
  select them", `Viewport.tsx`, `packages/engine-three/src/render-host.ts`):
  `specs/ux-viewport.md`'s `UX-302` (click-to-select) held for ordinary scenes but not for
  `samples/r4-racer.glb`'s checkpoint pylons, because `ThreeRenderHost.pick()` — reused by both
  EDIT-mode selection/hover and PLAY-mode's `onSelect`/`onHoverIn` injection (`PC-008`) —
  unconditionally requires `KHR_node_selectability`'s `selectable` to be `true`, a check that's
  correct for PLAY (scenery is deliberately non-interactive during the race) but wrong for EDIT
  (authoring must be able to select any visible node). Fixed by adding `pick()`'s
  `ignoreEligibility` option (`specs/render-host.md`'s `RH-027`), which `Viewport.tsx` now passes
  whenever `playState === "stopped"`; PLAY mode's own pick calls are unchanged. See
  `specs/ux-viewport.md`'s `UX-312` and `e2e/racer.spec.ts`'s edit-mode pylon-select/hover coverage
  plus its play-mode pylon-not-interactive regression check.

- Starter gallery (`UX-119`, `Viewport.tsx`, `SampleGalleryPreviews.tsx`,
  `packages/app/scripts/copy-sample.mjs`, `samples/r4-racer.glb`, `samples/README.md`): the
  checkpoint's single "Load sample scene" button becomes a two-card gallery, adding R4 Racer
  alongside Playground. Unlike `playground.glb`, `samples/r4-racer.glb` is NOT built by this
  repo's own tooling — it's a vendored, unmodified copy of the sibling
  `gltf-interactivity-game` repo's `dist/r4.glb` (26 scene nodes, a 366-node `KHR_interactivity`
  graph, 15 variables; that repo's own pipeline is its byte-reproducible source of truth — see
  `samples/README.md`'s provenance note). `copy-sample.mjs` now copies both assets into
  `packages/app/public/` at `predev`/`prebuild`, same gitignored-static-asset convention as
  before. Card previews (`SampleGalleryPreviews.tsx`) are small inline stylized SVGs rather than
  captured PNGs — no headless-capture build step, nothing to regenerate when an asset changes,
  and a negligible bundle cost. Card testids (`viewport.gallery.card.<key>[.preview|.load]`) use
  a semantic key rather than a numeric index (see UX-119's own note on this); the previous
  `viewport.load-sample` testid is retired along with `UX-114`. See `e2e/racer.spec.ts` for
  dedicated R4 Racer coverage (gallery card, scene tree, graph canvas at its real 366-node scale
  — including the layout-timing budget that scale required, see that file's own header comment —
  script-tab decompile, and play-mode pad interaction) and `e2e/golden-path.spec.ts`'s updated
  first step for the Playground card's continued coverage.

- Empty-scene starter (`UX-120`, supersedes `UX-119`; `Viewport.tsx`, `SampleGalleryPreviews.tsx`,
  `packages/app/src/lib/empty-scene.ts` (new), `SceneTree.tsx`, `packages/app/scripts/copy-sample.mjs`,
  `samples/README.md`, `e2e/golden-path.spec.ts`, `e2e/shell.spec.ts`, `e2e/racer.spec.ts`):
  user feedback — "remove playground — it's horrible, replace it by an empty scene instead" — the
  Playground checkpoint card, a fully-populated scene, made a confusing first-run default (a
  brand-new user's very first click landed them in someone else's finished project, not a blank
  canvas). Replaced with an Empty scene card in the SAME first gallery slot: `buildEmptySceneGlb`
  builds a real `.glb` in memory (asset header, one default scene, zero nodes) via `@gltfi/gltf`'s
  own `writeContainer` — the exact container shape `e2e/global-setup.ts`'s fixture-writing already
  uses — so it imports through the unmodified `importGlb` path with no new document-creation
  branch anywhere in the store. Every surface that reads `document.json` already tolerated a
  missing/empty `nodes` array defensively (`flattenSceneTree`'s `?? []`, `buildRenderScene`'s
  `!json.meshes` short-circuit, `appendFragment`/`setPathFragment`'s missing-ancestor creation) —
  confirmed by hand-tracing each path and by `e2e/shell.spec.ts`'s new empty-scene coverage, no
  crashes found — with exactly one small gap fixed: the scene tree's body used to fall through to
  a silent blank list for a real document with zero root nodes (only the separate "no document at
  all" case had its own note); it now shows a dedicated `scene-tree.empty-scene` note instead.
  `samples/playground.glb` is retired as a shipped asset (`copy-sample.mjs` no longer copies it
  into `packages/app/public/`) but kept as a committed e2e fixture — `scripts/make-sample.mjs`
  still regenerates/verifies it, and `e2e/golden-path.spec.ts`'s first step now loads it directly
  through `topbar.import-input` (a real file, read straight off disk by Playwright) instead of
  through a gallery card, since the card it used to click no longer exists. `e2e/shell.spec.ts`'s
  gallery test now asserts the Empty scene card's presence/copy and the Playground card's absence,
  plus a new test driving the empty-scene card end to end: load -> scene-tree empty state -> `+
  Add` a cube (works immediately, no special-casing) -> Export (a real, valid, zero-node `.glb`).

- M9 (usage mapping, `specs/ux-usage-mapping.md`'s `UX-11xx` — this file's own `packages/app/**`
  catch-all is what makes the following a `specs/ux-shell.md` change, not just a
  `specs/ux-usage-mapping.md` one, per that file's own "Owns" note): the Inspector gains a new
  `UsageSection.tsx` (`UX-1106..1109`), rendered unconditionally for every selected node (unlike
  Mesh/Material/Audio, which are gated on the node having that fact), built on the new
  `@gltf-studio/usage-index` package's `buildUsageIndex` — memoized via `useMemo` keyed on
  `document.json`'s own identity (`UX-1113`), the same convention `@gltf-studio/graph-canvas`'s
  `mapGraph` already established. Its "Attach behavior…" zero-state menu reuses the app-store's
  existing `addCopilotContextChip`/`requestCopilotComposerFocus` pair for its one real action —
  its zero-state menu is a stub in the same sense the add-menu's five entries were BEFORE the
  M8-lite change below made those real (`specs/ux-scene-tree.md`'s `UX-206`).
  Three new store fields back the → Graph / → Script jumps and the reverse reference highlight:
  `graphNodeFocusRequest` (a `frameRequest`-shaped cross-component signal `BehaviorGraphPanel.tsx`
  forwards to `@gltf-studio/graph-canvas`'s new `GraphCanvas`/`GraphView` `focusRequest` prop, per
  that package's own usage-mapping implementation note); `scriptNodeFocusRequest` (the same seq-
  bumped shape, `ScriptTabPanel.tsx` forwards it to `@gltf-studio/script-panel`'s `ScriptPanel`
  `focusRequest` prop — added once a bug report found the plain `selectedGraphNodeIndex`-only jump
  silently highlighted nothing for a `pointer/set`/`pointer/interpolate` usage row; see
  `specs/ux-usage-mapping.md`'s revised `UX-1108` and `specs/ux-script.md`'s own implementation note
  for why a durable, seq-bumped STORE field is needed here specifically — unlike the Behavior graph
  canvas, the Script tab is lazy-mounted and a fire-and-forget signal could be dropped before it
  exists to receive it); and a plain (non-reactive) `referenceHighlightSceneNodeIndex()` getter —
  same style as the pre-existing `historyEntries()` —
  that both `Viewport.tsx` and `SceneTree.tsx` independently `useMemo` (keyed on `document`,
  `selectedGraphNodeIndex`, `selectedGraphIndex`) to derive `UX-1110`'s amber reference-highlight
  target from the CURRENT Behavior-graph selection, via `@gltf-studio/usage-index`'s
  `graphNodeSceneRef`. `Viewport.tsx` forwards that index to the new `RenderHost.
  setReferenceHighlight` (`specs/render-host.md` `RH-029`/`RH-030`); `SceneTree.tsx` adds a
  `ref-highlighted` row class (new `--ref-soft` CSS variable, `app.css`, matching
  `docs/ux/mockups/mockup-v6.html`'s own `--ref-soft`). `UX-1112`'s clearing rules fall out of this
  design for free, with no dedicated clearing code: closing the graph-node details card (clicking
  the canvas's empty pane) sets `selectedGraphNodeIndex` back to `null` (already-existing
  behavior, `onPaneClick`), and switching graphs (`setSelectedGraphIndex`) already resets
  `selectedGraphNodeIndex` to `null` too (pre-existing, M4) — both make the getter return `null`
  with no new logic. "Reveal in viewport" (`UX-1111`) is `revealSceneNodeInViewport`, a thin action
  that reuses the pre-existing `requestFrame` cross-component signal (`UX-207`'s own mechanism) and
  adds a confirmation toast — see `specs/ux-usage-mapping.md`'s own `OPEN(UX-usage-reveal-flash-tbd)`
  for why this does not ALSO add a second, separate transient-pulse animation the approved mockup's
  mock renderer used in place of a real camera it didn't have.
  `UX-1114`'s disabled-state check (a `kind: "pointer"` row's → Script button, disabled with a
  tooltip when unreachable from any handler) lives directly in `UsageSection.tsx` as a plain,
  non-compiling JSON walk over the row's own graph (`@gltf-studio/usage-index`'s
  `findEnclosingHandlerRoot` — the identical function `jumpUsageRefToScript` uses server-side, so
  the enabled/disabled state and the jump's own disambiguation hint are one derivation, not two);
  it does not invoke `@gltfi/emit-ts` just to decide a button's state.

- M9 Phase 2 (usage mapping continued — ambient reference badges, live "Attach behavior…", `specs/ux-
  usage-mapping.md`'s `UX-1115..1118`, this file's own `packages/app/**` catch-all again): a new
  shared hook, `hooks/use-usage-indexes.ts`'s `useUsageIndexes(json)`, wraps BOTH
  `@gltf-studio/usage-index`'s `buildUsageIndex` and its new `buildAssetUsageIndex` (`UX-1115`) behind
  one `useMemo` keyed on `json`'s identity — `UsageSection.tsx` (now reading it instead of calling
  `buildUsageIndex` directly), `SceneTree.tsx`, and `AssetBrowser.tsx` all derive from this single
  hook rather than each independently re-deriving the same index. A new shared presentational
  component, `components/UsageBadge.tsx`, renders `UX-1116`'s "⚡" badge (count tooltip,
  `stopPropagation` so it never also fires the row's own click) for both `SceneTree.tsx` (per scene-
  tree row, from `useUsageIndexes(...).nodes`) and `AssetBrowser.tsx` (per Materials/Meshes/Animations
  row, from `.assets.{materials,meshes,animations}` — the Audio Clips tab stays unwired, same as its
  pre-existing "None in this document" empty state). A new session-only store field,
  `showUsageBadges` (default `true`, `UX-1117`), toggled by a new header button in `SceneTree.tsx`
  (`scene-tree.toggle-usage-badges`, styled identically to the pre-existing `showIndices` toggle) —
  `AssetBrowser.tsx` reads the SAME field with no toggle button of its own, mirroring how it already
  reads `showIndices` today. A scene-tree badge click selects the node and reuses the pre-existing
  `flashTarget`/`triggerFlash` "inspector-section" convention (a new `"usage"` id, alongside the
  existing `"mesh"`/`"audio"` ones) to scroll+flash `UsageSection.tsx` into view; `Inspector.tsx`
  gained the matching `usageSectionRef` + scroll-on-flash effect for this (placed BEFORE the
  component's early-return "nothing selected" guard — a real bug this pass caught and fixed: a hook
  placed after a conditional return is only called on SOME renders, which React's rules of hooks
  forbid and enforces at runtime, not merely a style nit). An asset-browser badge click has no
  Inspector section of its own to flash, so it calls the pre-existing `jumpUsageRefToGraph` action
  directly instead (`UX-1116`'s own documented "first reference" simplification).
  `UsageSection.tsx`'s zero-state menu (`UX-1109`'s Phase-1 stub) is now REAL (`UX-1118`): three new
  store actions (`attachOnSelectPointerNode`, `attachOnSelectPlaySound`, `attachOnSelectPlayAnimation`)
  each build a combined `event/onSelect` + effect-node command via `editor-core`'s `combineCommandParts`
  over a chain of intermediate `EditorDocument`s (`{ ...history.document, json: <patches-applied> }`
  after each step) — the same "compute the next step against an as-if-already-applied document"
  pattern `GraphEdit.addPointerNode`/`setVariableType` already use internally, just composed one
  level higher here across TWO node-adds plus a flow-connect rather than inside one factory.
  "Set property…"/"Interpolate…" finish by calling the pre-existing `openPointerPicker` action against
  the freshly-created node. A new store action, `jumpScriptPointerToScene` (`UX-1119`), is the
  Script tab's own wiring target — see `specs/ux-script.md`'s own implementation note for the Monaco-
  side half of this; it resolves via `@gltf-studio/usage-index`'s new `findGraphNodeIndexForPointer`,
  reuses `selectGraphNode`/`selectNode`/`referenceHighlightSceneNodeIndex` (no new selection/highlight
  state at all), and for a `/materials/*`/`/meshes/*` path sets `selectedAsset`/`activeAssetTab`
  directly (NOT via the pre-existing `selectAsset` action, which forces `activeDockTab: "data"` — this
  jump's whole point is staying on the Script tab).

- M8-lite (scene tree "+ Add" menu creates real content, `SceneTree.tsx`, `app.css` — the
  substantive spec change lives in `specs/ux-scene-tree.md`'s revised `UX-206`, this file's own
  `packages/app/**` catch-all is what makes touching `SceneTree.tsx` also a `specs/ux-shell.md`
  change): the add-menu's five entries (`UX-205`) now dispatch real `SceneEdit.add*Node` commands
  (`specs/document-model.md`'s `DOC-047`) instead of toasting. No `ux-shell.md`-owned behavior
  changed beyond that cross-reference; `UX-1xx`'s toast/history-entry/theme/dock requirements above
  are unaffected.

- Follow-up (user-reported bug, "when I select and move gizmo it applies rotation to the
  camera — moving the gizmo also orbited the viewport", `Viewport.tsx`,
  `packages/engine-three/src/render-host.ts` — the substantive mechanism lives in
  `specs/render-host.md`'s own DECISION note on `isGizmoDragging`, this file's own
  `packages/app/**` catch-all is what makes touching `Viewport.tsx` also a `specs/ux-shell.md`
  change): a regression the earlier "can't select objects in the viewport" fix (above) itself
  introduced. That fix's `onPointerMove` re-enables `OrbitControls` as soon as a gesture's
  cumulative movement crosses the 5px click/drag threshold, with no regard for whether a
  `TransformControls` gizmo (`specs/ux-viewport.md`'s `UX-305`) owned the gesture — a real gizmo
  drag crosses 5px almost immediately, re-arming `OrbitControls` out from under
  `TransformControls`' own `dragging-changed`-driven disable and leaving both the dragged object
  and the orbiting camera moving together for the rest of the drag. Fixed by gating that
  re-enable on `ThreeRenderHost.isGizmoDragging()` (backed directly by `TransformControls`' own
  public `dragging` flag), so `OrbitControls` stays disabled for the gizmo's entire drag
  regardless of pointer distance, while an ordinary (non-gizmo) drag still re-arms it exactly as
  before. `e2e/viewport-gizmo-camera-lock.spec.ts` (new) drives a real CDP mouse drag onto an
  actual gizmo handle (located via a new `hitTestGizmoHandle` test hook, itself a
  side-effect-free wrapper around `TransformControls`' own `pointerHover` — deliberately not
  trial-and-error real drags, since a missed one would be a genuine orbit whose `OrbitControls`
  damping momentum would outlive the gesture and pollute the very comparison being tested) and
  asserts the camera pose is unchanged while the object's transform changes and exactly one
  history commit is pushed — verified to fail on the pre-fix code and pass after.
  `e2e/viewport-real-click.spec.ts`'s pre-existing jitter-click and deliberate-orbit-drag
  regression coverage remains green, unmodified.

- M8 part 1 (scene node deletion — `SceneTree.tsx`, `App.tsx`, `gltf-scene.ts`, `app-store.ts` — same
  `packages/app/**` catch-all as the M8-lite note above; the substantive spec change lives in
  `specs/ux-scene-tree.md`'s new `UX-214` and `specs/document-model.md`'s new `DOC-048..051`): the
  scene-tree context menu gains a "Delete" action and an app-level Delete/Backspace keyboard
  shortcut, both backed by the store's new `deleteNode` action (`SceneEdit.removeNode`, real as of
  this change — previously a throwing M8 stub). No `ux-shell.md`-owned behavior changed beyond that
  cross-reference; the shortcut reuses `dispatchCommand`'s existing play-mode freeze guard rather
  than adding a new one.

- Handler-node target legibility (`BehaviorGraphPanel.tsx` — same `packages/app/**` catch-all as the
  notes above; the substantive spec change is `specs/ux-graph-canvas.md`'s new `UX-512`/`UX-513`/
  `UX-514`): `BehaviorGraphPanel.tsx` gains one new one-line wire-up, `<GraphCanvas onSelectSceneNode
  ={selectNode}>` — the new target-chip click handler `@gltf-studio/graph-canvas`'s card now exposes
  for `event/onSelect`/`onHoverIn`/`onHoverOut` nodes, pointed straight at the store's pre-existing
  `selectNode` scene-selection action (no new store field or action needed). No other `ux-shell.md`-
  owned behavior changed.

- M8 part 2 (scene reparent + duplicate — `SceneTree.tsx`, `app-store.ts`, `app.css` — same
  `packages/app/**` catch-all as the M8-lite/M8-part-1 notes above; the substantive spec change lives
  in `specs/ux-scene-tree.md`'s new `UX-215`/`UX-216`/`UX-217` and `specs/document-model.md`'s new
  `DOC-052..054`): the scene tree gains drag-and-drop reparenting, a "Duplicate" and "Reparent to
  root" context-menu action, and a Ctrl/Cmd+D shortcut, all backed by two new store actions
  (`reparentNode`/`duplicateNode`) wrapping `SceneEdit.reparentNode`/`duplicateNode` (real as of this
  change — `reparentNode` was the last throwing M8 stub). No `ux-shell.md`-owned behavior changed
  beyond that cross-reference.
- Typed literal editors incl. color pickers (`pointer-vocab.ts` — same `packages/app/**` catch-all
  as the notes above; the substantive spec change is `specs/ux-graph-canvas.md`'s new `UX-517`/
  `UX-519`/`UX-520`, `specs/document-model.md`'s new `DOC-055`): `pointer-vocab.ts` gains one new
  pure function, `colorKindForPointerPath(path)`, the canonical "is this pointer path a known color
  property" check (`baseColorFactor`, `emissiveFactor`, a `KHR_lights_punctual` light's `color`) —
  mirrored (not imported, per this codebase's established zero-cross-package-dependency convention)
  as a small pure copy in `@gltf-studio/graph-canvas`'s own `color-field.tsx`, which is where the
  actual color-picker UI this check drives lives (that package cannot depend on `packages/app`, the
  reverse of `packages/app`'s own dependency on it). No other `ux-shell.md`-owned behavior changed.

- Richer inspector (`specs/ux-inspector.md`'s `UX-415`..`418`, this file's own `packages/app/**`
  catch-all ownership — no `ux-shell.md`-owned behavior itself changed): `MaterialSection.tsx`
  gained emissiveFactor/alphaMode/alphaCutoff/doubleSided fields and a Texture Slots sub-section
  (thumbnails decoded via `@gltfi/gltf`'s `loadImageBitmaps`, a new `lib/texture-thumbnails.ts` +
  `hooks/use-texture-thumbnails.ts`); two new components, `LightSection.tsx`/`CameraSection.tsx`,
  join `Inspector.tsx`'s section list for a node carrying `KHR_lights_punctual`/`camera`. See
  `specs/ux-inspector.md`'s own implementation notes for the render-path details (which fields go
  through the vendored pointer-router vs. `engine-three`'s own direct-apply vs. a full reload) and
  the honest v1 gaps (texture upload, camera live preview, light type editing).

- Emitter/environment/listener authoring, audio pass 3/3 (`specs/ux-inspector.md`'s `UX-419`..`423`,
  this file's own `packages/app/**` catch-all ownership — no `ux-shell.md`-owned behavior itself
  changed): `AudioSection.tsx` gained emitter type/positional-physics/cone/sources fields; a new
  `AudioEnvironmentSection.tsx` joins `Inspector.tsx`'s section list for `KHR_audio_environment`
  zone/listener/scene-binding authoring; `CameraSection.tsx` gained a Listener row. See
  `specs/ux-inspector.md`'s own `UX-423` and implementation notes for the render-path split (live
  `applyPointer` vs. the pre-existing reload-on-edit fallback) and the honest v1 gaps (single-emitter-
  per-node, no Add-menu existing-clip picker UI yet, Audition's listener pose not live-fed outside
  play mode).

- Follow-up (user-reported bug, play/pause/stop lifecycle: "set a breakpoint — didn't work", "Pause
  and Stop — didn't work and car continued to move", "switched engine picker to interpreter — didn't
  change anything and car kept moving", against the R4 Racer starter's compiled engine, `app-
  store.ts`, `TopBar.tsx`): root cause was an unguarded re-entrancy window in `startPlay()` — `UX-113`/
  `UX-130`'s "disabled while `playState !== \"stopped\"`" rule for Play/the engine-picker/Debug-toggle
  only takes effect once `playState` actually flips to `"playing"`, which `startPlay()` doesn't do
  until AFTER its `await controller.start(...)` resolves; until then `playState` still reads
  `"stopped"`, so all three controls stayed clickable throughout that window. A second overlapping
  `startPlay()` call landing inside it (a fast double-click was enough to reproduce this
  deterministically against the racer's compiled engine, whose multi-hundred-node
  importGraph/checkModule/emit-ts/esbuild-wasm build time is long enough to make the window easy to
  hit in real use — a tiny fixture's near-instant build made it effectively unhittable, which is why
  this shipped uncaught) builds and starts a SECOND engine host; whichever call finishes last wins the
  single `activePlayController` slot, permanently orphaning the other — its own `requestAnimationFrame`
  tick loop keeps running and fanning pointer writes into the shared `RenderHost` forever, since
  nothing ever calls `pause()`/`stop()` on an instance no longer referenced anywhere. Every reported
  symptom was this one orphan fighting the tracked controller: Pause/Stop only ever reached the
  tracked one, so the untracked one's writes kept the car moving right through a "successful" Stop
  (which DID restore the document and DID reset `playState`/re-enable the controls — engine-switching
  "not changing anything" was therefore literally true, since the orphan doesn't read `playEngine` at
  all); the breakpoint attempt was a real, unrelated second gap (below), not a cause. Fixed with a new
  `playStarting` store field: set synchronously (before any `await`) at the top of `startPlay()` and
  checked alongside `playState !== "stopped"` in both `startPlay()`'s own guard and `TopBar.tsx`'s
  Play/`playbar.engine-picker`/`playbar.debug-toggle` `disabled` conditions — extending, not replacing,
  `UX-113`/`UX-130`'s existing rule to also cover the async construction window, and closing the race
  regardless of what triggers a second call. `stopPlay()` also gained a `try`/`finally` around its
  `controller.stop()` await (a REAL, independent latent bug found while fixing this: if the restore
  step ever rejects, `stopPlay()` used to skip its own cleanup entirely, leaving the store stuck
  showing `"playing"`/`"paused"` forever even though the controller itself had already torn down) —
  the store now always reaches `"stopped"` and always un-freezes history, logging the restore failure
  instead of losing it silently. The separate, real breakpoint-discoverability gap this bug report
  also surfaced (setting a breakpoint while already playing gave no feedback at all beyond an easy-to-
  miss gutter dot) is `specs/ux-debugger.md`'s `UX-1505` to own; noted here only for the ownership-
  drift check, per `OPEN(P0-nospec-label-tbd)`'s documented workaround. See `e2e/racer.spec.ts`'s
  compiled-engine double-click regression coverage.

- Full punctual-light control (this file's own `packages/app/**` catch-all ownership — no
  `ux-shell.md`-owned behavior itself changed; the substantive spec changes are `specs/ux-scene-
  tree.md`'s `UX-205`/`UX-206` r2, `specs/ux-inspector.md`'s `UX-417` r2, `specs/ux-pointer-
  picker.md`'s `UX-901` r2/`UX-909`, `specs/ux-viewport.md`'s new `UX-313`/`UX-314`, `specs/
  document-model.md`'s new `DOC-065`, and `specs/render-host.md`'s new `RH-032`..`RH-034`):
  `SceneTree.tsx`'s "+ Add" > Light entry gained its own Point/Spot/Directional submenu (mirroring
  Mesh's own Cube/Sphere/Plane one); `LightSection.tsx`'s Type field is a real editable dropdown now
  (`SceneEdit.setLightType`), not read-only text; `pointer-vocab.ts` gained a "Lights" content-tree
  section (`lightPropsFor`, gated per-type) for `PointerPickerDialog.tsx`; `gltf-scene.ts` gained
  `lightNodeIndices`; `Viewport.tsx` gained two toolbar toggles (studio lighting, light helpers) —
  see `specs/ux-viewport.md`'s own two new requirements for the full user-facing behavior and
  `specs/render-host.md`'s `RH-032`..`RH-034` for the underlying `RenderHost.setEditorHelpers` seam.

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
