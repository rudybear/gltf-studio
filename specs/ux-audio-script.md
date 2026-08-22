# ux-audio-script

The audio sibling of `specs/ux-script.md`: a Monaco-based script view/editor over the current
`KHR_audio_graph` graph, backed by the standalone `@gltf-audiograph/*` transpiler
(github.com/rudybear/gltf-audiograph) rather than `@gltfi/*`. No approved mockup exists for this tab
(it postdates the UX-freeze U4 mockup round) — its toolbar/layout are modeled directly on
`ux-script.md`'s shipped Script tab (same visual language: Edit/view toggle, Apply action,
EQUIV/DIVERGED badge), not on a design artifact.

Owns (`specs/ownership.json`): `packages/audio-script-panel/**`, plus
`packages/app/src/components/dock/AudioScriptTabPanel.tsx` (the dock-wiring layer that resolves an
audio-graph-canvas selection into this package's props — see the Implementation notes' "selection
resolution" entry for why that resolution lives in `packages/app`, not this package).

Prefix: `UX`. This file owns the `UX-14xx` block.

## Requirements

### Emit view

- [UX-1400] (active) The Audio Script tab renders the current `KHR_audio_graph` graph's generated
  audio-script, read-only by default, with TypeScript syntax highlighting — the audio sibling of
  `ux-script.md`'s `UX-700`, generated via `@gltf-audiograph/ir`'s `importAudioGraph` +
  `@gltf-audiograph/emit-ts`'s `emitAudioModule` instead of `@gltfi`'s equivalents. The emitted code
  opens with a leading provenance comment naming which audio graph it was generated from (mirrors
  `UX-705`), e.g. `// Audio script — generated from audio graph 0`.

### Editable surface

- [UX-1401] (active) An "Edit" toolbar action switches the read-only Emit view into a real editable
  Monaco buffer (TypeScript language mode, with `@gltf-audiograph/parse-ts`'s `RUNTIME_LIB_DTS`
  ambient module registered so `a.<kind>(...)`-style completions work) — mirrors `UX-707`, shipped as
  a real editable surface from this tab's first version rather than a later-added one (there is no
  freeze-time read-only-only predecessor to supersede here, unlike the interactivity Script tab's
  `UX-701`).
