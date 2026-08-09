# ux-inspector

Mockup snapshot: `docs/ux/mockups/mockup-v5.html` (approved at UX freeze U4 — see
`docs/ux/README.md`), the right panel's Inspector tab (`#inspector-body`). Covers the identity
strip, the Transform/Material/Audio Emitter sections, the v5-introduced Mesh & Primitives section,
the `◈` pointer-shortcut affordance, and the empty state. The right panel's Inspector/Copilot tab
chrome itself is specified by `specs/ux-copilot.md`'s `UX-1000`.

Owns: no dedicated `specs/ownership.json` glob yet (see `specs/ux-shell.md`'s "Owns" note) — this
surface is governed indirectly via `packages/app/**`'s catch-all mapping until it earns its own
package.

Prefix: `UX`. This file owns the `UX-4xx` block.

## Requirements

### Identity strip

- [UX-400] (active) The Inspector's identity strip shows "Node #{index} · {pointer path}" (e.g. `Node #4 · /nodes/4`) plus a copy-path control, for whichever node is currently selected.
- [UX-401] (active) The identity strip renders one chip per fact the selected node's glTF entry actually carries — a `mesh` reference, a `children` list, an `extensions` list — and renders none of the three when the corresponding fact is absent; chips are never shown as empty/disabled placeholders.
- [UX-402] (active) Clicking the copy-path control copies the node's `/nodes/{index}` pointer to the clipboard and confirms the action via a toast (`specs/ux-shell.md`'s `UX-109`).
- [UX-403] (active) Clicking the `mesh` chip scrolls to and briefly highlights the Mesh & Primitives section (`UX-406`); clicking the `children` chip navigates the selection to the node's first child (per `specs/ux-scene-tree.md`'s `UX-202` sync contract); clicking the `extensions` chip scrolls to and briefly highlights the relevant section (e.g. Audio Emitter, `UX-405`).

### Transform / Material / Audio sections

- [UX-404] (active) The Transform section shows Position/Rotation/Scale as three rows of three editable numeric fields (one per axis); each row exposes a `◈` pointer-shortcut button (`UX-410`) revealed on hover/focus.
- [UX-405] (active) A node with a material shows a Material section (base color, metallic, roughness); the metallic and roughness rows each expose a `◈` pointer-shortcut button.
- [UX-406] (active) A node with an audio emitter shows an Audio Emitter section (gain with a `◈` pointer-shortcut button, a distance-model select, and an Audition (`▶`) control that plays a brief local preview without entering play mode — the tune⇄audition loop from `docs/ux/ux-brief.md`).

### Mesh & Primitives section

- [UX-407] (active) A node whose glTF entry has a `mesh` shows a Mesh & Primitives section, positioned between Transform and Material, headed by the mesh's index, name, and primitive count.
- [UX-408] (active) Each primitive renders as a collapsed-by-default disclosure row naming: its material (as a clickable link, `UX-409`), its render mode, its indices accessor and derived triangle count, and — when expanded — a table of its vertex attributes (attribute name → accessor index, type, component type, count).
- [UX-409] (active) Clicking a primitive's material link switches the asset browser to the Materials tab and briefly highlights that material's row (`specs/ux-scene-tree.md`'s asset browser) — it does not switch the bottom dock to the Data tab (that is reserved for a deliberate asset-browser-row click, `specs/ux-scene-tree.md`'s `UX-211`).
- [UX-410] (active) When the selected node's mesh is also referenced by other scene nodes, the Mesh & Primitives section lists those other nodes by name in a "also used by" note beneath the primitive list.

### `◈` pointer shortcuts

- [UX-411] (active) A `◈` pointer-shortcut button opens a small menu with exactly three actions: Copy pointer path, Add pointer/set to graph, Add pointer/interpolate to graph.
- [UX-412] (active) Choosing "Add pointer/set" or "Add pointer/interpolate" creates a node of that kind in the behavior graph, pre-configured with the field's pointer path; it switches the bottom dock to the Behavior graph tab and opens the new node's details card (`specs/ux-graph-canvas.md`'s `UX-507`) so the created node is immediately visible.

### Empty and deferred states

- [UX-413] (active) With no selection, the Inspector shows exactly one "Nothing selected." message and no section content.
- [UX-414] (active) Light and camera nodes show their Transform section plus an explicit note that type-specific properties (light color/intensity/type; camera FOV/clipping) are edited in a later iteration — never a silently missing section with no explanation.

## Open questions

- OPEN(UX-inspector-children-multi-tbd): `UX-403`'s children-chip behavior ("navigate to the
  first child") is a judgment call made by the approved mockup for nodes with more than one
  child; whether a multi-child node should instead show a picker is not specified.
