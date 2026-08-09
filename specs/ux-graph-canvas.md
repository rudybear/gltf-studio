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
- [UX-505] (active) A node with a `config` value shows it in a row below its ports; for `pointer` category nodes, that row's text renders visually distinct (underlined) from a plain label and is paired with a separate `✎` icon button — the text and the icon are always two distinct click targets (`UX-508`).

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

## Open questions

- OPEN(UX-palette-fold-tbd): the approved mockup shows all nine categories flat and unfolded —
  the adopted default for v1 — but whether low-traffic categories (candidates: `type`, `ref`,
  `debug`) should fold into an "advanced" disclosure to reduce palette scroll is an open
  presentation question for a later pass, not resolved by this freeze.
- OPEN(UX-graph-invalid-edge-tbd): the behavior-graph canvas has no example of an invalid/rejected
  edge in the approved mockup (unlike the audio graph, `specs/ux-audio-graph.md`'s `UX-603`);
  whether the same dashed-edge treatment applies here is not specified.
