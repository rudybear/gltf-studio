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

- [UX-205] (active) The scene tree's "+ Add" control opens a menu with exactly five entries, in this order: Mesh, Light, Camera, Audio Emitter, Empty Group. "Mesh" expands its own submenu (Cube, Sphere, Plane) rather than creating directly; this still counts as one top-level entry for this requirement's "exactly five" count. Full punctual-light control (r2): "Light" likewise expands its own submenu (Point, Spot, Directional) rather than always creating a point light directly — the same "a submenu is still one top-level entry" rule applies, so the menu still has exactly five entries.
- [UX-206] (active) M8-lite: choosing an add-menu entry creates real content via one of the append-only `SceneEdit.add*Node` factories (`specs/document-model.md`'s `DOC-047`) — Mesh's Cube/Sphere/Plane submenu options each add a small procedurally-generated primitive mesh (`packages/editor-core/src/primitives.ts`); Light's Point/Spot/Directional submenu options each add a `KHR_lights_punctual` light of that type, with real per-type default values (`specs/document-model.md`'s `DOC-065` r2 — previously Light always added a bare point light with no type choice); Camera adds a perspective camera; Audio Emitter adds a `KHR_audio_emitter` positional emitter wired to a generated silent clip (so it is immediately auditionable, not a dead reference); Empty Group adds a plain, mesh/light/camera/emitter-less node. Each is ONE undoable history entry, even where it spans several document arrays (e.g. Mesh's buffer+bufferViews+accessors+material+mesh+node). This supersedes this requirement's earlier "may be a stub" wording — `SceneEdit.*`'s structural factories landed ahead of schedule (ADR-0004) precisely so this could go real before milestone M8; reparenting/deleting/duplicating an EXISTING node are all real too, as of M8 parts 1 and 2 (`SceneEdit.removeNode`/`reparentNode`/`duplicateNode` — `UX-214`/`UX-215`/`UX-216`/`UX-217`).
- [UX-213] (active) M8-lite: a newly created add-menu node is appended as the LAST child of the currently-selected node when one is selected, else as the last root child of the current default scene (append-only: no reordering, no reparenting of anything that already existed); it is immediately selected (`UX-202`) and its default name opens in the same inline-rename text field `UX-207`'s context-menu "Rename" action uses, so the generic default name ("Cube", "Point Light", "Camera", "Audio Emitter", "Empty Group") is one keystroke away from being replaced.

### Right-click context menu

- [UX-207] (active) Right-clicking a scene-tree row or a viewport object opens a context menu positioned at the cursor, closing on an outside click or Escape. The scene-tree row's menu has exactly SIX actions, in this order — Frame, Rename, Duplicate (`UX-216`), "✦ Ask Copilot about this…", Reparent to root (`UX-217`), Delete (`UX-214`) — the viewport object's menu still has exactly the original three (Frame, Rename, "✦ Ask Copilot about this…"); see `UX-214`'s own note for why Delete (and, as of M8 part 2, Duplicate/Reparent to root) are scene-tree-only for now. (Supersedes this requirement's original "exactly three actions" wording, which predated `UX-214`, and `UX-214`'s own "exactly FOUR actions" wording, which predated `UX-216`/`UX-217`.)
- [UX-208] (active) Choosing "✦ Ask Copilot about this…" switches the right panel to the Copilot tab and adds exactly one context chip naming the right-clicked object, per `AG-015`'s "same request/response contract, differing only in prefilled context" inline-affordance contract (see `specs/ux-copilot.md`'s `UX-1008`).
- [UX-214] (active) M8 part 1 (`specs/document-model.md`'s `DOC-048`): the scene-tree row's context menu gains a "Delete" action — labeled "Delete" for a childless node, or "Delete (N nodes)" when the node has descendants (`SceneEdit.removeNode` always deletes the whole subtree as one command, never just the one row) — and the Delete/Backspace key deletes the currently-selected scene node the same way, whenever a scene node is selected AND keyboard focus is not inside a text input, a `<select>`, or the Script tab's Monaco editor (an app-level `keydown` handler, not scoped to the scene tree, so the shortcut works regardless of which panel has focus). Both paths call the SAME store action, dispatched through the existing `dispatchCommand` play-mode freeze guard (`specs/document-model.md`'s `DOC-031`) — deleting is blocked while playing exactly like every other edit, with no separate guard needed. After a successful delete, selection moves to the deleted node's former parent, or clears entirely when the deleted node was a scene-root (`DOC-048`'s `parentIndex` return value). Undo restores the entire subtree, every fixed-up reference, AND the pre-delete selection is NOT automatically restored by undo itself (selection is ephemeral store state per `DOC-030`, outside `HistoryStack`) — undoing a delete leaves selection wherever it last was, which may still be the post-delete parent. Delete is scene-tree-only for now, not added to the viewport object's own right-click menu (`Viewport.tsx`) or as a viewport-focused keyboard shortcut — deliberately out of scope for this change to avoid touching viewport interaction code owned by concurrent work; a future pass can extend it there.

