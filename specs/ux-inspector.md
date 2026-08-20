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

### Material extras and Texture Slots (richer inspector)

- [UX-415] (active) The Material section (`UX-405`) additionally shows: an emissiveFactor color picker; an Alpha Mode select (`OPAQUE`/`MASK`/`BLEND`) with an Alpha Cutoff row (own `◈` pointer-shortcut button) shown only when the mode is `MASK`; and a Double Sided checkbox. Every field writes via `SceneEdit.setMaterialProperty` and is confirmed to render: emissiveFactor and alphaCutoff go live through the vendored `@gltfi/three-adapter`'s own pointer-router rows; doubleSided has no vendored route (a trivial 1:1 `Material.side` mapping) so `engine-three`'s own `material-extras.ts` applies it directly against the live three.js material; alphaMode is a load-time-only glTF field with no runtime pointer at all (core glTF defines no way to animate it), so a write takes `RenderHost.patchScene`'s generic "value has no live-pointer representation" fallback — a full `loadScene` reload, which re-parses it correctly (the SAME fallback path `KHR_audio_emitter`'s `distanceModel` enum already used before this feature).
- [UX-416] (active) The Material section additionally shows a Texture Slots sub-section listing the 5 core-glTF texture-info slots (`baseColorTexture`, `metallicRoughnessTexture`, `normalTexture`, `occlusionTexture`, `emissiveTexture`): a decoded thumbnail when the slot is set (`@gltfi/gltf`'s `loadImageBitmaps`, covering both `data:`-URI and bufferView-embedded images) or "not set" when it isn't; a Clear control on a set slot that removes the whole texture-info object (`SceneEdit.clearMaterialTexture`) — engine-three's own `material-extras.ts` nulls the corresponding live three.js material map slot(s) directly (no vendored pointer-router "unset" verb exists); and, for a set slot, editable `KHR_texture_transform` offset/scale/rotation fields (`SceneEdit.setMaterialTextureTransform`, scaffolding the extension's `extensionsUsed` entry in the same command), rendering live through the vendored pointer-router's own per-texture-info transform rows. Texture slot REPLACEMENT/upload (assigning a whole new image to a slot) is explicitly out of scope for v1 — a real, scoped-out follow-up, not silently missing (this section is READ + CLEAR + transform-edit only).

### Light and Camera sections (richer inspector)

