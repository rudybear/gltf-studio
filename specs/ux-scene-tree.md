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

- [UX-205] (active) The scene tree's "+ Add" control opens a menu with exactly five entries, in this order: Mesh, Light, Camera, Audio Emitter, Empty Group. "Mesh" expands its own submenu (Cube, Sphere, Plane) rather than creating directly; this still counts as one top-level entry for this requirement's "exactly five" count.
- [UX-206] (active) M8-lite: choosing an add-menu entry creates real content via one of the append-only `SceneEdit.add*Node` factories (`specs/document-model.md`'s `DOC-047`) — Mesh's Cube/Sphere/Plane submenu options each add a small procedurally-generated primitive mesh (`packages/editor-core/src/primitives.ts`); Light adds a `KHR_lights_punctual` point light; Camera adds a perspective camera; Audio Emitter adds a `KHR_audio_emitter` positional emitter wired to a generated silent clip (so it is immediately auditionable, not a dead reference); Empty Group adds a plain, mesh/light/camera/emitter-less node. Each is ONE undoable history entry, even where it spans several document arrays (e.g. Mesh's buffer+bufferViews+accessors+material+mesh+node). This supersedes this requirement's earlier "may be a stub" wording — `SceneEdit.*`'s structural factories landed ahead of schedule (ADR-0004) precisely so this could go real before milestone M8; only reparenting/deleting an EXISTING node remains M8 (`SceneEdit.removeNode`/`reparentNode` still throw).
- [UX-213] (active) M8-lite: a newly created add-menu node is appended as the LAST child of the currently-selected node when one is selected, else as the last root child of the current default scene (append-only: no reordering, no reparenting of anything that already existed); it is immediately selected (`UX-202`) and its default name opens in the same inline-rename text field `UX-207`'s context-menu "Rename" action uses, so the generic default name ("Cube", "Point Light", "Camera", "Audio Emitter", "Empty Group") is one keystroke away from being replaced.

### Right-click context menu

- [UX-207] (active) Right-clicking a scene-tree row or a viewport object opens a context menu positioned at the cursor, closing on an outside click or Escape. The scene-tree row's menu has exactly FOUR actions — Frame, Rename, "✦ Ask Copilot about this…", Delete (`UX-214`) — the viewport object's menu still has exactly the original three (Frame, Rename, "✦ Ask Copilot about this…"); see `UX-214`'s own note for why Delete is scene-tree-only for now. (Supersedes this requirement's original "exactly three actions" wording, which predated `UX-214`.)
- [UX-208] (active) Choosing "✦ Ask Copilot about this…" switches the right panel to the Copilot tab and adds exactly one context chip naming the right-clicked object, per `AG-015`'s "same request/response contract, differing only in prefilled context" inline-affordance contract (see `specs/ux-copilot.md`'s `UX-1008`).
- [UX-214] (active) M8 part 1 (`specs/document-model.md`'s `DOC-048`): the scene-tree row's context menu gains a "Delete" action — labeled "Delete" for a childless node, or "Delete (N nodes)" when the node has descendants (`SceneEdit.removeNode` always deletes the whole subtree as one command, never just the one row) — and the Delete/Backspace key deletes the currently-selected scene node the same way, whenever a scene node is selected AND keyboard focus is not inside a text input, a `<select>`, or the Script tab's Monaco editor (an app-level `keydown` handler, not scoped to the scene tree, so the shortcut works regardless of which panel has focus). Both paths call the SAME store action, dispatched through the existing `dispatchCommand` play-mode freeze guard (`specs/document-model.md`'s `DOC-031`) — deleting is blocked while playing exactly like every other edit, with no separate guard needed. After a successful delete, selection moves to the deleted node's former parent, or clears entirely when the deleted node was a scene-root (`DOC-048`'s `parentIndex` return value). Undo restores the entire subtree, every fixed-up reference, AND the pre-delete selection is NOT automatically restored by undo itself (selection is ephemeral store state per `DOC-030`, outside `HistoryStack`) — undoing a delete leaves selection wherever it last was, which may still be the post-delete parent. Delete is scene-tree-only for now, not added to the viewport object's own right-click menu (`Viewport.tsx`) or as a viewport-focused keyboard shortcut — deliberately out of scope for this change to avoid touching viewport interaction code owned by concurrent work; a future pass can extend it there.

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

## Open questions

- OPEN(UX-asset-audio-tab-tbd): the approved mockup leaves the Audio Clips tab's rows unwired
  (no click behavior) because clip assets aren't part of the glTF node/mesh/material/accessor
  addressing model the Data tab (`specs/ux-data-tab.md`) currently resolves; whether/how Audio
  Clips rows become inspectable is deferred.
