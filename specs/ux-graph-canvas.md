# ux-graph-canvas

Mockup snapshot: `docs/ux/mockups/mockup-v5.html` (approved at UX freeze U4 — see
`docs/ux/README.md`), the bottom dock's Behavior graph tab (`#graph-palette`, `#graph-canvas`,
`#graph-details`). This file specifies the palette, node/edge rendering, validation surfacing,
drag-drop node creation, and the pointer-config affordances; `specs/ux-audio-graph.md` specifies
the second canvas that reuses this file's rendering contract for `KHR_audio_graph`.

Owns (`specs/ownership.json`): once scaffolded, `packages/graph-canvas/**`.

Prefix: `UX`. This file owns the `UX-5xx` block.

## Requirements

### Palette

- [UX-500] (active) The node palette lists exactly the nine `@gltfi/kernel` registry categories — `event`, `flow`, `variable`, `pointer`, `math`, `type`, `ref`, `animation`, `debug` — each as an independently collapsible group populated with that category's real op ids (e.g. `event/onSelect`, `math/add`).
- [UX-501] (active) The palette search field filters ops live (as-you-type) by op-id substring or category-name match; a category with zero matches after filtering is hidden, and any category with at least one match auto-expands while a query is active.
- [UX-502] (active) A palette toolbar control collapses the palette to a narrow icon rail and restores it, independent of the current search text or expansion state.

### Node and port rendering

- [UX-503] (active) Each graph node renders a header (op id, category name, category-colored left border) with input ports on the left and output ports on the right; a `flow`-typed port renders as a triangle, any value-typed port renders as a colored dot whose color is keyed by that port's value type (e.g. `bool`, `float`, `int`, `ref`, `audio` each have a distinct, consistent color across every node).
- [UX-504] (active) An unconnected value-typed input port that carries a literal default renders that literal inline as a small chip alongside its port dot.
- [UX-505] (active) A node with a `config` value shows it in a row below its ports; for `pointer` category nodes, that row's text renders visually distinct (underlined) from a plain label and is paired with a separate `✎` icon button — the text and the icon are always two distinct click targets (`UX-508`). A `pointer` node's row (and its `✎` icon) renders even before any pointer is configured yet (e.g. added blank from the palette, `UX-500`, which has no path to prefill unlike the Inspector `◈`/scene-tree-drag paths) — showing a `(no pointer set)` placeholder in the text's place — since the icon is that node's only route to ever getting one; the placeholder text itself is a no-op click target (nothing to jump to yet), keeping the two-click-target contract intact either way.

### Validation

- [UX-506] (active) A node with a validation finding shows a corner badge; hovering or focusing the badge reveals a tooltip with the finding's text. Badge presence and tooltip text are associated with a node by that node's id/index in the diagnostics list the validator returns — never by canvas position — so a node reflows or moves without losing or misattributing its badge.

### Node details card

- [UX-507] (active) Clicking a node (anywhere except its pointer-config text or `✎` icon, `UX-508`) opens a details card showing: category, config, and every input/output port with its resolved source/target node and port name, or an explicit "unconnected"/"literal" status when it has none; opening the card also marks that node selected on the canvas, and only one node/details-card pair is selected at a time.

### Drag-drop node creation

- [UX-508] (active) Dragging a scene-tree row or an Animations-tab clip onto the canvas and dropping it opens a drop-menu scoped to what was dragged: a scene node offers `pointer/get`, `pointer/set`, `pointer/interpolate`, `event/onSelect (this node)`; an animation clip offers `animation/start`, `animation/stop`. Choosing an option creates that node at the drop position, pre-configured (e.g. with the dragged node's pointer path, or the clip's name), and opens its details card (`UX-507`).
- [UX-509] (active) Clicking a `pointer`-category node's config **text** switches the bottom dock to the Data tab at that pointer path (a read-only jump, `specs/ux-data-tab.md`); clicking its separate `✎` icon instead opens the pointer-picker dialog (`specs/ux-pointer-picker.md`) to retarget it — these are never triggered by the same click target.

