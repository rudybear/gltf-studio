# ux-data-tab

Mockup snapshot: `docs/ux/mockups/mockup-v5.html` (approved at UX freeze U4 — see
`docs/ux/README.md`), the bottom dock's Data (glTF) tab (`.data-breadcrumb`, `.data-view`),
introduced in v5 as the addressing-model surface: a read-only view of the raw authored glTF JSON
around whatever pointer path the rest of the editor last pointed at.

Owns: no dedicated `specs/ownership.json` glob yet (see `specs/ux-shell.md`'s "Owns" note) — this
surface is governed indirectly via `packages/app/**`'s catch-all mapping until it earns its own
package.

Prefix: `UX`. This file owns the `UX-8xx` block.

## Requirements

### Breadcrumb and subtree view

- [UX-800] (active) A breadcrumb shows the current container pointer's path segments; numeric (array-index) segments are clickable links that re-navigate the tab to that ancestor container, and non-numeric segments render as static text.
- [UX-801] (active) The current container's own properties render as indented `key: value` lines; a nested object or array value is collapsed behind a per-line `▸`/`▾` twisty (collapsed by default), and the expand/collapse state resets whenever the container itself changes (it is not preserved across a navigation to a different container).
- [UX-802] (active) A numeric value under a recognized cross-reference key (a node's `mesh` or `material` index, or an animation channel target's `node` index) renders as a clickable link that navigates the tab to that referenced container, rather than as a plain number.
- [UX-803] (active) Navigating to a pointer that names a specific property one level inside a container (not just the container as a whole) highlights that property's line and scrolls it into view.
- [UX-804] (active) The tab has no editing affordance in this freeze's scope — it is a read-only presentation of the authored glTF JSON.

### Selection sync

- [UX-805] (active) Selecting a node via the scene tree or the viewport (`specs/ux-scene-tree.md`'s `UX-202`) updates the Data tab's content to that node's container but does **not** switch the bottom dock to the Data tab — the update is passive, so it doesn't steal focus from whatever tab (e.g. mid-graph-editing) the user is actually looking at.
- [UX-806] (active) Selecting a Meshes/Materials/Animations asset-browser row (`specs/ux-scene-tree.md`'s `UX-211`) and clicking a graph node's pointer-config text (`specs/ux-graph-canvas.md`'s `UX-509`) are both deliberate "inspect this" actions and **do** force-switch the bottom dock to the Data tab, unlike `UX-805`'s passive update.
- [UX-807] (active) The Data tab always reflects the single most recently pointed-at container, regardless of which surface (passive or forced) produced that pointer — there is no per-surface memory of "what the Data tab last showed for the tree" vs. "for the asset browser."

## Open questions

_None at freeze time — the addressing model this tab exposes is deliberately narrow (a fixed set
of container shapes plus one optional highlighted property, per the approved mockup's
`resolveDataContainer`), not a general JSON-pointer walker; extending it to arbitrary pointer
depths is future scope, not an open question this freeze needs to answer._