- [UX-417] (active) A node whose glTF entry carries `extensions.KHR_lights_punctual.light` shows a Light section: type (read-only — changing a light's type is a later iteration, noted inline), a color picker, an intensity field (own `◈`), and — only when meaningful for the light's own type, per the glTF spec's own definitions — a range field (point/spot only, own `◈`) and inner/outer cone-angle fields (spot only, each with its own `◈`). Every editable field writes via `SceneEdit.setLightProperty` against the ROOT `extensions.KHR_lights_punctual.lights[]` registry (addressed by light index, not node index) and renders live through the vendored pointer-router's own `KHR_lights_punctual` rows.
- [UX-418] (active) A node whose glTF entry carries `camera` shows a Camera section: perspective `yfov`/`znear`/`zfar` fields (each with its own `◈`), written via `SceneEdit.setCameraProperty` against core glTF's `cameras[]`. These edits round-trip through the document (undoable, correctly persisted/exported) but do NOT preview live through this camera in the viewport in v1 — `ThreeRenderHost`'s own viewport camera is an independent free-fly camera, not derived from any scene camera node, and there is no vendored pointer-router route for camera properties either (camera isn't part of KHR_interactivity's node/material Object Model families the router covers) — an explicit inline note says so, matching `UX-414`'s "never a silently missing section" discipline. A "look through this camera" live-preview viewport mode is a real, scoped-out follow-up.

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
- [UX-414] (active) Light and camera nodes show their Transform section plus their own real, editable section (`UX-417` for lights, `UX-418` for cameras) — never a silently missing section with no explanation. (Supersedes this requirement's own original text, which deferred BOTH sections' entire contents to "a later iteration" — that iteration is `UX-417`/`UX-418`; each section's own NARROWER remaining gap — light type is still read-only, a camera has no live viewport preview yet — is itself noted inline rather than silently dropped, the same discipline this requirement always asked for.)

### Emitter/environment/listener authoring (audio pass 3/3)

- [UX-419] (active) The Audio Emitter section (`UX-406`) is extended with: an emitter Type select (`global`/`positional`, `SceneEdit.setAudioEmitterProperty(…, ["type"], …)`); when `positional`, a Shape select (`omnidirectional`/`cone`) plus Distance Model/Ref Distance/Max Distance/Rolloff Factor fields (all under `positional`, own `◈` pointer-shortcut buttons on the numeric fields) and, only when Shape is `cone`, Cone Inner/Outer Angle + Cone Outer Gain fields. Every field writes via `SceneEdit.setAudioEmitterProperty` against the correct nested `positional.*` path (fixing a prior bug: the original `UX-406` Distance Model select wrote a TOP-LEVEL `emitters[i].distanceModel` field `WebAudioHost` never read — it only reads `emitters[i].positional.distanceModel` — silently a write-only field until this pass).
- [UX-420] (active) The Audio Emitter section additionally shows a Sources sub-list: one row per index in the emitter's own `sources: number[]` array, naming the bound clip (`extensions.KHR_audio_emitter.audio[source.audio].mimeType`/`uri`, read-only — clip REPLACEMENT/upload is out of scope, mirroring `UX-416`'s texture-slot precedent) alongside editable Gain/Playback Rate/Loop/Autoplay fields, written via the new `SceneEdit.setAudioSourceProperty` (`specs/document-model.md`'s `DOC-062`).
- [UX-421] (active) A node's Audio Emitter section, when the document has NO `KHR_audio_environment` extension at all, shows a "No audio environment" empty state with an "Add environment" action (`SceneEdit.addAudioEnvironment`) — never a silently missing section. Once at least one environment exists, an Audio Environment Zone section appears on any node: for a node not yet a zone, an "Add environment zone" action (`SceneEdit.addAudioZone`, defaulting to a radius-5 sphere around the node); for a node that already is one, an Environment select (reassigning which `environments[]` entry the zone routes to), a Reverb Preset select (`spatial.ts`'s 13-entry `REVERB_PRESETS` table: generic/smallRoom/mediumRoom/largeRoom/bathroom/concertHall/cathedral/cave/arena/hangar/corridor/forest/underwater) and Reverb Mix field on the zone's own environment, and Shape (sphere radius / box size)/Blend Distance/Priority fields on the zone itself — all via `SceneEdit.setAudioEnvironmentProperty`/`setNodeAudioEnvironmentProperty`.
- [UX-422] (active) A camera node shows a Listener row in its Camera section (`UX-418`) when the document has at least one `KHR_audio_environment` listener: either "Bind as listener" (`SceneEdit.setNodeAudioEnvironmentProperty(…, ["listener"], …)`, offered only once a listener exists — creating the first one is the same "Add environment" empty-state action `UX-421` already offers, `SceneEdit.addAudioListener`) or, once bound, editable Gain/Spatialization Model fields against that listener's own root registry entry (`SceneEdit.setAudioListenerProperty`). The current default scene's environment/active-listener bindings (`SceneEdit.setSceneAudioEnvironment`/`setSceneAudioActiveListener`) are exposed as two selects at the top of the Audio Environment Zone section (`UX-421`) rather than duplicated per node, since both are scene-wide, not per-node, settings.
- [UX-423] (active) Every field `UX-419`-`422` add is confirmed to render: `WebAudioHost.applyPointer` (`specs/engine-api.md` AH-002's pointer-family coverage) applies emitter gain, positional ref/max distance and cone angle/gain, and source gain/playback-rate directly onto the live `PannerNode`/`AudioBufferSourceNode`/`GainNode` graph with no rebuild; every other field this pass adds (type, distance model, shape, rolloff factor, source loop/autoplay/clip, environment/listener/zone authoring, scene environment/listener bindings) is NOT independently wired through `applyPointer` — it relies on `packages/app`'s existing `attachAudioHost` (`lib/audio-host-lifecycle.ts`), which already calls `WebAudioHost.loadEmitters` (a full, idempotent audio-graph rebuild against the CURRENT document) on every `HistoryStack.onApply`, i.e. after every command this section dispatches — the same "reload fallback" `UX-415`'s alphaMode note already established as an acceptable render path, here already wired for free rather than newly built. A currently-playing preview voice is audibly cut and restarted by that rebuild (a real, minor UX papercut on an edit made mid-Audition, not silently dropped: noted here, not fixed in this pass). Node PLACEMENT (a positional emitter following its node's transform) is confirmed live through the same mechanism: a gizmo-move dispatches `SceneEdit.setTransform`, which is itself a `HistoryStack` command like any other, so the SAME `attachAudioHost` reload re-derives the emitter's `staticPosition`/`staticForward` (`WebAudioHost.buildEmitterChain`) from the node's new transform — closing `WebAudioHost`'s own documented "static position" gap for the specific case of an EDITOR-driven move (a gizmo drag or an Inspector Transform-section edit), though NOT for a live `KHR_animation`/`KHR_interactivity` pointer-driven move during play mode, which still has no `RenderHost`→`AudioHost` per-frame world-matrix feed (that remains the open gap `web-audio-host.ts`'s class doc already names). Listener pose for Audition specifically (as opposed to play mode) remains the Web Audio API's default (origin, facing −Z) — `Viewport.tsx`'s `setListenerPose` feed is gated on `playState === "playing"` only, a deliberate perf tradeoff (its own comment) this pass did not revisit; auditioning a positional emitter far from the origin will pan/attenuate against that default pose, not the current viewport camera. Documented gap, not silently dropped.

## Implementation notes

