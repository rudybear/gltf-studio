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
