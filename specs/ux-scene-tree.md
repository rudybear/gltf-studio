# ux-scene-tree

Mockup snapshot: `docs/ux/mockups/mockup-v5.html` (approved at UX freeze U4 — see
`docs/ux/README.md`), left-panel scene tree (`#scene-tree-section`) and asset browser
(`#asset-browser-section`). Layout region bounds and the shared panel chrome are specified in
`specs/ux-shell.md` (`UX-100..102`); this file specifies the tree's own row rendering, selection
sync, the show-indices toggle, the add-menu, the right-click context menu, and the adjacent asset
browser (which shares the left panel and the indices toggle).

Owns: no dedicated `specs/ownership.json` glob yet (see `specs/ux-shell.md`'s "Owns" note) — this
surface is governed indirectly via `packages/app/**`'s catch-all mapping until it earns its own
package.

Prefix: `UX`. This file owns the `UX-2xx` block.

## Requirements

### Hierarchy rendering

- [UX-200] (active) Each tree row is indented `16px` per depth level from its parent, shows a type icon (mesh/light/camera/audio-emitter/group), and — if it has children — a twisty (`▸` collapsed / `▾` expanded); a childless row shows a fixed-width spacer in the twisty's place so labels stay column-aligned.
- [UX-201] (active) Collapsing an ancestor row hides every descendant row regardless of each descendant's own twisty state; re-expanding restores exactly the descendant visibility that was in effect before the collapse.

### Selection sync

- [UX-202] (active) Selecting a node — by clicking its tree row, or by clicking its rendered object in the viewport (`specs/ux-viewport.md`'s `UX-302`) — synchronizes, in the same action: the tree row's highlighted state, the Inspector's content (`specs/ux-inspector.md`), the viewport's selection outline/gizmo, and the Data tab's content to that node's `/nodes/{index}` pointer — without force-switching the bottom dock to the Data tab (see `specs/ux-data-tab.md`'s `UX-804`).

### Show-indices toggle

- [UX-203] (active) A left-panel toggle (`#`) switches a "show glTF indices" mode on/off; while on, every scene-tree row, every Meshes/Materials/Animations asset-browser row, and the pointer-picker's content tree (`specs/ux-pointer-picker.md`) append that entry's array index (`#N`) to its label.
- [UX-204] (active) Show-indices state is session-only: it is not persisted across a reload and always starts off.

### Add menu

- [UX-205] (active) The scene tree's "+ Add" control opens a menu with exactly five entries, in this order: Mesh, Light, Camera, Audio Emitter, Empty Group.
- [UX-206] (active) v1 ships the add-menu's five entries as a stable affordance (`UX-205`); the entries' actual node-creation behavior may be a stub (e.g. a placeholder toast) pending the structural scene-edit commands (`SceneEdit.*`, ADR-0004) landing at M8 — this is called out explicitly so a stubbed menu is not mistaken for a missing requirement.

### Right-click context menu

- [UX-207] (active) Right-clicking a scene-tree row or a viewport object opens a context menu with exactly three actions — Frame, Rename, "✦ Ask Copilot about this…" — positioned at the cursor, and closes on an outside click or Escape.
- [UX-208] (active) Choosing "✦ Ask Copilot about this…" switches the right panel to the Copilot tab and adds exactly one context chip naming the right-clicked object, per `AG-015`'s "same request/response contract, differing only in prefilled context" inline-affordance contract (see `specs/ux-copilot.md`'s `UX-1008`).

### Drag onto the behavior graph

- [UX-209] (active) Dragging a scene-tree row onto the behavior-graph canvas and dropping it opens a drop-menu scoped to that node — `pointer/get`, `pointer/set`, `pointer/interpolate`, `event/onSelect (this node)` — per `specs/ux-graph-canvas.md`'s `UX-509`; choosing an option creates that node in the graph, pre-configured against the dragged node's pointer path.

### Asset browser

- [UX-210] (active) The asset browser has exactly four tabs — Meshes, Materials, Audio Clips, Animations — with one active at a time; the Meshes/Materials/Animations tabs list the document's actual owned entries (e.g. a mesh shared by two scene nodes appears once, not once per referencing node).
- [UX-211] (active) Clicking a Meshes/Materials/Animations row is a deliberate "inspect this" action: it force-switches the bottom dock to the Data tab at that entry's pointer (`/meshes/{i}`, `/materials/{i}`, `/animations/{i}`) — unlike scene-tree/viewport selection (`UX-202`), which updates the Data tab passively.
- [UX-212] (active) Each Animations row has its own preview (`▶`) control that plays a brief preview of that clip without changing the current selection or switching the bottom dock tab.

## Implementation notes (M8/Phase 2)

`UX-207`/`UX-208`'s right-click context menu is now real, built from scratch (no prior PR had landed
any context-menu code despite these requirements predating this work): a new, generic, reusable
`packages/app/src/components/ContextMenu.tsx` (cursor-positioned, dismisses on outside-click or
Escape, mirroring `packages/graph-canvas/src/drop-menu.tsx`'s own backdrop convention) backs it on
both `SceneTree.tsx`'s row `onContextMenu` and `Viewport.tsx`'s viewport-object right-click (reusing
`Viewport.tsx`'s existing `pick()` raycast at the click's NDC coordinates — the same one `onClick`
already uses for left-click selection — so a right-click resolves to whatever object is actually
under the cursor). "Frame" on the scene-tree half routes through a new store-level `frameRequest`
cross-component signal (the scene tree has no reach into the viewport's live `RenderHost`) that
`Viewport.tsx` watches and forwards to its own `frameNode`, the same capability its toolbar's
existing frame button already used; the viewport half calls `frameNode` directly, having the
`RenderHost` reference in hand already. "Rename" is a REAL edit via the already-existing
`SceneEdit.setName` factory in both places — the scene-tree row edits inline; the viewport, having no
natural inline text-field surface over a 3D object, uses a plain `window.prompt` instead (both apply
via the ordinary `dispatchCommand`/undo path, so this is not a stub). "✦ Ask Copilot about this…"
switches the right panel to Copilot and attaches an explicit `{kind:"explicit", pointer:"/nodes/{i}"}`
chip naming the right-clicked node, per `UX-208`/`AG-015`.

## Open questions

- OPEN(UX-add-menu-creation-tbd): `UX-206` intentionally leaves open exactly which add-menu
  entries are wired to real document mutation before M8 lands and which remain stubs; the menu's
  presence and entry set are frozen, its backing behavior is not.
- OPEN(UX-asset-audio-tab-tbd): the approved mockup leaves the Audio Clips tab's rows unwired
  (no click behavior) because clip assets aren't part of the glTF node/mesh/material/accessor
  addressing model the Data tab (`specs/ux-data-tab.md`) currently resolves; whether/how Audio
  Clips rows become inspectable is deferred.
