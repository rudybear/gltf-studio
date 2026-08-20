# ux-audio-graph

Mockup snapshot: `docs/ux/mockups/mockup-v5.html` (approved at UX freeze U4 — see
`docs/ux/README.md`), the bottom dock's Audio graph tab (`.lint-banner`, `#audio-canvas`,
`#audio-details`). This is a second canvas instance built on the same rendering engine as the
behavior graph (`specs/ux-graph-canvas.md`), addressing `KHR_audio_graph` instead of
`KHR_interactivity`.

Owns (`specs/ownership.json`): once scaffolded, `packages/audio-canvas/**`.

Prefix: `UX`. This file owns the `UX-6xx` block.

## Requirements

### Shared rendering infrastructure

- [UX-600] (active) The audio-graph canvas renders nodes, ports, edges, and the node details card using the identical engine and contract `specs/ux-graph-canvas.md` specifies for the behavior graph (`UX-503`, `UX-506`, `UX-507`) — a separate canvas instance and dock tab, never a different rendering implementation.
- [UX-601] (active) Audio-graph nodes are drawn from the `KHR_audio_graph` node set (e.g. `bufferSource`, `gain`, `biquadFilter`, `panner`, and a terminal `emitter / destination` node), rendered in a category color distinct from every behavior-graph category color.

### Lint banner

- [UX-602] (active) When `AudioGraphHost`'s lint (`AGH-001`) reports a violation, a banner is shown above the canvas describing the violation in plain language naming the specific nodes involved (e.g. "cycle detected (gain → biquadFilter → panner → gain)"), not merely an abstract error code — surfacing `AGH-001`'s DAG-only constraint (no cycles, envelopes, or param-modulation in v1) to the person editing the graph.

### Invalid-edge rendering

- [UX-603] (active) An edge that lint flags as invalid (e.g. the edge that closes a cycle) is drawn at its normal geometric position but with a visually distinct dashed stroke, rather than being hidden or omitted — the graph's actual (invalid) wiring stays visible while it's being fixed.

### Node creation

- [UX-604] (retired) Superseded by UX-608 (M7 audio-graph editing): "ships in v1 without a node-creation palette" no longer holds — resolves OPEN(UX-audiograph-palette-tbd) in favor of the audio graph getting its OWN palette.

### Port typing and node config

