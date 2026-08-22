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
- [RH-031] (active) `attachGizmo(nodeIndex, mode)` still throws if called before `mount()`/`loadScene()` (no scene loaded at all), but calling it with a `nodeIndex` that does not (yet) exist in the CURRENTLY loaded scene's node table detaches any existing gizmo and returns, rather than throwing — the same "skip what can't be resolved, don't error" tolerance `setHighlight`/`setReferenceHighlight` (`RH-022`/`RH-029`) already give an unresolvable index, needed because a caller can legitimately select a node in the same tick a structural edit that hasn't finished its async reload yet created it (`specs/ux-scene-tree.md`'s `UX-213`).

### applyPointer delegation and return contract

- [RH-020] (active) `applyPointer(pointer, value)` routes through the same pointer-router family the play-mode `SceneAdapter.applyPointer` fan-out uses, so edit-time inspector writes and play-mode writes exercise identical routing logic.
- [RH-021] (active) `applyPointer` does not itself create a `HistoryStack` entry — it is a live/ephemeral write path; wrapping the resulting change into an undoable command is the caller's responsibility, not `RenderHost`'s.

### Selection/hover highlight

- [RH-022] (active) `setHighlight(nodeIndices)` replaces `RenderHost`'s entire highlighted-node set with exactly the given array of node indices.
- [RH-023] (active) Calling `setHighlight([])` (an empty array) clears all highlighting.

### Reference highlight (usage mapping)

- [RH-029] (active) `setReferenceHighlight(nodeIndices)` is a THIRD highlighted-node set, independent of `setHighlight`'s own (`RH-022`): it replaces `RenderHost`'s entire reference-highlighted set with exactly the given array of node indices, rendered in a style visually distinct from both the selection highlight and the hover outline, and coexists with both — a node may be selected, hovered, and reference-highlighted at the same time, each its own visible outline (`specs/ux-usage-mapping.md`'s `UX-1110`).
- [RH-030] (active) Calling `setReferenceHighlight([])` clears all reference highlighting without altering whatever `setHighlight`'s own set currently holds (mirrors `RH-023` for this new tier).

### snapshot()

- [RH-024] (active) `snapshot()` returns a `Promise` that resolves to a PNG-encoded `Blob` captured at the render canvas's current resolution.

### Editor helpers (RH-032..RH-034 — full punctual-light control's shared editor-overlay seam)

- [RH-032] (active) `RenderHost.setEditorHelpers(descriptors: EditorHelperDescriptor[])` REPLACES the entire set of editor-only helper visuals a `RenderHost` may render, keyed by `{kind, nodeIndex}` — the same whole-set-replace convention `setHighlight`/`setReferenceHighlight` (RH-022/RH-029) already establish. `EditorHelperKind` is deliberately an OPEN string union (`"light" | (string & {})`, `packages/engine-api/src/value-types.ts`) rather than a closed one: one shared method serves every present and future helper family (lights today; `@gltf-studio/audio-webaudio`'s own audio-emitter/listener helpers are an anticipated follow-up) instead of a new interface method per family. An implementation MUST silently skip (never throw for) any descriptor whose `kind` it doesn't recognize, and any `nodeIndex` that doesn't resolve in the currently loaded scene — the same tolerance `setHighlight`'s/`attachGizmo`'s (RH-031) own unresolvable-index handling already gives. `engine-three`'s v1 implementation recognizes only `"light"`: it resolves `nodeIndex` to its live `THREE.Light` object (GLTFLoader makes the light object itself the node's own `Object3D` when the light is that node's ONLY attachment, or a child of a wrapping `Group` when the node has multiple attachments — both cases checked) and attaches the matching stock three.js helper class — `THREE.PointLightHelper`/`THREE.SpotLightHelper`/`THREE.DirectionalLightHelper` per the light's own type — to a dedicated `editorHelperGroup` scene child, updated every render-loop frame (`.update()`) so a live `patchScene`/`applyPointer` color/cone/range write reflects in the helper's own shape immediately.
- [RH-033] (active) `setEditorHelpers([])` clears every currently-shown helper (and disposes each one's three.js-side geometry/material — no GPU-resource leak across repeated calls, mirroring RH-008's own loadScene leak-discipline bar) without throwing.
- [RH-034] (active) Editor helpers (RH-032) are EDITOR-ONLY three.js-scene objects: they are never written to the document JSON (`setEditorHelpers` only ever creates/removes local `THREE.Object3D`s — there is no code path from it to `patchScene`/`this.currentJson` at all, so this guarantee holds by construction, not by a separate check) and, in `engine-three`, are excluded from the image `snapshot()` (RH-024) resolves to: the dedicated `editorHelperGroup` is hidden for exactly the one render call `snapshot()` makes, then restored to whatever visibility it had immediately after — cheap to do exactly right because every helper lives in that one group and nowhere else. (This does NOT extend to the grid/selection/hover/reference-highlight helpers, which stay visible in a captured snapshot exactly as before this change — a pre-existing, separately-tracked gap this requirement does not newly introduce, widen, or claim to fix.)

## Implementation notes

- Full punctual-light control — neutral studio-rig AUTO policy (not a new `RH-###` requirement:
  `ThreeRenderHost`'s neutral studio rig — a `HemisphereLight` + `DirectionalLight` "key light" pair,
  added unconditionally since M2 so an asset with no authored lights of its own still renders
  something — was never previously gated on anything; it stayed on even for a document that DOES
  carry real `KHR_lights_punctual` lights, additively washing out the authored lighting truth. Every
  `loadScene()` call now recomputes each light's intensity to either its full-strength default or
  `STUDIO_DIM_FACTOR` (0.15) of it, per `documentHasPunctualLights(json)` — AUTO: dimmed when the
  document has at least one real light, full strength otherwise. **DIMMED, never fully hidden
  (`.visible = false`)** — an earlier version of this change did hide the rig outright and broke
  a real, pre-existing e2e fixture (`e2e/global-setup.ts`'s "KeyLight", a bare `{type:"point"}` with
  no real intensity, co-located with the exact surface it nominally lights — a genuinely degenerate
  near-zero-distance case that stayed adequately visible ONLY because the (until-then-always-on)
  studio rig was doing the real illumination work; several `e2e/viewport-real-click.spec.ts` tests
  that locate the rendered object by scanning pixels, rather than a fixed known camera pose, failed
  outright once the rig vanished for that fixture). Raising that one light's OWN intensity alone did
  not fix it either (tried: `intensity: 200`) — the light sits inside the surface's own plane, not
  merely close to it, which is a shading degeneracy no intensity value fixes, and its POSITION cannot
  move (`e2e/scene-tree-reparent-world-position.spec.ts` asserts it starts at the origin). A modest,
  nonzero DIM floor sidesteps the whole class of "the one authored light happens to be
  unusable/degenerate" case while still making a REAL authored light's own contribution clearly
  dominant, satisfying `specs/ux-viewport.md`'s `UX-313` "authored lighting is the visible truth"
  intent without an all-or-nothing gamble on every document's authored light actually being usable.
  Two new non-interface `ThreeRenderHost` methods (same "public but not part of `RenderHost`"
  convention as `setControlsEnabled`/`frameNode`/`getRendererStats`): `setStudioLightingEnabled
  (enabled)` manually overrides the CURRENT scene's rig strength — `true` full, `false` dimmed —
  (backs `specs/ux-viewport.md`'s `UX-313` toolbar toggle) and `getStudioLightingEnabled()` reads it
  back. Deliberate v1 simplicity choice, not an oversight: a manual override does NOT survive the
  next `loadScene` call (including an in-place structural-patch reload) — AUTO recomputes fresh every
  time, unconditionally superseding whatever the toggle was set to. `UX-313` owns the full user-facing
  policy statement and the toggle's own behavior; this note exists so the `packages/engine-three/**`
  ownership-drift obligation (this file owns that whole package glob) is satisfied honestly for a
  behavior that has no interface-level requirement ID of its own.
- Bug fix (M8-lite, `specs/ux-scene-tree.md`'s add-menu real-content change): making the scene tree's "+ Add" menu auto-select a freshly created node (`UX-213`) surfaced a latent race — `Viewport.tsx`'s gizmo-attach effect re-runs on every `selectedNodeIndex` change, but a structural command's `patchScene` -> `loadScene` reload (`RH-011`..`RH-014`) is async, so the effect could fire against the STALE pre-reload node table a moment before the new index existed in it. `attachGizmo` used to throw in that case (`RH-031` above resolves it to a tolerant no-op instead, mirroring `setHighlight`'s convention) and `packages/app/src/components/viewport/Viewport.tsx` gained a `reloadSeq` counter (bumped once a `needs-reload` reload's `loadScene()` promise actually resolves) in the gizmo/selection-highlight/hover effects' dependency arrays, so they get a reactive reason to re-run once the new node genuinely exists — the gizmo/highlight still end up attached to the new node moments later, not just silently dropped.
- Richer inspector (`specs/ux-inspector.md`'s `UX-415`/`UX-416`): two material patch shapes the
  vendored `@gltfi/three-adapter`'s own pointer-router has no row for at all — `doubleSided`
  (`add`/`replace`, a boolean IS a valid non-structural `PointerValue`, so it reaches
  `applyNonStructuralPatch` but the router doesn't recognize the path) and a texture-info slot
  CLEAR (a `remove` patch — `applyNonStructuralPatch`'s pre-existing op guard only ever forwarded
  `add`/`replace` to the router; `remove` fell through as a documented no-op). Both are now applied
  directly against the live three.js materials in a new `packages/engine-three/src/
  material-extras.ts` (checked against `tables.materialsByIndex`'s fanout array, same convention
  the vendored router's own rows use), called from `ThreeRenderHost.applyNonStructuralPatch` ahead
  of its existing op guard/router call. `RH-020`/`RH-021`/`RH-001`'s existing contracts are
  unchanged — this is engine-three's own internal dispatch, not a new `RenderHost` interface
  member. Regression note: undoing a material's FIRST-EVER `doubleSided` write replays a `remove`
  patch (the inverse of the `add` `SceneEdit.setMaterialProperty` produces via `setPathFragment`
  when the field didn't previously exist), not a `replace true->false` — `applyDoubleSidedPatch`
  initially only handled `add`/`replace` and was caught missing the `remove` case by this feature's
  own e2e coverage (a real screenshot: the live material stayed `DoubleSide` after undo even though
  the document correctly reverted); fixed, and covered by both an engine-three unit test and the
  e2e regression it was found in.

## Open questions

- RESOLVED(RH-mount-shape-tbd) (by `engine-three`, M2): `mount(container)` takes an `HTMLElement` the caller owns and does not pre-size — `RenderHost` creates and owns its own child `<canvas>`, appends it to `container`, and keeps it sized to `container`'s content box via a `ResizeObserver` (removed/recreated on `dispose`/re-`mount`, per RH-009). The caller never touches the canvas directly; `snapshot()` (RH-024) is the one sanctioned way to get pixels out.
- RESOLVED(RH-loadscene-shape-tbd) (by `engine-three`, M2): pending `editor-core`'s `EditorDocument`-derived view shape, `engine-three`'s `loadScene(json: unknown)` accepts any of three shapes: (a) a raw GLB `ArrayBuffer`/`Uint8Array`; (b) `{ json: <glTF JSON>, binary?: ArrayBuffer | Uint8Array | null }` (a parsed-container shape mirroring `@gltfi/gltf`'s `GltfDocument`); or (c) a bare, self-contained glTF JSON document (detected by its required top-level `asset` field — buffers inlined as base64 `data:` URIs, glTF's own "embedded" convention, no separate binary blob). All three are re-encoded to one GLB via `@gltfi/gltf`'s `writeGlb` before handing off to `GLTFLoader.parse`, so every input shares one loader path. Shape (c) is what `packages/contract-tests/src/render-host.ts`'s portable fixture uses — the generic contract suite must stay implementation-agnostic, and "plain glTF JSON, no wrapper" is the shape every renderer-backed `RenderHost` is most plausibly able to accept directly. The engine-api type stays `unknown` at this layer (other future `RenderHost` implementations may accept a different shape, or a subset of these three); this note documents `engine-three`'s concrete choice, not a widening of the interface.
- RESOLVED(RH-pointer-value-tbd) (by `engine-three`, M2): `engine-three` accepts exactly the three-adapter's own `PointerValue` union (`number[] | boolean[] | number | boolean`) at runtime and throws a descriptive `TypeError` for anything else; the engine-api type stays `unknown` (per the reasoning above — a future non-three implementation may have a different native value shape).
- RESOLVED(EA-pickresult-shape-tbd) (by `engine-three`, M2): `PickResult` gains a `distance: number` field (the world-space ray length from the camera to `point`, i.e. `THREE.Intersection.distance`) alongside `nodeIndex`/`point`. Barycentric coordinates and material index remain unspecified/omitted — no consumer needs them yet, and they are easy to add as further optional fields later without breaking this shape.
- DECISION (not a spec obligation, noted for implementers; usage-mapping PR): `engine-three`'s `setReferenceHighlight` (`RH-029`/`RH-030`) renders a solid `THREE.BoxHelper` in `0xd9a441` — the same amber `docs/ux/mockups/mockup-v6.html`'s `--warn` CSS variable resolves to for its own reference-highlight rows — kept in its own helper list/index set, independent of `setHighlight`'s selection amber (`0xffaa00`) and `setHover`'s dashed blue (`0x4d9dff`, the DECISION note below), so all three tiers stay visually distinguishable whether they land on the same node or three different ones.
- DECISION (not a spec obligation, noted for implementers): M2's viewport-integration PR adds three `ThreeRenderHost` methods beyond the `RenderHost` interface (same precedent as the pre-existing `getRendererStats()`, itself not mentioned in this spec) — `setHover(nodeIndices)` (a dashed-outline visual distinct from `setHighlight`'s solid one, for `specs/ux-viewport.md`'s `UX-301`, since `RH-022`'s highlighted set is deliberately style-agnostic), `frameNode(nodeIndex | null)` (backs the "Frame selected" toolbar control, `UX-308`, framing the given node's bounding box or, when `null`, the whole loaded scene), and `simulateGizmoDrag(delta)` (test-only: moves the attached gizmo's object and re-fires the same internal `objectChange`/`dragging-changed` events a real pointer drag would, since driving `TransformControls`' screen-space handles from Playwright's synthetic input is impractical — used by `e2e/viewport.spec.ts`'s gizmo-commit coverage in place of a pixel-accurate drag simulation). None of the three widen or change `RenderHost`'s interface; `packages/app`'s `Viewport` calls them directly against the concrete `ThreeRenderHost` type it already imports, the same way it calls `mount`/`loadScene`/etc. through the interface.
- DECISION (not a spec obligation, noted for implementers): `engine-three` mounts a plain `THREE.WebGLRenderer` in v1, not `WebGPURenderer` with WebGL2 auto-fallback (the sibling demo app's choice). An editor viewport that must also run headless in CI (this package's own contract-test suite, `packages/contract-tests/src/render-host.ts`, via `vitest`'s Playwright/Chromium browser mode) is better served by the simpler, more broadly-supported `WebGLRenderer` than by carrying WebGPU's extra init/fallback surface for no v1 editor benefit; nothing in RH-001..RH-024 requires WebGPU specifically. A future `WebGPURenderer` path (if ever wanted) would be additive, not a breaking change to this interface.
- RESOLVED(RH-024 vs. PC-003 tension) (by `specs/engine-api.md`'s `PC-007`): `RenderHost.snapshot()` (RH-024) stays image-only, scoped exactly to RH-024's own rendered-PNG/export use case — it gains no scene-state-capture responsibility. `PlayController.stop()`'s "scene snapshot" restore (PC-003) is a *separate* mechanism: the `EditorDocument.json` captured at the moment `start()` was called, restored via `renderHost.loadScene(capturedJson)`, not via `snapshot()`. See `PC-007` for the full statement.
- DECISION (not a spec obligation, noted for implementers; bug-fix note for `specs/ux-viewport.md`'s `UX-302`/`UX-303`): a fourth beyond-the-interface `ThreeRenderHost` method, `setControlsEnabled(enabled)`, toggles the underlying `OrbitControls` instance on/off. Added because `OrbitControls` has no click-vs-drag threshold of its own — it starts rotating (or, on the right mouse button, panning) the camera on the very first `pointermove` after `pointerdown`, however small. A synthetic `page.mouse.click()` (the only kind `e2e/viewport.spec.ts` used before this fix) presses and releases with zero intervening movement, so no e2e test caught this; a real mouse or trackpad essentially never holds pixel-perfect still between press and release, so the camera had usually already rotated a fraction of a degree away from the pose the user was looking at by the time `pick()` ran — enough to miss whatever appeared to be right under the cursor (the reported "can't select objects in the viewport, only in the scene panel" bug). `packages/app`'s `Viewport` now disables controls on `pointerdown` and re-enables them only once movement crosses a small pixel threshold (a real drag), keeping `pick()`'s camera exactly as it was for anything under that threshold, plus a matching `onClick`/`onContextMenu` guard so a drag that DOES cross the threshold can't also change the selection at its drop point. Regression coverage (real CDP mouse input, default camera, no `setCameraPose`) lives in `e2e/viewport-real-click.spec.ts`, alongside `UX-302`'s own dedicated real-coordinate-click tests on both the single-file and packed-multi-file import paths that `e2e/viewport.spec.ts`'s fixed-camera-pose suite never exercised.
- DECISION (not a spec obligation, noted for implementers; bug-fix note for `specs/ux-viewport.md`'s `UX-305`): a fifth and sixth beyond-the-interface `ThreeRenderHost` method — `isGizmoDragging()` and `hitTestGizmoHandle(ndcX, ndcY)` — fix a regression the `setControlsEnabled` DECISION above itself introduced ("moving the gizmo also rotates the camera", user-reported). `Viewport.tsx`'s click/drag-threshold `onPointerMove` re-enables `OrbitControls` as soon as cumulative pointer movement crosses its 5px threshold, with no regard for whether a `TransformControls` gizmo owned the gesture — a real gizmo drag crosses 5px almost immediately, so it re-armed `OrbitControls` out from under `TransformControls`' own `dragging-changed`-driven disable (`attachGizmo`, `RH-003`), leaving both the dragged object and the orbiting camera moving together for the rest of the drag. `isGizmoDragging()` is a thin, direct passthrough to `TransformControls`' own public `dragging` boolean (`true` from the native `pointerdown` that starts a real drag on a handle to the native `pointerup` that ends it — set synchronously before `Viewport.tsx`'s own React pointer handlers run, same bubble-order reasoning as `setControlsEnabled`'s own doc comment) — `Viewport.tsx`'s threshold re-enable now skips itself entirely whenever this is `true`, so `OrbitControls` stays disabled for the gizmo's entire drag regardless of pointer distance, while an ordinary (non-gizmo) drag re-arms exactly as before. `hitTestGizmoHandle(ndcX, ndcY)` is test-only (used by the new `e2e/viewport-gizmo-camera-lock.spec.ts`): a side-effect-free wrapper around `TransformControls`' own public `pointerHover`, returning whichever axis/plane it reports (or `null`) for the given NDC point — added because that e2e's real CDP mouse drag needs to land exactly on a real gizmo handle, and a naive trial-and-error search using real drags would have each miss be a genuine `OrbitControls` orbit whose damping momentum (`enableDamping`) outlives the gesture and would pollute the very camera-pose comparison being tested; `pointerHover` never touches `controls.enabled` (only a real `pointerdown` starting a drag does), so probing it has no such side effect. Regression coverage lives in `e2e/viewport-gizmo-camera-lock.spec.ts`, verified to fail on the pre-fix code and pass after; `e2e/viewport.spec.ts`'s `simulateGizmoDrag`-based gizmo/history coverage and `e2e/viewport-real-click.spec.ts`'s jitter-click/deliberate-orbit-drag regression coverage both remain green, unmodified — `simulateGizmoDrag` specifically could never have caught this bug in the first place, since it writes the transform and re-fires `TransformControls`' internal events directly, with no real pointer input at all to exercise `Viewport.tsx`'s pointer handlers.
