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
- [RH-012] (active) A patch is classified as structural if its path's canonical splice root (per `canonicalSpliceRoot`, `specs/document-model.md` DOC-022/DOC-038 — this spec previously cited an earlier `DOC-021` numbering of that same table before it moved) is exactly `/nodes`, `/scenes`, `/scene`, or `/meshes` (i.e. the patch replaces one of these four top-level roots wholesale — a deeper path like `/nodes/2/translation` canonicalizes to `/nodes/2`, not `/nodes`, and is not caught by this rule; see RH-013).
- [RH-013] (active) A patch is classified as non-structural (eligible for `patchScene`'s `"applied"` fast path) if it is a `"replace"` op addressing a scalar or leaf field of an existing element (e.g. a node's TRS, a `KHR_interactivity` graph literal value, an `extras` value) and satisfies neither RH-011, RH-012, nor RH-026.
- [RH-014] (active) `patchScene` classifies every patch in a given batch independently and returns `"needs-reload"` for the whole batch if any single patch in it is structural (all-or-nothing per `patchScene` call).
- [RH-026] (active) A `"replace"`/`"add"` patch is also classified as structural if its `value` is not one of the three-adapter's live-pointer shapes (RESOLVED(RH-pointer-value-tbd)'s `number | boolean | number[] | boolean[]`) — e.g. a string enum such as `KHR_audio_emitter`'s `distanceModel`. Before this rule, such a patch reached the non-structural fast path and threw while coercing its value, which propagated out of `patchScene` into whatever synchronously triggered it (`HistoryStack.push`'s `onApply` notification, per `specs/document-model.md`'s DOC-040) rather than resolving to either `RenderHost` outcome — a caller has no way to catch a mid-`push()` throw without corrupting its own post-`push()` bookkeeping (e.g. `packages/app`'s `dispatchCommand`, whose trailing `set(...)` never ran). Falling back to a full reload is always correct (if occasionally more expensive) for a value shape the adapter has no live path for.

### Pick semantics

- [RH-015] (active) `pick(x, y)` interprets `x` and `y` as normalized device coordinates in the range `[-1, 1]` on both axes, with `+y` pointing up — not viewport-relative pixel coordinates.
- [RH-027] (active) `pick(x, y, options)` accepts an optional `options.ignoreEligibility` flag. When omitted or `false` (the default, and PLAY-mode's select/hover injection ALWAYS uses this default — see `specs/ux-viewport.md`'s Play-mode section), a hit whose nearest node ancestor has `KHR_node_selectability`'s `selectable` resolved to `false` is not returned. When `true` (used only by EDIT-mode viewport click/hover/context-menu, `specs/ux-viewport.md`'s `UX-312`), eligibility is not consulted at all — inherited visibility (`KHR_node_visibility`, unchanged) and nearest-node-ancestor resolution are the only gates, so any visible node can be picked regardless of authored `KHR_node_selectability`/`KHR_node_hoverability`.

### Camera pose

- [RH-016] (active) `CameraPose` is `{ position: [x, y, z], rotation: [x, y, z, w] (quaternion, glTF order), target?: [x, y, z] }` — position plus orientation quaternion is the primary representation; `target` is an optional look-at point for orbit-style controls layered on top.
- [RH-017] (active) Calling `setCameraPose(pose)` followed by `getCameraPose()` returns a pose whose `position` and `rotation` equal what was set (a round-trip); `target`, being optional, may be omitted or derived and is not required to round-trip.

### Gizmo modes

