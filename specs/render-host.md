# render-host

Owns: `packages/engine-api/src/render-host.ts`, `packages/contract-tests/src/render-host.ts` (see
`specs/ownership.json`).

`RenderHost` is the viewport abstraction (Phase A of the program plan): the editor never imports a
rendering library directly, and `engine-three` (the first, three.js-backed implementation) reaches
the viewport only through this interface, by delegating to `buildIndexTables` + the pointer-router
+ Raycaster picking (see the plan's reuse table). This spec supersedes the `RH-###` requirements
that were seeded directly into `specs/engine-api.md` at M0 (RH-001, RH-002, RH-003 move here
verbatim, same IDs, per `specs/README.md`'s "numbers are never reused" rule) and adds the full set
of requirements the seed file called out as a follow-up task.

Prefix: `RH`. Numbers below continue from the three IDs seeded in `specs/engine-api.md`
(RH-001..RH-003); there is no gap to reserve here (unlike that file's PC/AH/AGH/SP prefixes) because
this file now owns the entire `RH` numbering space going forward.

## Requirements

### Moved from specs/engine-api.md (verbatim, same IDs)

- [RH-001] (active) `RenderHost.patchScene(patches)` returns `"needs-reload"` for any structurally changing patch in v1 (the interpreter/renderer does not attempt a live structural splice); non-structural patches apply via the fast path and return `"applied"`.
- [RH-002] (active) The editor must never import a rendering library (three.js or otherwise) directly — all viewport access goes through `RenderHost`, so a second implementation (e.g. gltf-webgpu) can be added later without editor changes.
- [RH-003] (active) `RenderHost.attachGizmo`/`onGizmoChange` distinguishes a `"drag"` phase (live pointer writes, no history entry) from a `"commit"` phase (exactly one `SceneEdit.setTransform` command, undoable) for the same gesture.

### Mount / loadScene / dispose lifecycle

- [RH-004] (active) Calling `mount(container)` a second time on a `RenderHost` that is already mounted does not throw.
- [RH-005] (active) Calling `dispose()` a second time on an already-disposed `RenderHost` does not throw.
- [RH-006] (active) Calling `dispose()` after `mount()` but before any `loadScene()` call does not throw.
- [RH-007] (active) `loadScene(json)`'s returned promise resolves only once the scene is ready to accept `pick`/`patchScene`/`applyPointer` calls.
- [RH-008] (active) Calling `loadScene(json)` again on a `RenderHost` that already has a scene loaded fully replaces the previous scene (the previous scene is torn down before the new one is mounted) rather than requiring an explicit `dispose`+`mount` cycle first.
- [RH-009] (active) Calling `mount(container)` again on a `RenderHost` that is already mounted to a different container detaches from the previous container and attaches to the new one, without leaking the previous DOM attachment.
- [RH-010] (active) Calling `mount(container)` after `dispose()` re-initializes the `RenderHost` for reuse — `dispose()` is not a one-way terminal operation.

### Structural-patch classification

- [RH-011] (active) A patch is classified as structural (`patchScene` must return `"needs-reload"` for it) if its `op` is `"add"`, `"remove"`, or `"move"` on any JSON array, i.e. it changes an array's length or its index-to-element mapping, anywhere in the document.
- [RH-012] (active) A patch is classified as structural if its path's canonical splice root (per DOC-021) is `/nodes`, `/scenes`, `/scene`, or `/meshes`, regardless of its `op`.
- [RH-013] (active) A patch is classified as non-structural (eligible for `patchScene`'s `"applied"` fast path) if it is a `"replace"` op addressing a scalar or leaf field of an existing element (e.g. a node's TRS, a `KHR_interactivity` graph literal value, an `extras` value) and satisfies neither RH-011 nor RH-012.
- [RH-014] (active) `patchScene` classifies every patch in a given batch independently and returns `"needs-reload"` for the whole batch if any single patch in it is structural (all-or-nothing per `patchScene` call).

### Pick semantics

- [RH-015] (active) `pick(x, y)` interprets `x` and `y` as normalized device coordinates in the range `[-1, 1]` on both axes, with `+y` pointing up — not viewport-relative pixel coordinates.

### Camera pose

- [RH-016] (active) `CameraPose` is `{ position: [x, y, z], rotation: [x, y, z, w] (quaternion, glTF order), target?: [x, y, z] }` — position plus orientation quaternion is the primary representation; `target` is an optional look-at point for orbit-style controls layered on top.
- [RH-017] (active) Calling `setCameraPose(pose)` followed by `getCameraPose()` returns a pose whose `position` and `rotation` equal what was set (a round-trip); `target`, being optional, may be omitted or derived and is not required to round-trip.

### Gizmo modes

- [RH-018] (active) `GizmoMode` is exactly one of `"translate"`, `"rotate"`, or `"scale"`.
- [RH-019] (active) Calling `attachGizmo(nodeIndex, mode)` while a gizmo is already attached (to the same or a different node, in the same or a different mode) replaces the previously attached gizmo; no separate detach call is required first.

### applyPointer delegation and return contract

- [RH-020] (active) `applyPointer(pointer, value)` routes through the same pointer-router family the play-mode `SceneAdapter.applyPointer` fan-out uses, so edit-time inspector writes and play-mode writes exercise identical routing logic.
- [RH-021] (active) `applyPointer` does not itself create a `HistoryStack` entry — it is a live/ephemeral write path; wrapping the resulting change into an undoable command is the caller's responsibility, not `RenderHost`'s.

### Selection/hover highlight

- [RH-022] (active) `setHighlight(nodeIndices)` replaces `RenderHost`'s entire highlighted-node set with exactly the given array of node indices.
- [RH-023] (active) Calling `setHighlight([])` (an empty array) clears all highlighting.

### snapshot()

- [RH-024] (active) `snapshot()` returns a `Promise` that resolves to a PNG-encoded `Blob` captured at the render canvas's current resolution.

## Open questions

- OPEN(RH-mount-shape-tbd): `mount`'s parameter remains a bare `HTMLElement`; the plan does not specify further (e.g. whether the caller must pre-size it, or whether `RenderHost` creates its own child canvas vs. taking over an existing one). Lifecycle behavior around it is pinned down (RH-004, RH-009, RH-010) but its shape is not.
- OPEN(RH-loadscene-shape-tbd): `loadScene`'s `json` parameter stays `unknown`, pending `editor-core`'s not-yet-implemented `EditorDocument`-derived view shape (see `specs/document-model.md`).
- OPEN(RH-pointer-value-tbd): `applyPointer`'s `value` parameter stays `unknown`; the reused three-adapter's pointer-router (~35 families) implies a variety of shapes this types-only layer should not prematurely narrow.
- OPEN(EA-pickresult-shape-tbd): `PickResult`'s fields beyond `nodeIndex`/`point` (e.g. distance, barycentric coordinates, material index) are not specified by the plan. (RH-015 resolves `pick`'s *input* coordinate space only, not `PickResult`'s output shape.)
- OPEN: RH-024 resolves `snapshot()`'s shape to a rendered PNG image, exactly as directed. This is in tension with PC-003 (`specs/engine-api.md`), which describes `PlayController.stop()` using "the scene snapshot" to restore pre-play scene *state* (node transforms, etc.) — a 2D image cannot, by itself, functionally restore 3D scene state. This spec does not attempt to resolve that tension; a future `PlayController` spec must either introduce a separate state-capture mechanism for PC-003 or clarify that "restore" there is satisfied by `RenderHost` reloading the original scene JSON rather than by `snapshot()`'s image.