### Structural reparenting and duplication (M8 part 2 — completes scene authoring)

- [UX-215] (active) `specs/document-model.md`'s `DOC-052`: dragging a scene-tree row and dropping it onto ANOTHER scene-tree row moves the dragged node (and its whole subtree) to become that row's LAST child, as one undoable command — a visual drop indicator (an outlined, highlighted row, `.tree-row.drag-over`) marks the current drop target while dragging. Into-only v1: a drop always lands as the target's last child; there is no separate "insert between two existing siblings" indicator or drop position yet — a future pass can add one on top of `SceneEdit.reparentNode`'s existing `insertIndex` parameter, which already supports it programmatically. Dropping onto the scene tree's own empty background (below every row, not onto any row) instead reparents to the current default scene's root — the same operation as `UX-217`'s "Reparent to root" context-menu action. Dropping a row onto ITSELF, one of its own descendants, or (for a root-level node) redundantly onto the empty background is either a no-op or rejected: a genuine cycle attempt (onto itself or a descendant) is rejected with a toast ("Can't move a node into itself or one of its own children.") rather than silently failing or corrupting the tree — the same typed `CycleReparentError` `SceneEdit.reparentNode` throws, caught by the store's `reparentNode` action before it ever reaches this component. Reparenting preserves the node's rendered WORLD transform by default (`DOC-052`'s resolved policy — a purely structural "move under a different node" gesture should not silently relocate the object): `SceneEdit.reparentNode` recomputes the node's LOCAL `translation`/`rotation`/`scale` (or `matrix`, whichever shape it already used) so its on-screen position/orientation/size stays exactly where it was, now expressed relative to the new parent's own world transform. Neither the drag-and-drop gesture nor "Reparent to root" exposes the local-only alternative (`SceneEdit.reparentNode`'s `opts.keepLocal`) in the UI yet — every current caller wants the world-preserving default.
- [UX-216] (active) `specs/document-model.md`'s `DOC-053`: the scene-tree row's context menu gains a "Duplicate" action (`UX-207`) that deep-copies the row's node and its entire subtree as new, appended nodes — sharing every mesh/material/accessor/light/emitter reference, never copying geometry — as one undoable command; the new copy is auto-selected afterward (`UX-202`). The same action is reachable via Ctrl/Cmd+D when a scene-tree row has keyboard focus (each row is a `tabIndex={0}` element specifically so this shortcut has something concrete to scope itself to) — unlike `UX-214`'s Delete/Backspace shortcut, this is NOT an app-level shortcut that fires regardless of which panel has focus. If the duplicated subtree contains (or is itself) a node some `KHR_interactivity` handler (`event/onSelect`/`onHoverIn`/`onHoverOut`) or animation channel addresses, the NEW copy's index is deliberately NOT added to that handler's configuration and no new graph nodes are created on its behalf — a duplicate of, say, a car checkpoint pad does not automatically inherit the original's `onSelect` behavior; wiring the copy into the behavior graph is a separate, explicit step (`UX-209`'s drag-onto-the-graph-canvas flow, or Copilot).
- [UX-217] (active) `specs/document-model.md`'s `DOC-052`: the scene-tree row's context menu gains a "Reparent to root" action (`UX-207`) that moves the row's node (and its subtree) out from under its current parent to the current default scene's root, as one undoable command — equivalent to dragging it and dropping it onto the tree's own empty background (`UX-215`). Applying it to a node that is ALREADY a scene-root node is not treated as an error: with no sibling-position argument, it simply moves the node to be the LAST scene-root entry.