- [UX-605] (active) Every port on every audio-graph node is `audio`-typed (`specs/ux-graph-canvas.md`'s `UX-503` color coding) — no `flow` ports appear on this canvas in v1, since audio-graph nodes are pure signal producers/consumers rather than flow-sequenced.
- [UX-606] (active) No audio-graph node belongs to the `pointer` category in v1, so every audio-graph node's config row renders with the plain (non-underlined, no `✎`) styling `specs/ux-graph-canvas.md`'s `UX-505` specifies for non-`pointer` nodes.
- [UX-607] (active) Exactly one terminal `emitter / destination` node type appears per audio-emitter graph in view; it has no outputs, and its `config` names the scene audio emitter it feeds.

### Editing (M7 audio-graph editing)

- [UX-608] (active) Resolves OPEN(UX-audiograph-palette-tbd): the audio-graph canvas has its OWN node-creation palette (distinct from the behavior graph's `specs/ux-graph-canvas.md` `UX-500` palette, since audio nodes come from the ratified `KHR_audio_graph` node-kind list, not `@gltfi/kernel`'s op registry), organized into four categories (Generators, Filters, Dynamics & Shaping, Channel Routing) with a search box, mirroring the behavior-graph palette's collapse/search/category-list UX. Clicking a palette entry appends a new node of that kind (with the kind's schema-default params) onto the canvas, scaffolding `extensions.KHR_audio_graph` first if the document has none yet.
- [UX-609] (active) Extends UX-602: in addition to the lint banner, every node named in at least one lint violation (`AudioGraphLintResult.nodeIds`) shows the SAME per-node corner badge `specs/ux-graph-canvas.md`'s `UX-506` already renders for the behavior graph (red for an error-severity violation, amber for warning-only), with a hover/focus tooltip listing the violation(s) — reusing that shared badge rendering (`GraphView`/`OpNode`'s `diagnosticsByNode`) rather than a bespoke audio-only indicator.
- [UX-610] (active) The selected node's params (`KHR_audio_graph.node.schema.json`'s per-kind param set — e.g. a filter's `frequency`/`qualityFactor`, an oscillator's `type` waveform enum, a gain's `gain` number) are editable inline in the node-details panel: a numeric field for a number/integer param, a dropdown for an enum param (e.g. oscillator `type`, gain `interpolation`, a channel node's `channelInterpretation`), a checkbox for a boolean param. Committing an edit updates `graph.nodes[nodeIndex].params[key]` as one undoable step; rapid successive edits to the SAME param (e.g. dragging a number field) coalesce into a single undo step, matching `specs/ux-graph-canvas.md`'s node-drag coalescing convention.
- [UX-611] (active) Connecting two audio-typed ports (node output → node input, a bound `KHR_audio_emitter` source → node input, or node output → the terminal emitter's input) wires the corresponding `KHR_audio_graph` array entry (`connections[]`/`inputs[]`/`outputs[]` respectively); connecting into a port that already has an incoming wire REPLACES it (last-connection-wins), the same effective behavior `specs/ux-graph-canvas.md`'s value-socket connections have. A direct source → emitter connection (bypassing every processing node) is rejected with an explanation toast — `KHR_audio_graph`'s schema has no way to express that binding. Disconnecting an edge (clicking it, or dragging a new wire into an already-wired input) removes the corresponding array entry.
- [UX-612] (active) Resolves the cycle-creation policy question left open by UX-602/603's read-only-era wording: creating a cycle through editing is NOT blocked at connect time — the edit is allowed, `AudioGraphHost.lint()` re-runs (debounced) and reports it exactly as it already does for a cycle present in an IMPORTED document (UX-602's banner, UX-603's dashed edge, UX-609's red per-node badge), and the audition control (UX-614) is disabled while any error-severity violation is present. This mirrors how the behavior graph treats validation (an invalid graph stays editable and fully visible, never silently rejected or reverted) rather than hard-blocking the connect gesture; removing the edge that closes the cycle clears the violation the same way fixing any other lint error does.
- [UX-613] (active) Deleting a selected node (or multi-selection) removes each REAL `graph.nodes[]` entry among them, with every referencing `connections[]`/`inputs[]`/`outputs[]` entry removed and every surviving node-index reference above it shifted down by one, as a single undo step per removed node. The synthetic source/terminal-emitter nodes (UX-607) are not deletable this way — attempting to include one in a delete selection skips it (with a toast) rather than erroring the whole gesture, since they represent `KHR_audio_emitter` bindings this graph does not own. Dragging a REAL node persists its new canvas position (`DOC-058`); dragging a source/terminal-emitter node moves it for the current session only (position resets to the auto-layout position on reload) — resolves OPEN(UX-audiograph-position-tbd) in favor of DOC-058's `extras.gltfi.{x,y}` convention for real nodes, deliberately scoped OUT for the two synthetic node kinds (see DOC-058's own doc comment for why).
- [UX-614] (active) An "Audition" control plays the graph's current output (every node bound into `outputs[]`, i.e. what actually reaches an emitter) through `AudioGraphHost.audition()` — gesture-gated (the click IS the gesture; no `AudioContext` is created before it, `AGH-001`) the same way the Inspector's emitter audition (`specs/ux-inspector.md` `UX-406`) is. Disabled, with a tooltip explaining why, whenever the current graph has any error-severity lint violation (UX-612) — auditioning a graph lint already knows is broken (a cycle, a missing required param) is not a useful signal, and `AudioGraphHost.audition()`'s own behavior on such a graph is unspecified.

## Implementation notes (M7)

`packages/audio-canvas` (this file's owned package) first lands in M7, covering `UX-600`, `UX-601`,
`UX-602`, `UX-603`, `UX-605`, `UX-606`, and `UX-607`; `UX-604` (no node-creation palette) holds by
simply not building one. `UX-600`'s "identical engine and contract" is literal, not just
similar-looking: `AudioGraphCanvas` renders through `@gltf-studio/graph-canvas`'s own `GraphView`/
`NodeDetails` components (newly exported from that package's `index.ts` for this reuse — see
`specs/ux-graph-canvas.md`'s own M7 implementation note for the three small type widenings that
required), fed by `map-audio-graph.ts`'s pure `KHR_audio_graph -> MappedGraph` projection (the SAME
`MappedGraph`/`MappedNode`/`MappedEdge`/`MappedPort` shape `mapGraph` produces for
`KHR_interactivity`). That projection also synthesizes two node kinds not literally present in
`graph.nodes[]`: an `audio-buffer-source` node per `graph.inputs[]` entry (the `KHR_audio_emitter`
source feeding the graph) and the `UX-607` terminal `emitter` node per `graph.outputs[]` entry, so
the canvas shows the complete source -> processing -> emitter signal path.

