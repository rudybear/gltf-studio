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
- [UX-613] (active) Deleting a selected node (or multi-selection) removes each REAL `graph.nodes[]` entry among them, with every referencing `connections[]`/`inputs[]`/`outputs[]` entry removed and every surviving node-index reference above it shifted down by one, as a single undo step per removed node. The synthetic source/terminal-emitter nodes (UX-607) are not deletable this way — attempting to include one in a delete selection skips it (with a toast) rather than erroring the whole gesture, since they represent `KHR_audio_emitter` bindings this graph does not own. Dragging a REAL node persists its new canvas position (`DOC-058`); dragging a source/terminal-emitter node ALSO persists its position as of UX-617 (this requirement no longer scopes that out — see UX-617 for where).
- [UX-614] (active) An "Audition" control plays the graph's current output (every node bound into `outputs[]`, i.e. what actually reaches an emitter) through `AudioGraphHost.audition()` — gesture-gated (the click IS the gesture; no `AudioContext` is created before it, `AGH-001`) the same way the Inspector's emitter audition (`specs/ux-inspector.md` `UX-406`) is. Disabled, with a tooltip explaining why, whenever the current graph has any error-severity lint violation (UX-612) — auditioning a graph lint already knows is broken (a cycle, a missing required param) is not a useful signal, and `AudioGraphHost.audition()`'s own behavior on such a graph is unspecified.

### Gaps closed + deeper runtime capability (M7 audio pass, tracks 1-2/3)