### Drag onto the behavior graph

- [UX-209] (active) Dragging a scene-tree row onto the behavior-graph canvas and dropping it opens a drop-menu scoped to that node — `pointer/get`, `pointer/set`, `pointer/interpolate`, `event/onSelect (this node)` — per `specs/ux-graph-canvas.md`'s `UX-509`; choosing an option creates that node in the graph, pre-configured against the dragged node's pointer path.

### Asset browser

- [UX-210] (active) The asset browser has exactly four tabs — Meshes, Materials, Audio Clips, Animations — with one active at a time; the Meshes/Materials/Animations tabs list the document's actual owned entries (e.g. a mesh shared by two scene nodes appears once, not once per referencing node).
- [UX-211] (active) Clicking a Meshes/Materials/Animations row is a deliberate "inspect this" action: it force-switches the bottom dock to the Data tab at that entry's pointer (`/meshes/{i}`, `/materials/{i}`, `/animations/{i}`) — unlike scene-tree/viewport selection (`UX-202`), which updates the Data tab passively.
- [UX-212] (active) Each Animations row has its own preview (`▶`) control that plays a brief preview of that clip without changing the current selection or switching the bottom dock tab.

### Audio Clips tab (Track A audio task — resolves `OPEN(UX-asset-audio-tab-tbd)`)