**Editable as of M7 audio-graph editing (supersedes this file's earlier read-only note):**
`AudioGraphCanvas`'s `GraphView` editing callbacks now translate into `@gltf-studio/editor-core`'s
new `AudioGraphEdit` command factories (`specs/document-model.md` `DOC-056..059`) and
`dispatchCommand`, the same shape `@gltf-studio/graph-canvas`'s own `GraphCanvas` already has for
the behavior graph — `AudioGraphCanvas` is now the ONE module in this package that calls
`AudioGraphEdit`. The non-obvious edit semantics this file previously flagged as needing real design
work are resolved by `audio-canvas`'s new `audio-entity.ts` (`identifyMappedNode`): a canvas
selection/connection endpoint is resolved back to one of three real identities — a `graph.nodes[]`
index, a bound `KHR_audio_emitter` SOURCE index, or a bound EMITTER index — before being handed to
`AudioGraphEdit`, so "connect a new node to the emitter terminal" is simply `connectAudio(..., {kind:
"node", ...}, {kind: "emitter", emitterIndex})`, appending/overwriting the matching `outputs[]`
entry (UX-611) — no ambiguity remained once the endpoint types (`DOC-056`) named the three cases
explicitly. `audio-node-registry.ts` (UX-608/UX-610) is the new palette/param-editing catalog, taken
directly from the ratified `KHR_audio_graph.node.schema.json`'s per-kind `oneOf` list — notably, the
8 biquad-filter variants (`lowpass`/`highpass`/`bandpass`/`lowshelf`/`highshelf`/`peaking`/`notch`/
`allpass`) are each their OWN `kind` string in the real schema (the filter TYPE is the kind, there is
no separate `"biquadFilter"` kind with a `type` enum param), which is why UX-601's illustrative
`biquadFilter` example does not appear verbatim in the palette. Per-node param editing (UX-610) is
its own small `audio-param-panel.tsx` component, deliberately NOT built on `@gltf-studio/graph-
canvas`'s value-socket literal editors (`onLiteralCommit`) or its `configuration`-field `ConfigEditor`
— audio-graph node params are a `{key: value}` bag on the node itself, never a connectable port or a
`KHR_interactivity`-specific config field, so neither existing editor's shape fits.

**Lint banner (`UX-602`)**: `AudioGraphCanvas` renders one row per `AudioGraphHost.lint()` result
(`specs/engine-api.md`'s `AudioGraphLintResult`, produced by `@gltf-studio/audio-graph`), whose
`message` field is already the complete human-readable sentence this requirement wants — including
`@gltf-studio/audio-graph`'s own cycle-path validator naming the actual node sequence (e.g. "cycle
detected (gainA → filterB → gainA) — KHR_audio_graph is DAG-only in v1 ..."), not merely an abstract
code. The banner also surfaces two further gap-analysis-derived warnings beyond the DAG-only
constraint this requirement names: unsupported envelope/automation `params` keys (gap G5) and an
oscillator/gain `"custom"` type/interpolation with no defined payload (gap G2) — see
`packages/audio-graph/src/validators.ts`.

**Invalid-edge rendering (`UX-603`)**: implemented via `MappedEdge`'s new optional `invalid` field
(`specs/ux-graph-canvas.md`'s M7 note) — `map-audio-graph.ts` sets it on every edge between two nodes
both named in a `"cycle"` lint violation; `graph-view.tsx` renders `invalid` edges with a dashed
stroke rather than hiding them, exactly as this requirement specifies. This is unchanged by M7 audio-
graph editing — a cycle CREATED through editing (UX-612) lints and renders identically to one present
on import.

**Default connectable ports on a fresh node (no UX-### of its own — a precondition for UX-611)**:
before M7, `map-audio-graph.ts` derived a node's rendered ports PURELY from its EXISTING
`connections[]`/`inputs[]`/`outputs[]` wiring — correct for rendering already-authored content, but
a chicken-and-egg dead end for editing: a just-`addNode`-ed node has no wiring yet, so it would
render with ZERO ports, nothing to drag a new connection onto or from. `defaultPortSlots(kind)` now
seeds every node kind's single ALWAYS-present side ("slot 0") by default — 1 input + 1 output for
the common case, 0 input + 1 output for the pure-source `oscillator`. `splitter`/`channelmerger`'s
FAN side (a splitter's output count, a merger's input count) stays usage-derived, since the ratified
schema declares no explicit count param for either — a second fan port only appears once an
already-authored document's `connections[]` actually uses that index, not yet reachable by drag from
this canvas alone (known v1 gap).

**Per-node lint badges (`UX-609`)**: `audio-diagnostics.ts`'s `buildAudioDiagnosticsByNode` converts
`AudioGraphLintResult[]` into the exact `Map<number, GraphDiagnostic[]>` shape
`validateInteractivityGraph` already produces for the behavior graph (`@gltf-studio/graph-canvas`'s
`DiagnosticSource` union gained one new member, `"audio-lint"`, for this) — joining a violation's
node LABELS (`AudioGraphLintResult.nodeIds`) back to a `MappedNode.index` via the same
label-or-`node_{i}`-fallback convention `map-audio-graph.ts`'s cycle-edge highlighting already uses.
`GraphView`/`OpNode`'s existing corner-badge rendering (`specs/ux-graph-canvas.md` `UX-506`) needed no
changes at all — `AudioGraphCanvas` previously passed it an always-empty `Map`; M7 populates it for
real.

**Test-hook key collision (test infrastructure, no UX-### of its own)**: `specs/ux-shell.md`'s `UX-103`
keeps the Behavior graph tab mounted-but-hidden while another dock tab is active, so its `GraphView`
instance and the Audio graph tab's `GraphView` instance can both be mounted at once. `GraphView`'s
`e2e`-only connect-simulation hook used to install itself under one hardcoded global key
(`window.__gltfStudioGraphCanvasTest`) regardless of which canvas mounted it; `graph-view.tsx` gained
an optional `testHookKey` prop (default: that same key, so `e2e/graph-canvas.spec.ts` needed no
changes) so `AudioGraphCanvas` can install its own hook under a SEPARATE key
(`__gltfStudioAudioGraphCanvasTest`) without the two instances fighting over one global.

**Deflake follow-up (systemic e2e CI stability pass, test infrastructure, no UX-### of its own)**:
`e2e/audio-graph-editing.spec.ts` shares `GraphView`/`op-node.tsx` with the behavior graph (above), so
it shares that canvas's node-click/resize race (`specs/ux-graph-canvas.md`'s task #33 follow-up) — a
freshly-added or just-rebadged node's card can still be mid-resize when a bounding-box click fires,
landing on the wrong element. This file never called `nodesDimensionsSettled()` (under its own
`__gltfStudioAudioGraphCanvasTest` key) before either of its two node-body clicks: the gain-node param
edit (right after adding an oscillator, which re-lays-out every node via `GraphView`'s
`elkPositions`-driven recompute effect, not just the new one) and the cycle-badge test's node deletion
(right after that same node grows an error badge). Fixed by awaiting the readiness check (via the new
shared `e2e/graph-canvas-test-helpers.ts`) and clicking the node header instead of its own testid at
both sites, same convention `specs/ux-graph-canvas.md`'s task #33 follow-up established.

## Open questions

- OPEN(UX-audiograph-banner-dismiss-tbd): the approved mockup's lint banner has no dismiss
  control; whether it should be dismissible independent of resolving the underlying violation is
  not specified.
- OPEN(UX-audiograph-bypass-tbd): `KHR_audio_graph.node.schema.json` also defines a top-level
  `bypass` boolean on every node (distinct from its `params` bag), toggled by the vendored
  `AudioGraphJS` runtime's `_bypass` dry/wet gain pair. M7 audio-graph editing did not add a UI
  affordance for it (no requirement named it, and `audio-param-panel.tsx` only edits `params`,
  not a node's other top-level fields) — a future PR adding one would need a small
  `AudioGraphEdit.setNodeBypass` factory alongside `setNodeParam` (`DOC-057`).