- [RH-018] (active) `GizmoMode` is exactly one of `"translate"`, `"rotate"`, or `"scale"`.
- [RH-019] (active) Calling `attachGizmo(nodeIndex, mode)` while a gizmo is already attached (to the same or a different node, in the same or a different mode) replaces the previously attached gizmo; no separate detach call is required first.
- [RH-025] (active) `RenderHost.detachGizmo()` removes any currently-attached gizmo (the counterpart to `attachGizmo` for the no-selection case, e.g. `specs/ux-viewport.md`'s `UX-303`); calling it when no gizmo is attached does not throw.

### applyPointer delegation and return contract

- [RH-020] (active) `applyPointer(pointer, value)` routes through the same pointer-router family the play-mode `SceneAdapter.applyPointer` fan-out uses, so edit-time inspector writes and play-mode writes exercise identical routing logic.
- [RH-021] (active) `applyPointer` does not itself create a `HistoryStack` entry — it is a live/ephemeral write path; wrapping the resulting change into an undoable command is the caller's responsibility, not `RenderHost`'s.

### Selection/hover highlight

- [RH-022] (active) `setHighlight(nodeIndices)` replaces `RenderHost`'s entire highlighted-node set with exactly the given array of node indices.
- [RH-023] (active) Calling `setHighlight([])` (an empty array) clears all highlighting.

### snapshot()

- [RH-024] (active) `snapshot()` returns a `Promise` that resolves to a PNG-encoded `Blob` captured at the render canvas's current resolution.

## Open questions

- RESOLVED(RH-mount-shape-tbd) (by `engine-three`, M2): `mount(container)` takes an `HTMLElement` the caller owns and does not pre-size — `RenderHost` creates and owns its own child `<canvas>`, appends it to `container`, and keeps it sized to `container`'s content box via a `ResizeObserver` (removed/recreated on `dispose`/re-`mount`, per RH-009). The caller never touches the canvas directly; `snapshot()` (RH-024) is the one sanctioned way to get pixels out.
- RESOLVED(RH-loadscene-shape-tbd) (by `engine-three`, M2): pending `editor-core`'s `EditorDocument`-derived view shape, `engine-three`'s `loadScene(json: unknown)` accepts any of three shapes: (a) a raw GLB `ArrayBuffer`/`Uint8Array`; (b) `{ json: <glTF JSON>, binary?: ArrayBuffer | Uint8Array | null }` (a parsed-container shape mirroring `@gltfi/gltf`'s `GltfDocument`); or (c) a bare, self-contained glTF JSON document (detected by its required top-level `asset` field — buffers inlined as base64 `data:` URIs, glTF's own "embedded" convention, no separate binary blob). All three are re-encoded to one GLB via `@gltfi/gltf`'s `writeGlb` before handing off to `GLTFLoader.parse`, so every input shares one loader path. Shape (c) is what `packages/contract-tests/src/render-host.ts`'s portable fixture uses — the generic contract suite must stay implementation-agnostic, and "plain glTF JSON, no wrapper" is the shape every renderer-backed `RenderHost` is most plausibly able to accept directly. The engine-api type stays `unknown` at this layer (other future `RenderHost` implementations may accept a different shape, or a subset of these three); this note documents `engine-three`'s concrete choice, not a widening of the interface.
- RESOLVED(RH-pointer-value-tbd) (by `engine-three`, M2): `engine-three` accepts exactly the three-adapter's own `PointerValue` union (`number[] | boolean[] | number | boolean`) at runtime and throws a descriptive `TypeError` for anything else; the engine-api type stays `unknown` (per the reasoning above — a future non-three implementation may have a different native value shape).
- RESOLVED(EA-pickresult-shape-tbd) (by `engine-three`, M2): `PickResult` gains a `distance: number` field (the world-space ray length from the camera to `point`, i.e. `THREE.Intersection.distance`) alongside `nodeIndex`/`point`. Barycentric coordinates and material index remain unspecified/omitted — no consumer needs them yet, and they are easy to add as further optional fields later without breaking this shape.
- DECISION (not a spec obligation, noted for implementers): M2's viewport-integration PR adds three `ThreeRenderHost` methods beyond the `RenderHost` interface (same precedent as the pre-existing `getRendererStats()`, itself not mentioned in this spec) — `setHover(nodeIndices)` (a dashed-outline visual distinct from `setHighlight`'s solid one, for `specs/ux-viewport.md`'s `UX-301`, since `RH-022`'s highlighted set is deliberately style-agnostic), `frameNode(nodeIndex | null)` (backs the "Frame selected" toolbar control, `UX-308`, framing the given node's bounding box or, when `null`, the whole loaded scene), and `simulateGizmoDrag(delta)` (test-only: moves the attached gizmo's object and re-fires the same internal `objectChange`/`dragging-changed` events a real pointer drag would, since driving `TransformControls`' screen-space handles from Playwright's synthetic input is impractical — used by `e2e/viewport.spec.ts`'s gizmo-commit coverage in place of a pixel-accurate drag simulation). None of the three widen or change `RenderHost`'s interface; `packages/app`'s `Viewport` calls them directly against the concrete `ThreeRenderHost` type it already imports, the same way it calls `mount`/`loadScene`/etc. through the interface.
- DECISION (not a spec obligation, noted for implementers): `engine-three` mounts a plain `THREE.WebGLRenderer` in v1, not `WebGPURenderer` with WebGL2 auto-fallback (the sibling demo app's choice). An editor viewport that must also run headless in CI (this package's own contract-test suite, `packages/contract-tests/src/render-host.ts`, via `vitest`'s Playwright/Chromium browser mode) is better served by the simpler, more broadly-supported `WebGLRenderer` than by carrying WebGPU's extra init/fallback surface for no v1 editor benefit; nothing in RH-001..RH-024 requires WebGPU specifically. A future `WebGPURenderer` path (if ever wanted) would be additive, not a breaking change to this interface.
- RESOLVED(RH-024 vs. PC-003 tension) (by `specs/engine-api.md`'s `PC-007`): `RenderHost.snapshot()` (RH-024) stays image-only, scoped exactly to RH-024's own rendered-PNG/export use case — it gains no scene-state-capture responsibility. `PlayController.stop()`'s "scene snapshot" restore (PC-003) is a *separate* mechanism: the `EditorDocument.json` captured at the moment `start()` was called, restored via `renderHost.loadScene(capturedJson)`, not via `snapshot()`. See `PC-007` for the full statement.
- DECISION (not a spec obligation, noted for implementers; bug-fix note for `specs/ux-viewport.md`'s `UX-302`/`UX-303`): a fourth beyond-the-interface `ThreeRenderHost` method, `setControlsEnabled(enabled)`, toggles the underlying `OrbitControls` instance on/off. Added because `OrbitControls` has no click-vs-drag threshold of its own — it starts rotating (or, on the right mouse button, panning) the camera on the very first `pointermove` after `pointerdown`, however small. A synthetic `page.mouse.click()` (the only kind `e2e/viewport.spec.ts` used before this fix) presses and releases with zero intervening movement, so no e2e test caught this; a real mouse or trackpad essentially never holds pixel-perfect still between press and release, so the camera had usually already rotated a fraction of a degree away from the pose the user was looking at by the time `pick()` ran — enough to miss whatever appeared to be right under the cursor (the reported "can't select objects in the viewport, only in the scene panel" bug). `packages/app`'s `Viewport` now disables controls on `pointerdown` and re-enables them only once movement crosses a small pixel threshold (a real drag), keeping `pick()`'s camera exactly as it was for anything under that threshold, plus a matching `onClick`/`onContextMenu` guard so a drag that DOES cross the threshold can't also change the selection at its drop point. Regression coverage (real CDP mouse input, default camera, no `setCameraPose`) lives in `e2e/viewport-real-click.spec.ts`, alongside `UX-302`'s own dedicated real-coordinate-click tests on both the single-file and packed-multi-file import paths that `e2e/viewport.spec.ts`'s fixed-camera-pose suite never exercised.