- [UX-218] (active) The Audio Clips tab (`UX-210`) lists the document's actual owned `extensions.KHR_audio_emitter.audio[]` entries (each once, matching `UX-210`'s existing Meshes/Materials/Animations convention): a name/uri label, an Embedded/Referenced badge (`bufferView` vs `uri`), a duration label (decoded on demand for an embedded clip; `—`/`…` for a referenced one, per `UX-219`'s resolvability states), and a preview (`▶`) control mirroring `UX-212`'s own Animations-row precedent — enabled only when the clip's bytes are actually resolvable (always true for embedded; conditional for referenced, `UX-219`). An "Import" button opens a local file picker, validates the file via a real `AudioContext.decodeAudioData` call BEFORE committing anything (a corrupt/unsupported file never reaches the document), then embeds it as one undoable command (`SceneEdit.addAudioClipEmbedded`, `specs/document-model.md`'s `DOC-066`). An "Add by reference" control opens an inline uri text field (plus a "pick a file just for its name" convenience button) and adds a uri-kept-verbatim clip (`SceneEdit.addAudioClipUri`) — the USER-DECISION this task was scoped around: a referenced clip is never silently embedded behind the user's back.
- [UX-219] (active) A referenced (uri) clip's resolvability is HONEST, never faked: an absolute `http(s)://` uri is fetched directly; a relative uri is resolved against whichever folder the user has most recently granted via a "Grant folder access" button (shown only when at least one referenced clip is currently unresolved) — the SAME `@gltf-studio/storage` `resolveUrisFromDirectory` candidate-name-matching machinery `specs/ux-shell.md`'s `UX-117` missing-files dialog already uses for import-time fixups, reused here for LIVE, session-long resolution (a genuinely new capability — the pre-existing import-time flow discards its file map after one use, `pack-gltf.ts`'s own header note). A clip that resolves neither way is listed with an "Unresolved" badge, no preview, no crash, and no fake silent playback — exactly the honest-gap discipline `UX-416`'s texture-slot precedent already established for a different asset kind. Each row's "Embed" action (shown only on a referenced clip) resolves its bytes the same way and then calls `SceneEdit.embedAudioClip` as one undoable command; it's disabled with an explanatory title when the clip isn't currently resolvable.
- [UX-220] (active) Each row's delete ("✕") control calls `SceneEdit.removeAudioClip` (`DOC-066`) — BLOCKED (disabled, with a tooltip naming the exact usage count) when any `sources[]` entry still references the clip, mirroring the Variables panel's own delete-blocked-when-used precedent (`specs/document-model.md`'s `DOC-055`) one asset kind over.
- [UX-221] (active) Clicking an Audio Clips row does NOT force-switch the bottom dock to the Data tab the way a Meshes/Materials/Animations row does (`UX-211`) — RESOLVES this file's own `OPEN(UX-asset-audio-tab-tbd)`: a clip's row already carries its own real management actions (Import/Add-by-reference/Embed/Delete/preview, `UX-218`..`220`) richer than the Data tab's read-only property view would add, so extending the Data tab's deliberately-narrow `resolveDataContainer`-style addressing (`specs/ux-data-tab.md`'s own "Open questions" note) to a nested extension-array shape was judged not worth the complexity for what it would show beyond what's already visible here. Whether/how a clip becomes independently Data-tab-addressable remains open only in the narrower sense that nothing currently blocks a future PR from adding it — it is not needed for clip management to be complete.
- [UX-222] (active) The "+ Add" menu's "Audio Emitter" entry (`UX-205`/`UX-206`) becomes a submenu (mirroring `UX-206`'s own Mesh ▸ Cube/Sphere/Plane precedent — still ONE top-level entry for `UX-205`'s "exactly five" count): "New (silent placeholder)" (unchanged prior behavior) plus one entry per existing document `audio[]` clip, wiring `SceneEdit.addAudioEmitterNode`'s `opts.audioIndex` (real at the factory level since `DOC-062`, unwired at this call site until now) — choosing an existing clip creates the emitter+source+node chain bound to that clip instead of generating a fresh silent-WAV placeholder.

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

## Implementation notes (M8-lite: add-menu creates real content)

`UX-206`/`UX-213` (user-reported bug: the scene panel's "+ Add" button "does nothing" — investigation
found the menu itself opened fine; every entry's `onClick` just called `pushToast(...)`, which reads
as "nothing happened" against the much stronger implicit expectation "clicking a scene-object add
button adds a scene object"). Fix: `SceneTree.tsx`'s five entries now call one of four new
`SceneEdit` composite factories (`specs/document-model.md`'s `DOC-047`,
`packages/editor-core/src/scene-edit.ts`) — `addPrimitiveMeshNode`, `addLightNode`, `addCameraNode`,
`addAudioEmitterNode` — or, for Empty Group, the pre-existing `addNode` directly. All four new
factories (plus `addNode` itself) now accept `opts.parentNodeIndex`: when given, the new node's
index is appended to that node's `children` array instead of the scene's root `nodes` array, as part
of the SAME combined command — this is what makes `UX-213`'s "lands under the selection" real
without touching anything that already exists (still append-only, per `DOC-046`'s original scope).
`SceneTree.tsx` passes the current `selectedNodeIndex` (or `undefined`) as that option, then — after
`dispatchCommand` — calls `selectNode(newIndex)` and opens the SAME `renamingNode`/`renameValue`
inline-rename state `UX-207`'s context-menu "Rename" already drives, so the new row's default name
is immediately editable (`UX-213`). "Mesh" toggles a small nested submenu (`.add-submenu` in
`app.css`, reusing the top-level `.add-menu` positioning/dismissal styling) rather than creating
immediately, so `sphereGeometry`/`planeGeometry` (`primitives.ts`, new, alongside the pre-existing
`cubeGeometry`) both get a real menu entry rather than sitting unused. Both are the same
"faceted/flat-shaded, un-shared per-face-vertex normals" style `cubeGeometry` established (needed
because `packages/engine-three` never calls `computeVertexNormals()`) — `sphereGeometry` is a
low-poly icosahedron (20 triangular faces, 3 unshared vertices each) rather than a UV-sphere, and
`planeGeometry` is a single flat quad (its 4 corners ARE shared — one normal, no cross-face seam to
un-share). `encodeCubeBuffer` (name kept for backward compatibility with
`@gltf-studio/agent-mock`'s pre-existing add-cube template) works unchanged for both new shapes —
its implementation only ever reads `geometry.{positions,normals,indices}`. The Audio Emitter entry's
"silent/default source" question resolves in favor of generating one: `primitives.ts`'s new
`silentWavBuffer()` produces a minimal zero-filled 8kHz/16-bit mono WAV `data:` URI, because a
`KHR_audio_emitter` emitter with no `sources` at all — while structurally valid per the extension's
Object Model — has nothing for the Inspector's Audio section or `audio-webaudio`'s own audition
button to play, which would look just as "broken" as the pre-fix stub. Light/Audio Emitter both
scaffold their extension's `extensionsUsed` entry and root registry (`extensions.
KHR_lights_punctual.lights[]` / `extensions.KHR_audio_emitter.{audio,sources,emitters}[]`) the first
time either is used in a document, via the same find-or-create pattern `GraphEdit.ensureGraph`
(`DOC-041`) already established for `KHR_interactivity` — no new extension-scaffolding machinery was
needed. `RenderHost.patchScene`'s existing structural-patch classification (`specs/render-host.md`)
already routes every one of these appends (array adds, plus the non-pointer-value object values a
first-time extension scaffold writes) to a full `loadScene` reload — the same path
`@gltf-studio/agent-mock`'s add-cube template already exercised via Copilot, so no `RenderHost`/
`Viewport.tsx` change was needed. Camera/Light nodes render correctly on reload for free: `three/
addons/loaders/GLTFLoader.js` (already in use, `render-host.ts`) natively supports `KHR_lights_
punctual` and core `camera` nodes without any extra registration.

## Implementation notes (M8 part 1: node deletion)

`UX-214`'s "Delete" (user-reported bug: "I can add mesh, but can't delete it" — `SceneEdit.removeNode`
was a throwing M8 stub). `SceneTree.tsx`'s context-menu `actions` array gains a fourth `"delete"`
entry, its label computed by a new `packages/app/src/lib/gltf-scene.ts` helper,
`countSubtreeNodes(json, nodeIndex)` (a cycle-guarded `children` walk, same convention
`flattenSceneTree` already uses), calling the store's `deleteNode(nodeIndex)` action on select. That
store action (`app-store.ts`) is the ONE place that calls `SceneEdit.removeNode` — it dispatches the
returned command through the existing `dispatchCommand` (which already carries the play-mode freeze
guard, no new guard needed) and then calls `selectNode(parentIndex)` with `removeNode`'s own returned
post-delete parent index. `App.tsx` adds one more app-level `window` `keydown` listener (alongside its
existing drag/drop listener) for Delete/Backspace, mirroring `Viewport.tsx`'s own W/E/R
gizmo-shortcut focus-guard pattern (skip while an `INPUT`/`TEXTAREA`/`SELECT` has focus) plus an
extra `.closest(".monaco-editor")`/`isContentEditable` check so the shortcut never fires while typing
in the Script tab's Monaco editor; it reads `selectedNodeIndex` directly off the store and calls the
same `deleteNode` action the context menu uses. Deliberately NOT touched: `Viewport.tsx` (owned by
concurrent gizmo/camera work) — the viewport object's own right-click menu and any viewport-focused
delete shortcut are out of scope here, per `UX-207`'s own note.

## Implementation notes (M8 part 2: reparent + duplicate — scene authoring complete)

`UX-215`/`UX-216`/`UX-217`, backed by `specs/document-model.md`'s `DOC-052`/`DOC-053`
(`packages/editor-core/src/scene-edit.ts`'s `SceneEdit.reparentNode`/`duplicateNode`) — the last
structural gaps in scene authoring (`SceneEdit.reparentNode` had been the throwing M8-part-2 stub
noted throughout this file and `document-model.md` since M1). Both are wired through two new
`app-store.ts` actions, `reparentNode(nodeIndex, newParentIndex, insertIndex?)` and
`duplicateNode(nodeIndex)`, mirroring `deleteNode`'s own thin "call the `SceneEdit` factory, dispatch
through `dispatchCommand`" shape — `reparentNode`'s store action additionally catches
`CycleReparentError` and turns it into a `pushToast` rather than letting it propagate, so neither the
drag-and-drop handler nor the context-menu action needs its own `try`/`catch`; `duplicateNode`'s store
action additionally calls `selectNode(index)` on the new copy (`UX-202`), same as every `add*Node`
factory's own auto-select convention (`UX-213`).

`SceneTree.tsx`'s rows gain `tabIndex={0}` (previously plain, unfocusable `<div>`s) specifically so
Ctrl/Cmd+D (`UX-216`) has something concrete to scope itself to, plus five new drag-and-drop handlers
per row (`onDragOver`/`onDragLeave`/`onDrop`/`onDragEnd`, alongside the pre-existing `onDragStart` UX-209
already used) and two on the tree's own `panel-body` container (`onDragOver`/`onDrop`, for the
"drop onto empty background = reparent to root" gesture, `UX-215`) — a row's own `onDrop`/`onDragOver`
call `e.stopPropagation()` specifically so a drop ONTO a row never ALSO fires the container's
root-reparent handler. The existing drag source's `effectAllowed` changes from `"copy"` to
`"copyMove"` so a scene-tree row can serve as a valid drop target for a `"move"`-effect drop (this
change) without regressing its pre-existing role as a `"copy"`-effect drag source onto the behavior
graph canvas (`UX-209`, unchanged). A new `.tree-row.drag-over` CSS rule (`app.css`) is the "into" drop
indicator (`UX-215`'s own note on into-only v1 — no between-siblings indicator).

The context menu's `actions` array (`ContextMenu.tsx`, unchanged itself) gains two new entries between
the pre-existing four — "Duplicate" (between Rename and Ask Copilot) and "Reparent to root" (between
Ask Copilot and Delete) — per `UX-207`'s revised six-action order.

World-transform preservation (`DOC-052`) is implemented with a small, dependency-free `mat-utils.ts`
column-major `Mat4`/`Quat`/`Vec3` module (`packages/editor-core` deliberately carries no three.js/
gl-matrix dependency) — `mat4FromTranslationRotationScale`/`mat4Invert`/`mat4Multiply` lifted verbatim
from the same external math source `packages/audio-webaudio`'s own math helper already lifts from
(same element-layout convention as glTF's own `node.matrix`, so no reordering is ever needed), plus a
from-scratch `mat4Decompose` (matrix -> TRS, tolerant of a mirrored/negative-scale matrix) for writing
the solved local transform back out in TRS form when the node didn't already author a `matrix`. Both
`scene-edit.test.ts`'s hand-derived-expected-value scenarios and `property.test.ts`'s randomized
mixed-sequence suite verify the numeric claim against an INDEPENDENTLY reimplemented world-matrix
walk (not the production code's own helper) so a shared bug in the math can't hide behind a tautology.

Cycle rejection (`CycleReparentError`) is exercised at three layers: `packages/editor-core`'s own unit
+ property tests (`scene-edit.test.ts`, `property.test.ts`) prove `SceneEdit.reparentNode` itself
throws correctly and never partially applies; `app-store.ts`'s `reparentNode` action converts that
into a toast; and `e2e/scene-tree-reparent-duplicate.spec.ts` drives a real drag gesture (a node
dropped onto its own descendant) end to end and asserts the toast appears with the tree completely
unchanged. `racer.spec.ts` gains one more `test.step` reparenting a real checkpoint pylon under another
scenery node and back via undo, then re-confirming play still works — the same "stress case at real
366-node-graph scale" pattern its `DOC-048` deletion step already established, extended to prove
`DOC-054`'s "reparenting shifts no reference anywhere" claim holds at that scale too, not just in a
small unit-test fixture.

## Open questions

- RESOLVED(UX-asset-audio-tab-tbd) (Track A audio task, see `UX-218`..`222` above): the Audio Clips
  tab's rows are real now — list/import/add-by-reference/embed/delete/preview — via a dedicated
  management UI rather than Data-tab addressing; `UX-221` gives the specific reasoning for why
  extending the Data tab's own narrow addressing model wasn't judged necessary to close this.