- [UX-1402] (active) While the buffer is in edit mode, every content change is parsed off the UI
  thread (a Worker wrapping `@gltf-audiograph/parse-ts`'s `parseAudioModule`), debounced (~300ms of
  no further keystrokes) and staleness-guarded (a parse started before a newer edit never overwrites
  that newer edit's result) — mirrors `UX-709`. A failing parse's diagnostics are shown as gutter/
  inline error markers, positioned directly from `Diagnostic.line`/`column`/`span` — `parse-ts`'s
  diagnostics always carry a structured position (ts-morph-backed throughout), so this tab has no
  analogue of `ux-script.md`'s `extractDiagnosticLine` regex fallback to begin with.

### EQUIV / DIVERGED badge

- [UX-1403] (active) The toolbar shows exactly one of `EQUIV ✓` or `DIVERGED ⚠` at all times —
  mirrors `UX-703`, backed by `@gltf-audiograph/verify`'s `equivalentAudioDocs` rather than a
  graph-only compare: r2 (see the Implementation notes' "r2 reconciliation" entry) moved oscillator
  payloads out of the graph and onto `KHR_audio_emitter` sources, so a graph-only equivalence check
  would miss an edit that changes only an oscillator's frequency/type/etc. `equivalentAudioDocs`
  compares both the graph AND each side's oscillator-source entries (`@gltf-audiograph/ir`'s
  `exportOscillatorSources`, applied to the document's own re-imported module so both sides compare
  the same `{source, entry}` shape regardless of which pipeline stage produced them).

### Apply → Audio graph

- [UX-1404] (active) The Apply action (enabled only when the most recent parse is clean, mirrors
  `UX-711`) replaces the document's audio graph with the freshly exported one via `editor-core`'s
  `AudioGraphEdit.replaceAudioGraph` (`DOC-064`), as ONE history-stack entry labeled "Apply audio
  script" — even when the parsed script also declares/edits an `a.oscillator(...)` source, whose
  `@gltf-audiograph/ir` `exportAudioGraph` output round-trips through `KHR_audio_emitter.sources[]`
  instead of the audio graph itself (r2): that write is folded into the SAME command via
  `editor-core`'s `combineCommandParts` + the pre-existing `SceneEdit.setAudioSourceProperty` (called
  with an empty `propertyPath`, which wholesale-replaces `sources[sourceIndex]` — exactly what
  `exportAudioGraph`'s per-source `entry` already is, spec-shaped and ready to splice), so Apply is
  still one undo/redo step regardless of whether 0 or more oscillator sources changed. Node-position
  note (same accepted behavior as `UX-711`'s interactivity-side Apply): `AudioGraphEdit
  .replaceAudioGraph`'s `newGraph.nodes[].extras.gltfi` positions are whatever the parsed script
  produced — typically none, since `@gltf-audiograph/parse-ts` has no canvas-layout concept — so
  `audio-canvas` re-lays-out reshaped nodes via ELK on the next render rather than erroring on a
  missing position.

### No-audio-graph empty state

- [UX-1405] (active) When the current document has no `KHR_audio_graph` graph at all, the tab shows a
  plain, honest empty-state message ("No audio graph in this asset — add nodes from the audio
  palette") in place of the toolbar and editor — mirrors `UX-714`.

### Cross-highlight (reduced fidelity, documented)

- [UX-1406] (active) Selecting a node OR a synthetic source entity on the audio-graph canvas
  highlights (select + reveal) the corresponding declaration identifier in the Audio Script tab's
  buffer, when one exists — the audio sibling of `UX-712`. Unlike the interactivity side, this
  mapping is NOT identifier-ambiguous by construction: `@gltf-audiograph/emit-ts`'s `emitAudioModule`
  returns `names`/`sourceNames` keyed directly by graph-local node/source index (no `sourceNodeIds`
  kind-prefixed indirection to resolve first, and every node/source gets exactly one `const <name> =
  a.<kind>(...)` declaration), so the lookup itself is a plain, always-unambiguous `indexOf`. What
  this tab does NOT implement, as a deliberate scope reduction from `UX-715`'s interactivity-side
  treatment (see the Implementation notes): a persistent amber decoration independent of Monaco's own
  selection rendering, an auto-fade timer, or click-elsewhere/regen-survival tracking — this is a
  plain "select the range and reveal it" on every selection change, which is real and correct but
  visually plainer once focus moves elsewhere. A genuine, documented gap, not a hidden one.
- [UX-1407] (active) A diagnostic naming a `graph.nodes[]` index (only `importAudioGraph`'s own
  diagnostics carry one — e.g. `oscillator-node-kind`, see UX-1409) renders a "→ Audio graph" inline
  action that selects that node on the audio-graph canvas and switches the dock to the Audio graph
  tab. A hand-edited buffer's `parseAudioModule` diagnostics are script-position-only (no graph-index
  concept exists until export), so this action never appears for those.

### Dock tab discoverability

- [UX-1408] (active) The dock gains a sixth tab, "Audio script", alongside "Behavior graph" / "Audio
  graph" / "Script" / "Console" / "Data (glTF)" — kept mounted-but-hidden once first opened (`UX-103`,
  the same treatment `ux-script.md`'s Script tab already gets), so the Monaco buffer/edit-mode state
  survives a tab-away-and-back. Monaco itself is created once, on this tab's own first REAL reveal
  (never inside a `display:none` ancestor, which cannot measure it for layout) and thereafter only
  hidden via `display:none` on an ancestor with `automaticLayout: true` handling the rest — the same
  mechanism `ux-script.md`'s Script tab already established (no new mechanism needed here).

### r2 / canvas reconciliation tolerance

- [UX-1409] (active) `@gltf-audiograph`'s transpiler tracks `KHR_audio_graph` spec "r2" (see the
  Implementation notes for what changed). **r2 resolved (was: tolerance for a predating registry)**:
  this requirement originally documented a REAL shape conflict — `audio-canvas` authored a legacy
  `oscillator` NODE kind and splitter/channelmerger arity params r2 no longer allows/reads — and this
  tab's own tolerance mechanism for it (below). A later pass (resolving
  `OPEN(UX-audio-script-registry-r2-tbd)`, see the Implementation notes) migrated `audio-canvas`'s
  registry to derive directly from `@gltf-audiograph/kernel`, closing the conflict at the source: the
  palette can no longer author either shape at all. The tolerance mechanism itself stays in place
  (this is error handling for a genuinely malformed/foreign document, not a scope reduction) but is
  now reached only via a document this app's own canvas could never have produced — an imported
  foreign/legacy asset, or a hand-edited buffer — not anything the palette itself authors:
  `buildAudioEmitView` treats any ERROR-severity `importAudioGraph` diagnostic (e.g.
  `oscillator-node-kind`) as "cannot emit" and falls back to a diagnostics-only placeholder (a
  one-line comment) instead of calling `emitAudioModule` at all — which, empirically, can itself throw
  on a structurally invalid module rather than degrade gracefully. The Edit mode is unaffected: a user
  can still hand-author a fully r2-shaped script from scratch (or fix a flagged graph node-by-node
  from the Audio graph tab, which is itself r2-shaped now) and Apply it normally.

## Implementation notes

- **Vendoring**: `scripts/refresh-vendor.mjs` gained an `AUDIOGRAPH_PACKAGES` block (`kernel`, `ir`,
  `emit-ts`, `parse-ts`, `verify`, `runtime-lib`) packed from a sibling `../gltf-audiograph` checkout
  the same way the pre-existing `GLTFI_PACKAGES` block packs `../gltf-interactivity` — these packages
  already declare correct `main`/`types`/`exports`/`files` fields (including `parse-ts`'s dedicated
  `./runtime-lib-dts` subpath, confirmed byte-identical to its public-entry re-export via that repo's
  own `pack:smoke`), so — unlike `audio-graph-js` below it in the same script — no package.json
  overlay is needed before `pnpm pack`. `cli`/`conformance` are not vendored (nothing here needs the
  CLI binary; `conformance` is `"private": true`). `pnpm-workspace.yaml` gained one `overrides` entry
  per vendored `@gltf-audiograph/*` name, pointing at its `vendor/*.tgz`, identical in shape to the
  `@gltfi/*` overrides already there.

- **Panel architecture — shared vs. copied from `@gltf-studio/script-panel`**: this pass mirrors
  `script-panel`'s file-for-file structure (`emit-view.ts`, `equivalence.ts`, `monaco-setup.ts`,
  `parse-client.ts`/`parse.worker.ts`, a cross-highlight module, `index.ts`, one big `.tsx`) into a
  new `packages/audio-script-panel`, and made two explicit share-vs-copy calls rather than reaching
  for a new shared package by default:
  - `request-sequencer.ts` (the monotonic-id/staleness-cancellation protocol) is COPIED verbatim.
    It's ~15 lines with zero dependencies — a shared package for one tiny pure class was judged not
    worth the cross-package coupling it would introduce for both packages' build graphs.
  - `monaco-setup.ts` is COPIED, each with its OWN independent module-scope `initialized` singleton
    (`loadMonaco` vs. `loadMonacoAudio`) rather than extracted into a shared "monaco-bootstrap"
    module. Both are safe to call in either order or in the same session (verified in e2e with both
    tabs opened together): `MonacoEnvironment.getWorker`/`typescript.typescriptDefaults
    .setCompilerOptions` are idempotent (functionally identical values each call), and `addExtraLib`
    accepts multiple ambient modules with different specifiers with no conflict on Monaco's single,
    page-wide `typescriptDefaults` registry. Extracting a real shared module was judged non-trivial
    given the two packages' differing ambient-lib specifics (`@gltfi/runtime-lib` vs.
    `@gltf-audiograph/runtime-lib`) and the risk of touching script-panel's own working, e2e-hardened
    code for this PR's sake — left as a candidate follow-up, not a silent duplication.
  - `pointer-links.ts` has NO audio counterpart at all: audio-script identifiers never inline a glTF
    pointer path the way `pointer/set`/`pointer/interpolate` GIscript calls do, so there is nothing
    for that approach to find.
  - Cross-highlight (`audio-cross-highlight.ts`) is NOT copied — it's a materially simpler NEW module
    (see `UX-1406`), because `emitAudioModule`'s `names`/`sourceNames` are already keyed directly by
    index, unlike the interactivity side's kind-prefixed `sourceNodeIds` indirection.
  - `AudioScriptPanel`'s own `.tsx` deliberately does NOT reproduce `script-panel.tsx`'s persistent-
    decoration/fade-timer/click-elsewhere-echo state machine (`UX-715`) — see `UX-1406`'s own text for
    the scope reduction and rationale.

- **Selection resolution lives in `packages/app`, not `audio-script-panel`**: the audio-graph
  canvas's selection (`app-store.ts`'s new `selectedAudioGraphNodeIndex`) is a `@gltf-studio
  /audio-canvas` `MappedNode.index` — a dense index spanning ALL THREE canvas entity kinds (real
  nodes, synthetic source terminals, synthetic emitter terminals) combined, not directly a
  `graph.nodes[]` index. `AudioScriptTabPanel.tsx` (the dock-wiring layer) resolves it via the SAME
  `mapAudioGraph`/`identifyMappedNode` utilities `AudioGraphCanvas` uses internally (both already
  public exports of `@gltf-studio/audio-canvas`) into the two plain-number props `AudioScriptPanel`
  actually wants (`selectedNodeIndex`/`selectedSourceIndex`) — done at this layer specifically so
  `@gltf-studio/audio-script-panel` itself takes no dependency on `@gltf-studio/audio-canvas`, the
  same "editor package doesn't import the canvas package" posture `script-panel` already has toward
  `graph-canvas`. `selectedAudioGraphNodeIndex` itself replaces what was previously
  `AudioGraphTabPanel`'s own local `useState` — lifted into the shared store (a new, separate slot
  from the BEHAVIOR graph's `selectedGraphNodeIndex`, per that panel's own pre-existing "a second,
  independent canvas must not fight over the same selection slot" rule) specifically so a SEPARATE
  mounted component (the Audio Script tab) can read the same selection.

- **The "→ Audio graph" jump (`UX-1407`)** is intentionally not a full port of `ux-usage-mapping.md`'s
  `UX-1108`/`UX-1119` focus-request-queueing machinery: `app-store.ts`'s new
  `jumpAudioScriptNodeToGraph` action just switches the active dock tab and sets
  `selectedAudioGraphNodeIndex` directly (no request/seq queue, no pan/reveal call — `audio-canvas`
  has no analogous "focus this node" API yet). Cheap, direct, and honest about being a smaller feature
  than its interactivity-side analogue, not a hidden subset of it.

- **r2 reconciliation findings** (`@gltf-audiograph`'s `docs/design/spec-discrepancies.md`/
  `-review-response.md`), concretely, against this app's `packages/audio-canvas
  /audio-node-registry.ts` — **both RESOLVED** by the pass that closed
  `OPEN(UX-audio-script-registry-r2-tbd)` (migrated the registry onto
  `@gltf-audiograph/kernel`, see `specs/ux-audio-graph.md`'s r2 updates to `UX-608`/`UX-610`/`UX-615`/
  `UX-618`/`UX-619` and `specs/ux-inspector.md`'s new `UX-424` for where oscillator authoring moved):
  1. **Oscillator relocation** — r2 removed `oscillator` as a graph NODE kind entirely; it is now
     declared on a `KHR_audio_emitter` source (`source.extensions.KHR_audio_graph.oscillator`,
     entering the graph via `inputs[]` like any other source). `audio-canvas`'s registry no longer
     authors `oscillator` as a node kind at all — oscillator authoring moved to the Audio Emitter
     inspector's Sources sub-list (`UX-424`). `UX-1409`'s tolerance mechanism stays, but is now
     reachable only via a foreign/legacy document, never anything the palette itself can author.
  2. **Splitter/merger arity is derived, not authored** — r2 removed `numberOfOutputs`/
     `numberOfInputs` as authored `params` for `splitter`/`channelmerger`; arity is now derived from
     the highest port index actually referenced in `connections`/`inputs`. `audio-canvas`'s registry
     no longer authors either param; the audio-graph canvas grows a splitter's/channelmerger's fan
     ports purely from wiring (`map-audio-graph.ts`'s `growFanPorts`). A legacy document that still
     carries one of these params still round-trips (import accepts and drops it, `arity-param-ignored`
     WARNING, not an error).
  3. Other r2 changes (`gain.interpolation:"custom"` requiring `curve` at schema level; a
     stabilized-cycle diagnostic downgrade) surfaced no shape conflict against this app's canvas and
     needed no reconciliation note.

- **Bundle weight**: `packages/app/src/bundle-chunks.test.ts` (previously interactivity-only) now
  also documents and asserts the audio side — both packages' source files are literally named
  `parse.worker.ts`, so a real `pnpm build` emits TWO distinct `parse.worker-*.js` chunks (asserted by
  count), and the existing ts-morph-marker assertions (main-entry-chunk-clean /
  parse-worker-chunk-dirty) already cover both chunks together since they join every matching file
  before searching.

## Open questions

- RESOLVED (was OPEN(UX-audio-script-registry-r2-tbd)): `audio-canvas`'s node registry/canvas
  authoring UI predated r2 (oscillator-as-node-kind; authored splitter/merger arity params — see the
  Implementation notes' reconciliation findings). A later pass migrated the registry to derive
  directly from `@gltf-audiograph/kernel`, moved oscillator authoring onto `KHR_audio_emitter` source
  data (`specs/ux-inspector.md`'s `UX-424`), and made splitter/channelmerger arity purely
  wiring-derived — closing this tab's tolerance mechanism (`UX-1409`) down to foreign/legacy documents
  only, exactly the "matching r2 and this tab's own tolerance ceiling" outcome this question left
  open.
- OPEN(UX-audio-script-jump-fidelity-tbd): whether `UX-1406`'s plain select+reveal cross-highlight
  should eventually gain `ux-script.md` `UX-715`'s persistent-decoration/fade-timer/regen-survival
  treatment. Left open as a documented, real fidelity gap rather than ported speculatively.
- OPEN(UX-audio-script-multigraph-tbd): unlike `ux-script.md`'s Script tab (a graph-index selector
  when an asset has more than one `KHR_interactivity` graph), this tab always shows
  `KHR_audio_graph.graphs[0]` — matching `AudioGraphTabPanel`'s own current single-graph scope, not a
  new limitation this tab introduces. Left open for whenever the Audio graph tab itself grows
  multi-graph support.