### Node position persistence

- [UX-510] (active) A node's canvas position is the authored `node.extras.gltfi.{x,y}` value (`DOC-027`): it is saved with the document, survives reload, and is undoable through the normal command/patch mechanism — the canvas never derives layout from an ephemeral, editor-only store.

### Inline Copilot affordance

- [UX-511] (active) A `✦` control in the palette header ("Ask Copilot about this graph") switches the right panel to the Copilot tab and adds exactly one context chip naming the current behavior graph, per `AG-015`'s inline-affordance contract (`specs/ux-copilot.md`'s `UX-1008`).

### Handler-node target legibility

- [UX-512] (active) An `event/onSelect`/`onHoverIn`/`onHoverOut` node's card renders a `target: <resolved name> (#N)` row below its ports/config, resolving `configuration.nodeIndex` against the document's actual scene nodes: the registry's own `-1` default renders `target: any node`; a `nodeIndex` that no longer addresses a real scene node (e.g. that scene node was deleted, `DOC-049`) renders `target: ⚠ missing (#N)`; a `stopPropagation: true` config additionally shows a small `stopPropagation` badge in the same row. The resolved-name half of this row is clickable exactly when it resolves to a real scene node — clicking it selects that scene node in the host's own scene-selection state (tree/inspector/viewport all react), complementary to (not a replacement for) the existing graph-node reference highlight (`specs/ux-usage-mapping.md` `UX-1110`), which continues to be driven purely by the current GRAPH-node selection.
- [UX-513] (active) The node-details config editor (`UX-507`) gains a "Target node" selector for `event/onSelect`/`onHoverIn`/`onHoverOut` nodes: a dropdown of every scene node (`name (#index)`, current value marked, plus an explicit "Any node" option for the `-1` sentinel and a disabled placeholder for a dangling current value) that writes the chosen index back as an ordinary undoable config-field command, and a `stopPropagation` checkbox alongside it — both immediately reflected by the card's `UX-512` row, and by graph validation (`UX-506`) if the new value is itself dangling.
- [UX-514] (active) Card-legibility audit: `variable/get`/`variable/set` and `event/send`/`event/receive` node subtitles (already resolved-name, not bare-index, since `M4`) additionally apply the `⚠ missing (...)` treatment when their configured index no longer resolves against the graph's own `variables[]`/`events[]` tables — distinct from a validly-indexed declaration that simply has no `id` set, which is not an error. `animation/start`/`stop`/`stopAt` nodes, which previously showed no card indication of their targeted clip at all, render a `clip: <resolved name> (#N)` row (or the same `⚠ missing` treatment for a dangling index) the same way `UX-512`'s handler-target row does, resolving against the document's `animations[]` list.

### Variables panel (task: "in the node graph there is no way to edit variables")