- M7 (`packages/app/src/components/inspector/AudioSection.tsx`): `UX-406`'s Audition (`▶`) control
  is real — it was a disabled stub pending "the play-mode runtime" (a stale note; the actual
  dependency was `specs/engine-api.md`'s `AudioHost`, which lands in M7, not `PlayController`
  specifically). The control's own `onClick` is the gesture `AudioHost.init()`'s `AH-001`
  gesture-gating requires; a local `initialized` flag skips a redundant `init()` call on repeat
  clicks (not a correctness requirement — `init()` is itself idempotent — just avoids an unnecessary
  await on every click).
- Richer inspector (`UX-415`/`UX-416`/`UX-417`/`UX-418`): every field this pass adds was picked
  specifically because `engine-three`'s `RenderHost` (either the vendored `@gltfi/three-adapter`
  pointer-router directly, engine-three's own small `material-extras.ts` direct-apply for the two
  properties with no vendored route, or the generic reload fallback for a load-time-only field) can
  actually apply/render it — the acceptance bar this whole feature was held to was "no write-only
  inspector fields." Honest gaps, not silently invented nor silently dropped:
  - Texture slot REPLACEMENT/upload (`UX-416`) — v1 is READ + CLEAR + `KHR_texture_transform`
    offset/scale/rotation edit only; assigning a brand-new image to a slot is a real, separately-
    scoped follow-up.
  - A light's `type` (`UX-417`) is read-only; changing directional/point/spot in place (which would
    need to swap the underlying `THREE.Light` subclass entirely, not just tweak a property) is a
    later iteration.
  - A camera's live "look through this camera" viewport preview (`UX-418`) doesn't exist yet —
    `ThreeRenderHost`'s own viewport camera has no linkage to any scene camera node at all today;
    property edits still round-trip through the document (undoable, persisted/exported correctly),
    just without a live viewport preview of their effect.
  - `pointer-vocab.ts`'s `buildPointerContentTree`/`parsePointerPath` (the pointer-picker dialog's
    own content tree) still don't enumerate lights/cameras as pickable targets — only this
    Inspector's own `◈` affordance (via that same file's new `LIGHT_PROPS`/`CAMERA_PROPS` tables)
    can target a light/camera property pointer today.
  - `KHR_materials_clearcoat`/`KHR_materials_sheen`'s own texture slots and factors, and
    `KHR_materials_emissive_strength`/`ior`/`specular` — all real vendored pointer-router families
    (see `pointer-router.js`'s own M4 rows) — are not surfaced in the Inspector at all yet; a cheap
    follow-up (the render path already exists, only the UI doesn't).
- Emitter/environment/listener authoring, audio pass 3/3 (`UX-419`..`423`,
  `packages/app/src/components/inspector/AudioSection.tsx` + new
  `AudioEnvironmentSection.tsx`): fixed a real pre-existing bug found while extending this section —
  `UX-406`'s original Distance Model select wrote `emitters[i].distanceModel` (top-level), but
  `WebAudioHost.buildEmitterChain` only ever reads `emitters[i].positional.distanceModel`; the field
  was silently write-only (round-tripped through the document, never actually applied) since M7. Every
  new field is confirmed to apply — either live via an extended `WebAudioHost.applyPointer` (gain,
  positional ref/max distance, cone angle/gain, source gain/playback-rate) or via the pre-existing
  `attachAudioHost` reload-on-every-edit path (everything else, including full emitter-graph topology
  changes like type/shape/distance-model and all environment/listener/zone authoring) — see `UX-423`'s
  own doc comment for the exact split and the honest gaps it names (a reload cuts a currently-playing
  Audition preview; Audition itself still previews against the Web Audio API's default listener pose,
  not the live viewport camera, since that feed stays play-mode-only for the documented perf reason).
  Real, deliberately out-of-scope follow-ups, not silently dropped: a node can carry only ONE emitter
  through this UI (the Inspector's `emitterIndex` lookup only reads a node's singular
  `extensions.KHR_audio_emitter.emitter` field, not the array-valued `.emitters` some imported assets
  use, e.g. the lifted gltf-webgpu `drum-pads` sample) — multi-emitter-per-node authoring is a real,
  separately-scoped follow-up; a node is authored as an environment zone OR a listener, never both,
  matching `SceneEdit.addAudioZone`'s own "overwrites any prior binding" doc comment; and the Add menu's
  "Audio Emitter" entry still always generates a fresh silent-WAV placeholder clip — `SceneEdit.
  addAudioEmitterNode`'s new `opts.audioIndex` (an existing-clip reuse path, `DOC-062`) has no Add-menu
  UI wired to it yet in this pass, a real, separately-scoped follow-up (the factory-level capability
  exists and is unit-tested; the picker UI does not).

## Open questions

- OPEN(UX-inspector-children-multi-tbd): `UX-403`'s children-chip behavior ("navigate to the
  first child") is a judgment call made by the approved mockup for nodes with more than one
  child; whether a multi-child node should instead show a picker is not specified.
