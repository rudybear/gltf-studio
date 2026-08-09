# ux-viewport

Mockup snapshot: `docs/ux/mockups/mockup-v5.html` (approved at UX freeze U4 — see
`docs/ux/README.md`), the center viewport (`#viewport`). The mockup renders the scene with a
fake-but-visual pseudo-3D projection (parallel projection + depth scaling) purely because it is a
static HTML artifact; the requirements below are written against what the viewport must contractually
do, not against that specific rendering technique — the real implementation renders through
`RenderHost` (`specs/render-host.md`).

Owns: no dedicated `specs/ownership.json` glob yet (see `specs/ux-shell.md`'s "Owns" note) — this
surface is governed indirectly via `packages/app/**`'s catch-all mapping until it earns its own
package.

Prefix: `UX`. This file owns the `UX-3xx` block.

## Requirements

### Always-rendered scene

- [UX-300] (active) The viewport always renders the actual current scene (every visible node at its authored transform) — never an abstract/schematic placeholder standing in for it — so that every rendered object is simultaneously the thing being previewed and the thing that is clickable/hoverable per `UX-301`/`UX-302`.

### Hover and click selection

- [UX-301] (active) Hovering a rendered object (that is not the current selection) shows a dashed hover outline around it; moving the pointer off that object (to empty space or a different object) clears the hover outline.
- [UX-302] (active) Clicking a rendered object selects it: a solid outline (for extent-having objects) or a labeled point marker (for point-like objects — lights, camera, audio emitters) is shown at its screen position, labeled with the object's name, and the selection is synchronized to the scene tree, Inspector, and Data tab per `specs/ux-scene-tree.md`'s `UX-202`.
- [UX-303] (active) Clicking empty viewport space (no object under the cursor) clears the current selection everywhere it is reflected — scene tree, Inspector (to its empty state, `specs/ux-inspector.md`'s `UX-412`), and the viewport's own outline/gizmo.

### Gizmo

- [UX-304] (active) The viewport toolbar has exactly three gizmo-mode buttons — W (translate), E (rotate), R (scale) — mutually exclusive, matching `RH-018`'s `GizmoMode` enum (`"translate" | "rotate" | "scale"`) one-to-one.
- [UX-305] (active) Dragging the active gizmo live-updates the selected node's on-screen transform and the Inspector's transform fields continuously during the drag (the "drag" phase, `RH-003`) with no history entry created; releasing the drag commits exactly one undoable `SceneEdit.setTransform` command (the "commit" phase, `RH-003`) via `HistoryStack.push` (`DOC-011`), built per `DOC-007..010`'s `Command` shape.
- [UX-306] (active) Selecting a different node (or a different gizmo mode) while a gizmo is already attached replaces the attached gizmo in place — per `RH-019` — with no separate detach step visible to the user.
- [UX-307] (active) The viewport's selection outline, selection point, and gizmo recompute their screen position whenever the viewport's rendered layout changes (panel resize, window resize) so they never visibly desync from the selected object's on-screen position.

### Camera

- [UX-308] (active) A toolbar control (`⛶`, "Frame selected") frames the current selection in the viewport.

### Play mode

- [UX-309] (active) While play mode is `playing` or `paused`, a "Variables (live)" overlay is shown (bottom-right of the viewport) listing the graph's live variable values; while `playing`, values update continuously as the graph runs.
- [UX-310] (active) Play reconciles with `PlayController`: Play starts play mode (`PC-001`, freezing `EditorDocument` per `DOC-031`); Pause suspends the running simulation (scene animation and the overlay's own timers) without discarding its current variable values, and updates the locked-banner wording to a paused-specific message (`specs/ux-shell.md`'s `UX-106`); Stop ends play mode and reloads the pre-play scene snapshot per `PC-003`, hiding the overlay.
- [UX-311] (active) Any node whose motion is currently driven by play mode (e.g. an in-progress animation clip) pauses that motion in place while paused and resumes from the same point on Play, rather than resetting to its start — motion state is preserved across a pause/resume cycle within one play session.

## Open questions

- RESOLVED(UX-frame-empty-tbd) (by `packages/app`, M2): `UX-308`'s "Frame selected" control frames
  the current selection's bounding box when a node is selected, and the whole loaded scene's
  bounding box when nothing is selected (never a no-op, never disabled) — `ThreeRenderHost.frameNode`
  (see `specs/render-host.md`'s M2 DECISION note) takes the node index or `null` accordingly.
- RESOLVED(RH-snapshot-vs-restore-tbd, carried from `specs/render-host.md`) (by `specs/engine-api.md`'s
  `PC-007`): `UX-310`'s "reloads the pre-play scene snapshot" means the `EditorDocument.json`
  captured at the moment `start()` was called, restored via `renderHost.loadScene()` — not
  `RenderHost.snapshot()`'s rendered-image Blob, which stays scoped to `RH-024`'s own use case.
  Consistent with `PC-003`/`PC-007`.