- [UX-615] (active) A `splitter` node's output fan and a `channelmerger` node's input fan are addressable beyond slot 0: `audio-node-registry.ts` adds a `numberOfOutputs` param to `splitter` (symmetric with `channelmerger`'s pre-existing `numberOfInputs`, already accepted before this requirement) — an implementation-defined `params` key (the ratified `KHR_audio_graph.splitter.schema.json`/`.channelmerger.schema.json` declare no explicit count param, but the vendored AudioGraphJS runtime's `createChannelSplitter`/`createChannelMerger` read exactly these keys, and `params` has no `additionalProperties: false`). The canvas seeds that many rendered ports for the node BEFORE any connection uses them (`map-audio-graph.ts`'s `defaultPortSlots`), so a splitter/merger's Nth channel port is draggable/connectable as soon as its count param says so, not only once an already-authored document's `connections[]` happens to reference that index (the v1 gap this resolves). `@gltf-studio/audio-graph`'s `validateGraph` additionally flags (error severity) a `connections[]` entry whose output/input index exceeds the node's declared count — a genuine authoring bug (real Web Audio `connect()` would fail at that index).
- [UX-616] (active) Resolves `OPEN(UX-audiograph-bypass-tbd)`: the node-details panel's `AudioParamPanel` gains a "Bypass" checkbox ahead of every node's param rows (every `KHR_audio_graph` node kind supports the schema's top-level `bypass` boolean — distinct from `params`), committing through the new `AudioGraphEdit.setNodeBypass` factory (`DOC-063`). Reflected in audition for real: the vendored AudioGraphJS runtime already reads `graph.nodes[].bypass` end-to-end (`parse-layered.ts`'s `parseGraph`, `runtime/preprocess.ts`'s `applyBypass`) and fully excises a bypassed node from the built Web Audio graph, rewiring its upstream/downstream connections directly around it — toggling this checkbox and re-auditioning routes the signal through or around the node for real, not just a document-level flag with no audible effect.
- [UX-617] (active) Supersedes UX-613's original "session-only" scoping for the two synthetic terminal node kinds (source/emitter, UX-607): dragging one now persists its canvas position too, via the new `SceneEdit.setAudioSourceProperty`/`setAudioEmitterProperty` (`DOC-062`) writing `extras.gltfi.{x,y}` onto the underlying `KHR_audio_emitter` `sources[N]`/`emitters[N]` registry entry itself (DOC-027's convention, one level OVER rather than one level down, since a terminal node is not a `graph.nodes[]` entry `AudioGraphEdit.setNodePosition`, DOC-058, could address) — resolving `OPEN(UX-audiograph-position-tbd)` in full rather than the earlier partial resolution that scoped synthetic nodes out. `map-audio-graph.ts` carries the underlying source/emitter's own `extras` through onto the synthetic node's `raw`, so `graph-view.tsx`'s existing generic `node.raw.extras?.gltfi` position convention (unchanged) renders it with no further canvas code. A source/emitter bound into more than one graph shares ONE position across every view that renders it — an accepted v1 simplification (the common case is a 1:1 source/emitter-to-graph binding).
- [UX-618] (active) Fuller per-node-kind param coverage from the ratified `KHR_audio_graph.node.schema.json`'s per-kind param objects, added to `audio-node-registry.ts`/`audio-param-panel.tsx`: an oscillator's `periodicWave` (`{real: number[], imag: number[]}`, the Fourier-coefficient payload gap-analysis G2 asked for — now real in the ratified schema) and a gain's `curve` (a sampled interpolation curve, also G2) are editable as textarea(s) of comma/whitespace-separated numbers, each shown only when its OWN controlling field takes the relevant value (`type: "custom"` / `interpolation: "custom"` respectively — the new `AudioParamField.showIf` mechanism, `isParamFieldVisible`). A waveshaper's `curve` (an explicit shaping curve the vendored runtime already fully applies, unlike the two above — see UX-619's runtime-vs-schema distinction) gets the same textarea editor, unconditionally visible. Both new field types are `optional: true` — left out of a freshly-added node's initial `params` bag (`defaultParamsFor`) rather than forced in with a placeholder value, since an empty/default `curve`/`periodicWave` could violate the schema's own `minItems` constraints.
- [UX-619] (active) Extends `specs/ux-audio-graph.md`'s existing lint-banner/badge machinery (UX-602/609) with explicit RUNTIME-gap messaging, distinct in kind from the DAG-only/envelope SPEC-gap messaging those requirements already cover: `compressor` — gap-analysis G1's "no DynamicsCompressorNode" finding — is now a REAL kind in the ratified schema (added by the same PR #2572 review-fixes refresh that also added oscillator `periodicWave`/gain `curve`, UX-618) and `audio-node-registry.ts`'s palette offers it (Dynamics & Shaping category, the schema's threshold/knee/ratio/attack/release params), but the project's vendored `audio-graph-js@0.1.0` runtime has no `'compressor'` case in its node builder — a genuine IMPLEMENTATION gap, not a spec gap. `@gltf-studio/audio-graph`'s `validateGraph` flags a `compressor` node with a warning naming this distinction explicitly ("valid per the ratified KHR_audio_graph schema... but this project's vendored AudioGraphJS runtime... doesn't implement it yet"), and `AudioGraphHost.audition()` degrades gracefully (traces the build failure, does not throw) rather than crashing the canvas when a document reaches one — see `@gltf-studio/audio-graph`'s `audio-graph-host.ts`/`validators.ts` for the equivalent, now-resolved-in-schema treatment of oscillator `periodicWave`/gain `curve` (warned only once actually authored, since the schema-level "undefined payload" gap they used to warn about, G2, no longer applies).

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

## Implementation notes (M7 gaps-closed + deeper runtime, audio pass 1-2/3)

This pass closes the four v1 gaps M7 audio-graph editing's own implementation notes named above
(fan ports, bypass, terminal-node position persistence, param coverage — UX-615..618) and deepens
`KHR_audio_graph` runtime capability per `/glTF-audio/03-gap-analysis-audio-graph.md` (UX-619)
without authoring anything nonstandard: every new palette entry/param is a real, ratified-schema
construct.

**A load-bearing discovery that reshapes this pass**: the gap analysis was written against an
EARLIER snapshot of the ratified `KHR_audio_graph` schema than the one vendored in this repo
(`glTF-audio/AudioGraphJS/spec-repo`'s single "Add KHR_audio_graph extension (refresh of #2572 with
review fixes)" commit) — that refresh already resolved two of the gap analysis's headline findings
at the SCHEMA level:

| Gap | Gap analysis said | Current ratified schema | This PR |
|---|---|---|---|
| G1 (no compressor node) | Spec gap, H severity | RESOLVED — `compressor` kind exists (`KHR_audio_graph.compressor.schema.json`, threshold/knee/ratio/attack/release) | Authorable (palette, UX-619) — but flagged as RUNTIME-unimplemented (vendored `audio-graph-js@0.1.0` has no `'compressor'` builder case) |
| G2 (`custom` oscillator/gain has no payload) | Spec gap, H severity | RESOLVED — oscillator `periodicWave` and gain `curve` are real schema fields | Authorable + editable (UX-618) — oscillator `periodicWave` is RUNTIME-unimplemented (never read by `createOscillator`); gain `curve` is RUNTIME-approximated (read as a flag, not sampled); waveshaper `curve` (not itself a G2 item, but the same "declared but is it applied" question) IS fully runtime-supported |
| G3 (no cycles/feedback delay) | Design decision needed | UNCHANGED — still DAG-only, no delay-cycle exception adopted | Still a genuine SPEC-level constraint (this project's own choice, not upstream's) — UX-602/603/609/612's existing cycle lint/dashed-edge/badge/audition-disable machinery is the correct, complete treatment; no PR could "author around" this without changing the DAG-only decision itself |
| G4 (no audio-rate param modulation) | Document, likely defer | UNCHANGED — `to: {node, input}` connections are still numeric-node-index-only, no AudioParam target | Still a genuine SPEC-level constraint — nothing a document COULD express needs a validator (`validators.ts`'s own header comment) |
| G5 (no envelopes/scheduled automation) | Document, defer | UNCHANGED | Still a genuine SPEC-level constraint — the pre-existing `envelope-unsupported` warning (any `envelope`/`adsr`/`automation`-looking params key) is the correct treatment; gain's `duration`/`interpolation` smoothing remains the sanctioned mechanism |
| G7 (no post-spatialization master-bus insert) | Document the model | UNCHANGED | Still a genuine SPEC-level constraint (`KHR_audio_graph.output.schema.json` only binds pre-emitter processing nodes) — no editor affordance could add an insert point the schema doesn't have; `KHR_audio_environment`'s listener/environment `graph` hooks (`types.d.ts`'s `Listener.graph`) are the closest sanctioned mechanism and are out of this package's ownership |

The practical upshot: **G1/G2 moved from "spec gap" to "runtime gap"** — this project's vendored
`audio-graph-js@0.1.0` predates the schema refresh that added them, so the honest per-track split
is "author it (schema-conformant) + tell the truth about what this particular runtime does with it
yet" rather than "can't author it at all." **G3/G4/G5/G7 remain genuine spec-level constraints** no
editor change can route around — this pass does not touch their existing, already-correct
messaging (UX-602/603/609/612, `envelope-unsupported`).

**Fan ports (UX-615)** and **bypass (UX-616)** are pure gap-closures against what M7 audio-graph
editing's OWN v1 scope already left undone (not gap-analysis items) — see those requirements'
own text for the mechanism. **Terminal-node position persistence (UX-617)** likewise closes M7's
own documented scoping limit.

**Audition safety net (Track 2, no UX-### of its own — an `AudioGraphHost` implementation
robustness fix, not a canvas-visible behavior)**: `AudioGraphJsHost.audition()` now catches a
`buildGraph()` failure (the concrete case: a graph reaching a `compressor` node) and traces it
rather than throwing — `specs/engine-api.md`'s `AGH-audition-signature-tbd` already documented a
`"build-failed"` lint code as anticipated but never wired up anywhere; this is that path's first
real use, scoped minimally (traced, not surfaced as a live lint entry — `AudioGraphTabPanel.tsx`
only recomputes `lint()` on a document change, not on an `audition()` call, so retrofitting a
lint-refresh path was out of scope for what this fix needs to guarantee: audition never crashes
the canvas).

## Open questions

- OPEN(UX-audiograph-banner-dismiss-tbd): the approved mockup's lint banner has no dismiss
  control; whether it should be dismissible independent of resolving the underlying violation is
  not specified.

Resolved since M7 audio-graph editing: OPEN(UX-audiograph-bypass-tbd) (a per-node bypass UI
affordance — UX-616 / `DOC-063`) and OPEN(UX-audiograph-position-tbd)'s remaining partial scope
(synthetic source/emitter terminal node position persistence — UX-617 / `DOC-062`), both by the
"gaps closed + deeper runtime capability" pass above.
