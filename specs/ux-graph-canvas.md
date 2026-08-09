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

## Open questions

- OPEN(UX-palette-fold-tbd): the approved mockup shows all nine categories flat and unfolded —
  the adopted default for v1 — but whether low-traffic categories (candidates: `type`, `ref`,
  `debug`) should fold into an "advanced" disclosure to reduce palette scroll is an open
  presentation question for a later pass, not resolved by this freeze.
- OPEN(UX-graph-invalid-edge-tbd): the behavior-graph canvas has no example of an invalid/rejected
  edge in the approved mockup (unlike the audio graph, `specs/ux-audio-graph.md`'s `UX-603`);
  whether the same dashed-edge treatment applies here is not specified.