- [UX-515] (active) A collapsible **Variables panel** (`gcanvas.variables`, collapsed by default to a narrow expand-rail, `gcanvas.variables.expand`/`gcanvas.variables.collapse` — the same collapse/expand convention `UX-507`'s own details panel already establishes) sits in the graph-canvas layout between the node palette and the canvas. Expanded, it lists every `graph.variables[]` entry as one row: an inline-editable **name** (a plain text field, committing on blur — `GraphEdit.renameVariable`, `DOC-055`), a **type** dropdown (`bool`/`int`/`float`/`float2`/`float3`/`float4` — `GraphEdit.setVariableType`, `DOC-055`), a **default value** editor (the SAME typed/color-aware editor `UX-517` below defines, minus color detection — see that requirement's own note on why), a **usage count** (the number of distinct graph nodes referencing that variable, `GraphEdit.countVariableUsage`), and a **delete** button. A **"+ Add variable"** control appends a fresh, unreferenced `bool`-typed variable, immediately editable via its own row's name field.
- [UX-516] (active) Deleting a variable that is still referenced (usage count > 0, `DOC-055`'s block-when-used policy) is **prevented**: the row's delete button is disabled, with a title/tooltip stating the exact usage count, and clicking it anyway (were it not disabled — the same defense-in-depth `GraphEdit.removeVariable` itself throws `VariableInUseError` for) surfaces that error's message as a toast rather than silently failing or producing a dangling reference. Deleting an UNUSED variable removes it and shifts every surviving variable-index reference above it down by one, as a single undo/redo step. The Variables panel additionally renders a parallel, smaller **Custom events** section (`graph.events[]`: name + usage count + delete, `GraphEdit.renameCustomEvent`/`removeCustomEvent`, same block-when-used policy) directly below the variables table — declare/rename/delete only, since an event carries no type/default to edit.
- [UX-518] (active) Clicking a variable's or event's usage-count chip selects the first graph node referencing it (`onSelectNode`, the same single-selection state the canvas/details panel already share) — a minimal "jump to a reference" affordance, not a multi-node highlight-all (the existing single-selection contract has no such mode); the chip is inert (no click handler) when the count is zero.

### Typed literal editors incl. color pickers (task: "for such cases as input for material when we clearly know this is color, we can add color pickers")

- [UX-517] (active) Both `op-node.tsx`'s inline canvas-card editor (`UX-504`) and `node-details.tsx`'s side-panel `Ports` table (`UX-507`) gain a TYPE-AWARE `bool`/`int`/`float` editor — checkbox / integer-stepped number input / plain number input respectively — sharing one implementation (`literal-editors.tsx`'s `TypedLiteralEditor`) so the two surfaces can never disagree on which SCALAR types are editable (this part is behavior-preserving: it was already true before this task, just now backed by one shared component instead of two independent ones). The side panel ADDITIONALLY renders `float2`/`float3`/`float4` as that many grouped, `x`/`y`/`z`/`w`-labeled numeric inputs (previously these vector types had no editor at all in EITHER surface, only the compact `= [1, 2, 3]` text chip / `literal: [1, 2, 3]` status line) — the canvas card deliberately does NOT gain general vector editing (see `UX-519`'s own note on why: a specific, already-e2e-covered fixture depends on one vector socket still rendering as a plain chip there).
- [UX-519] (active) A `pointer/set`/`pointer/interpolate` node's "value" input socket renders a **color picker** (an `<input type="color">` swatch, plus an alpha slider for a `float4` target) instead of plain numeric display, in BOTH the canvas card and the side panel, WHEN that node's resolved pointer path names a known color property — `pbrMetallicRoughness/baseColorFactor` (RGBA), a material's `emissiveFactor` (RGB), or a `KHR_lights_punctual` light's `color` (RGB); detection is PATH-driven (`color-field.tsx`'s `colorKindForPointerPath`, mirroring `packages/app/src/lib/pointer-vocab.ts`'s canonical definition — see that pair's own doc comments for the cross-package-mirroring rationale and the exact, intentionally non-exhaustive path list), never type-driven alone. The canvas card's general vector editing is otherwise SCOPED TO COLOR ONLY (`UX-517`): a plain `float3`/`float4` target with no known color meaning (e.g. `translation`, `scale` — including `e2e/graph-canvas.spec.ts`'s own play-scene.glb pointer/set-to-translation fixture) keeps rendering the pre-existing `= [...]` text chip there, unchanged; the side panel has no such constraint and renders the full grouped-numeric-or-color editor for every vector socket regardless of color. A small toggle (`#`/`●` button alongside the field) switches between the color picker and the grouped-numeric fallback for the SAME socket, per this task's "with numeric fallback toggle" instruction. Every edit from either widget commits through the existing `setLiteral`-backed command (`graph-edit-ext.ts`'s `setLiteralValue`) — the same undo/redo step a plain numeric edit already produced, nothing new added to the command layer for color specifically.
- [UX-520] (active) The Variables panel's (`UX-515`) default-value editor reuses `UX-517`'s SAME `TypedLiteralEditor`, but NEVER shows a color picker: a declared variable has no pointer PATH for `colorKindForPointerPath` to resolve against (color detection is path-driven, `UX-519`) — a `float3`/`float4` variable's default value always renders as grouped numeric fields, even when that variable happens to be USED to drive a color-typed pointer/set elsewhere in the graph. This is a deliberate, documented limitation (not an oversight): inferring "this variable is semantically a color" from its downstream usage would require a cross-node data-flow analysis this feature does not attempt.

## Implementation notes (handler-node target legibility)

`UX-512`/`UX-513`/`UX-514` (bug report: handler nodes gave "no way to understand which [scene] node they attached to" — reproduced on the R4 Racer starter asset's pad `onSelect`/`onHoverIn`/`onHoverOut` handlers): `map-graph.ts`'s pure `mapGraph` stays pure over the graph object alone — it now additionally extracts `MappedNode.handlerTarget` (`{nodeIndex, stopPropagation}`, straight off `configuration`, no document access) and a `subtitleMissing` flag alongside the existing `subtitle`. Resolving `handlerTarget.nodeIndex`/an `animation/*` node's literal clip index against the document's REAL scene-node/animation lists is a render-time concern, threaded down as a small optional `docNames: { sceneNodeNames, animationNames }` prop (`op-node.tsx`, `graph-view.tsx`) rather than widening `mapGraph`'s own contract or giving it a `document.json` dependency — `graph-canvas.tsx` computes both name lists off `document.json` (same `name ?? "Node {i}"`/`"Animation {i}"` fallback convention `packages/app`'s `Viewport.tsx`/`revealSceneNodeInViewport` already use) the same way it already computed `animationNames` for the pre-existing animation-clip selector. The target chip's click handler is a new optional `GraphCanvasProps.onSelectSceneNode`, wired by `packages/app`'s `BehaviorGraphPanel.tsx` straight to the app store's existing `selectNode` action — no new store action needed. `@gltfi/verify`'s `validateGraph` only ever sees the isolated graph object, so it can never itself flag a dangling handler target (it has no way to know the document's scene-node count); `validation.ts`'s `validateInteractivityGraph` gained an optional second `sceneNodeCount` parameter (supplied by `graph-canvas.tsx`, omitted by `packages/agent-mock`'s isolated-graph caller) that runs one additional doc-level check (`GCANVAS-HANDLER-TARGET-MISSING`, `warning` severity) for exactly this case, joined into the same per-node diagnostics map `UX-506`'s badge already renders from. `@gltf-studio/audio-canvas`'s reuse of `GraphView`/`NodeDetails` (`specs/ux-audio-graph.md` `UX-600`) is unaffected — `docNames`/`onSelectSceneNode`/`sceneNodeNames` are all optional and that package's `KHR_audio_graph` nodes never set `handlerTarget` in the first place.

## Implementation notes (M4)

`packages/graph-canvas` (this file's owned package, per `specs/ownership.json`) first lands in M4
with the canvas itself plus editing (add/connect/disconnect/delete/drag/literal-edit, all real
`GraphEdit` commands) and the validation overlay. Coverage against this file's requirements:
`UX-500`, `UX-501`, `UX-503`, `UX-504`, `UX-506`, `UX-507`, and `UX-510` are implemented and
e2e-covered (`e2e/graph-canvas.spec.ts`). `UX-502` (palette rail toggle) is implemented but not yet
e2e-covered.

A follow-up M4 change (pointer picker + drag-to-graph + config editors) completes the rest:
`UX-505`'s two click targets now do real work — the `✎` icon calls `onOpenPointerPicker` (a new
`GraphCanvasProps` callback `packages/app`'s `BehaviorGraphPanel` wires to
`specs/ux-pointer-picker.md`'s dialog, preselecting via the resolved "value" port's type per
`UX-907`), and the pointer-config text calls `onJumpToData` (wired to the store's
`jumpToDataFromGraph`, `specs/ux-data-tab.md`'s `UX-806` force-switch). `UX-508`'s drop-menu is
implemented (`drop-menu.tsx`, driven by `graph-view.tsx`'s HTML5-drop handling of the
`application/x-scenenode`/`application/x-animclip` MIME types `packages/app`'s
`SceneTree.tsx`/`AssetBrowser.tsx` now set as drag sources) with a `simulateExternalDrop` test hook
(same rationale as `simulateConnect`) covering the drag gesture only — the drop-menu option click
stays real. `UX-509` is fully wired (both halves above). The node-details panel also gained a
config-field editor (variable/event dropdown selectors with "+ new…" flows, a pointer node's
"Retarget…" button routing through the same picker dialog, an animation-clip selector for
`animation/start|stop`'s `values.animation`, and a generic key/value fallback for every other
config field) — not itself a numbered requirement in this file, but the mechanism `UX-505`'s
pointer retarget and this drop-menu's created nodes both build on.

`UX-511` (inline Copilot affordance's context-chip half — the tab-switch half already worked) is now
also implemented, as of the M8/Phase 2 Copilot UI work: `packages/app/src/components/dock/
BehaviorGraphPanel.tsx`'s `onAskCopilot` callback (passed to `<GraphCanvas>`'s `onAskCopilot` prop,
which this package's own `palette-panel.tsx` invokes from its header `✦` control) now ALSO calls the
app store's `addCopilotContextChip` with an `{kind:"explicit", ...}` ref naming the current graph
(`Graph {selectedGraphIndex}`, pointing at `/extensions/KHR_interactivity/graphs/{graphIndex}`),
alongside the pre-existing `setActiveRightTab("copilot")` tab switch — entirely in `packages/app`,
with no change to this package's own `palette-panel.tsx`/`GraphCanvasProps` contract.

## Implementation notes (M7)

`specs/ux-audio-graph.md`'s `UX-600` requires the audio-graph canvas to reuse "the identical engine
and contract" this file specifies, rather than a second rendering implementation. To make that
literal (not just similar-looking), M7 widens three of this package's own internal types/exports
rather than duplicating them in `@gltf-studio/audio-canvas`:

- `MappedNode.category` (`map-graph.ts`) widened from `OpCategory | "unknown"` to a plain `string`
  — `@gltfi/kernel`'s `OpCategory` registry has no `"audio"` member, and never should (audio-graph
  nodes are not `KHR_interactivity` ops). Every existing `OpCategory` value is still a valid
  `string`, so this is source-compatible for this package's own `mapGraph` output.
- `MappedNode.raw` widened from `InteractivityNode` to `unknown` for the same reason (audio-graph's
  raw node shape is a `KHRGraphNodeSpec`, not an `InteractivityNode`); `node-details.tsx`'s one read
  of it now defends with a local cast instead of assuming the interactivity shape.
- `MappedEdge` gained an optional `invalid?: boolean` field, rendered as a dashed stroke by
  `graph-view.tsx` when set (`specs/ux-audio-graph.md`'s `UX-603`) — always `undefined`/falsy for
  this package's own `mapGraph` output, so no behavior-graph rendering changes. This does NOT
  resolve `OPEN(UX-graph-invalid-edge-tbd)` below (the plumbing now exists; nothing in this package
  sets the flag on a behavior-graph edge).
- `GraphView`/`NodeDetails` (previously internal to this package, used only by `graph-canvas.tsx`)
  are now exported from `index.ts` so `@gltf-studio/audio-canvas` can render its own mapped
  `KHR_audio_graph` output through the same two components, read-only (see
  `specs/ux-audio-graph.md`'s implementation notes for what "read-only" covers there).
- `palette.ts`'s `CATEGORY_COLORS`/`categoryColor` gained one new fixed entry (`"audio"`) plus a
  deterministic hash-based fallback color for any category string outside the fixed map, replacing
  the previous flat "anything unrecognized is gray" fallback.

## Implementation notes (usage mapping)

`specs/ux-usage-mapping.md`'s `UX-1107`/`UX-1110`/`UX-1111` add two small, additive surfaces to
this package, both consumed by `packages/app` (the Inspector's "Used in behavior" section and the
viewport's reference highlight — this package has no Inspector/viewport of its own):

- `GraphView`/`GraphCanvas` gain an optional `focusRequest?: { nodeIndex: number; seq: number } |
  null` prop (`UX-1107`'s "programmatic focus API"): `graph-view.tsx` watches it and calls React
  Flow's own `fitView({ nodes: [{ id }], duration, maxZoom })`, panning/zooming the canvas to a
  node that may not already be on-screen — the same cross-component-signal shape (a bumped `seq`
  so re-requesting the same node twice still re-fires) `packages/app`'s own `frameRequest` already
  established for the viewport's "Frame" action. This is deliberately NOT selection — the caller
  (`packages/app`'s Inspector) calls the existing `onSelectNode` separately; `focusRequest` only
  solves the "isn't already visible" half selection state alone can't.
- `NodeDetails` gains an optional `sceneRef: number | null` + `onRevealInViewport?:
  (sceneNodeIndex: number) => void`: `graph-canvas.tsx` computes `sceneRef` for the selected node
  via `@gltf-studio/usage-index`'s `graphNodeSceneRef` (the exact same resolution rule
  `specs/ux-usage-mapping.md`'s reverse usage index is built from, run forward) and shows a "Reveal
  in viewport" button (`gcanvas.details.reveal`) whenever it resolves to a real scene node. This
  package owns none of the actual highlighting — the reference-highlight OUTLINE itself (`UX-1110`)
  is driven purely by `packages/app`'s existing `selectedGraphNodeIndex`/`selectedGraphIndex` store
  state one layer up (`Viewport.tsx`/`SceneTree.tsx` each derive the same `graphNodeSceneRef` result
  independently, via a shared `referenceHighlightSceneNodeIndex()` store getter — see
  `specs/ux-shell.md`'s own usage-mapping implementation note) — this button's own job is purely
  camera framing (`RenderHost.frameNode`/`UX-308`'s existing `frameRequest` mechanism) plus a
  confirmation toast, since the outline is already visible for as long as the details card is open.

## Implementation notes (bug fix)

Follow-up (hidden-mount `fitView`, found auditing `specs/ux-shell.md`'s M5 Script-tab sizing bug for
the same "measures 0 because the dock kept it mounted-but-hidden" class of bug across every dock
tab): `specs/ux-shell.md`'s M4 note above already establishes that `BottomDock` keeps this package's
whole canvas subtree permanently mounted, `display: none`-hiding it (not conditionally rendering it)
while another dock tab is active, specifically so `UX-103`'s "don't reset the tab being left" state
survives a tab switch. `<ReactFlow fitView>` (`graph-view.tsx`) only computes its initial fit ONCE,
on this component's first real layout pass — when a document is imported (or re-imported) while the
Behavior graph tab isn't the active one, that first pass lands against a `display: none` (0×0)
container, so the fit is computed from a degenerate box: nodes render pinned into one corner at the
wrong scale, and switching to the tab afterward does not self-correct (React Flow's own internal
pane `ResizeObserver` repositions the SVG viewBox on later size changes but never re-runs `fitView`
itself). Fixed with a `ResizeObserver` on the canvas's own root node that watches for its first-ever
non-zero size and calls `reactFlow.fitView()` at that point — gated to fire at most once per mount
(`didInitialRealFitRef`) so a later legitimate tab-away-and-back does NOT re-run `fitView` and wipe
the user's own pan/zoom, which would otherwise quietly violate `UX-103`'s own "graph canvas scroll
position" example of state a tab switch must preserve.

Follow-up (socket/label overlap, reported directly against the built app): every port row's Handle
(`op-node.tsx`'s `<Handle>`, a React Flow port) sat with its near half directly under the first
character of the label on input (west) rows and the last character on output (east) rows, in both
themes, at every zoom level, on every node checked (flow and value ports, plain labels and literal
chips) — a `<Handle>` is `position: absolute` (react-flow's own `.react-flow__handle-left`/`-right`
CSS pins it via `left: 0`/`right: 0` to its row's padding-box edge), so it was never part of the
row's flex flow and the row's own `gap` never applied to it; with no compensating padding on the row
itself, the label's in-flow content started flush at that same edge. Fixed by adding `padding-left`
(west) / `padding-right` (east) directly to `.gcanvas-op-row-west`/`-east` (`graph-canvas.css`) — 12px
leaves an 8px visible gap past the handle's 4px near-half. Padding on the SAME element the Handle is
positioned against only shifts the row's in-flow content, never the Handle's own anchor, so this
cannot move where an edge visually terminates (confirmed by capturing a connected edge's rendered
SVG path before and after the change: pixel-identical). Regression coverage in
`e2e/graph-canvas.spec.ts`'s "port handle/label overlap regression" describe block: real
`getBoundingClientRect()` non-intersection checks on an input row, an output row (including
`event/onSelect`'s `selectionRayOrigin`, the longest value-out socket name in the whole op registry),
and a literal-chip row (an unconnected non-editable-scalar value-in, e.g. `pointer/set`'s float3
`value`), at zoom 1 and 1.5, plus a pixel-level scan (`e2e/visual-assert.ts`'s
`assertHandleLabelPixelGap`) confirming a real background-colored gap exists between the handle and
the label in both themes — not just that their boxes are technically disjoint.

Follow-up (task #33, deflaking `e2e/graph-canvas.spec.ts`'s selection/connect tests): a freshly-
rendered op node is laid out at ELK's ESTIMATED width/height (`elk-layout.ts`'s `estimateNodeSize`,
a text/port-row-count heuristic ELK needs before the real DOM exists) and only corrected to its real
measured DOM size a tick later by React Flow's own internal `ResizeObserver` — this file's own tests
had carried widened timeouts (up to 180000ms) against this since M4/M8, on the theory that the click
-> `onSelectNode` -> re-render round trip was merely slow under heavy Playwright worker parallelism.
Reproduced offline instead (artificial CPU contention pinned to the same 4 cores as a `--workers=2`
Playwright run, matching CI's own 4-vCPU/2-worker budget): `.click()`'s default target (a node's
geometric center) computed against that resize cascade can land on a child element instead of the
node's own chrome — concretely `op-node.tsx`'s literal-input row, whose own `onClick={(e) =>
e.stopPropagation()}` (there so editing a literal doesn't ALSO reselect the node) then silently
swallows the click before it reaches React Flow's node-click delegation; separately, connecting
to/from a Handle on a still-settling node can leave that edge's rendered path permanently missing.
Neither is a timing issue a longer wait fixes — a swallowed click or a mis-measured Handle position
doesn't self-heal. Fixed with a new `nodesDimensionsSettled()` method on the existing
`__gltfStudioGraphCanvasTest` test-only seam (a debounced readiness check: true once no node's
measured size has changed for 300ms, not a fixed guess) the spec awaits before any bounding-box-
dependent interaction, plus clicking node headers (`.gcanvas-op-header`, a fixed content-independent
strip, `NODE_METRICS.headerHeight`) instead of a node's own testid for selection — closing the
geometry half the readiness wait alone doesn't. Verified stable across 190+ `--repeat-each` runs
under the same artificial contention with zero failures, after first confirming its absence reliably
reproduced the original flake.

## Open questions

- OPEN(UX-palette-fold-tbd): the approved mockup shows all nine categories flat and unfolded —
  the adopted default for v1 — but whether low-traffic categories (candidates: `type`, `ref`,
  `debug`) should fold into an "advanced" disclosure to reduce palette scroll is an open
  presentation question for a later pass, not resolved by this freeze.
- OPEN(UX-graph-invalid-edge-tbd): the behavior-graph canvas has no example of an invalid/rejected
  edge in the approved mockup (unlike the audio graph, `specs/ux-audio-graph.md`'s `UX-603`);
  whether the same dashed-edge treatment applies here is not specified.
