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

- [UX-604] (active) The audio-graph canvas ships in v1 without a node-creation palette (unlike the behavior graph, `specs/ux-graph-canvas.md`'s `UX-500`) — its nodes in this freeze are pre-authored content, not creatable through this canvas.

### Port typing and node config

- [UX-605] (active) Every port on every audio-graph node is `audio`-typed (`specs/ux-graph-canvas.md`'s `UX-503` color coding) — no `flow` ports appear on this canvas in v1, since audio-graph nodes are pure signal producers/consumers rather than flow-sequenced.
- [UX-606] (active) No audio-graph node belongs to the `pointer` category in v1, so every audio-graph node's config row renders with the plain (non-underlined, no `✎`) styling `specs/ux-graph-canvas.md`'s `UX-505` specifies for non-`pointer` nodes.
- [UX-607] (active) Exactly one terminal `emitter / destination` node type appears per audio-emitter graph in view; it has no outputs, and its `config` names the scene audio emitter it feeds.

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

**Read-only in v1, per this file's own allowance for descoping editing when it "would exceed
scope":** `AudioGraphCanvas`'s `GraphView` editing callbacks (connect/disconnect/move/drop) all
report to a toast ("Audio-graph editing isn't available yet") rather than dispatching a command. An
`AudioGraphEdit` command factory was considered (this task's brief asked for one "IF the graph shape
maps cleanly onto our command/patch model") and NOT built: `KHR_audio_graph`'s document-level JSON
shape would map onto `editor-core`'s patch model in principle, but the synthetic source/emitter
terminal nodes this projection introduces would need their own non-obvious edit semantics (does
"connect a new node to the emitter terminal" insert into `graph.outputs[]` and rewire the previous
producer, or something else?) that were judged to need real design work, not a mechanical port of
`GraphEdit`'s behavior-graph verbs — out of scope for this milestone. Node selection/details and the
lint banner (below) are real, per this file's "read-only rendering + node selection/details in v1 is
ACCEPTABLE" allowance.

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
stroke rather than hiding them, exactly as this requirement specifies.

## Open questions

- OPEN(UX-audiograph-palette-tbd): whether the audio graph gets its own palette (mirroring
  `specs/ux-graph-canvas.md`'s `UX-500`), reuses/extends the behavior-graph palette, or gains
  node creation through some other flow (e.g. drag-drop from an audio-clip list, Copilot) is not
  decided by this freeze (`UX-604`).
- OPEN(UX-audiograph-position-tbd): `specs/ux-graph-canvas.md`'s `UX-510` pins behavior-graph node
  positions to `node.extras.gltfi.{x,y}` (`DOC-027`) on the glTF `nodes` array; `KHR_audio_graph`
  nodes are not glTF scene nodes, so where their canvas positions are authored/persisted is open.
- OPEN(UX-audiograph-banner-dismiss-tbd): the approved mockup's lint banner has no dismiss
  control; whether it should be dismissible independent of resolving the underlying violation is
  not specified.
