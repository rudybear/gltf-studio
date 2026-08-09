# document-model

Owns: `packages/editor-core/**` (see `specs/ownership.json`). Implemented by `packages/editor-core`
as of milestone M1 (document core: `EditorDocument`, `applyCommand`, `HistoryStack`,
`GraphEdit`/`SceneEdit` command factories, byte-preserving `save`).

`editor-core` holds the authored document model (Phase A of the program plan): the raw glTF JSON
itself is the authored state (never a second normalized model), mutated only through immutable,
inverse-tracked commands with structural sharing, so undo/redo, dirty-tracking, and byte-preserving
save all fall out of one representation.

Prefix: `DOC`.

## Requirements

### EditorDocument shape

- [DOC-001] (active) `EditorDocument.container` holds the pristine parse of the last successful save — it is not mutated by any in-memory command application.
- [DOC-002] (active) `EditorDocument.json` is the current authored glTF JSON as an immutable value — no command ever mutates a `json` object in place.
- [DOC-003] (active) `EditorDocument.rev` is a revision counter that changes by exactly one on every operation that changes `json` (a command push, an undo, or a redo), giving `StorageProvider.autosaveJournal`'s `sinceRev` parameter (SP-004) a well-defined value to journal against.
- [DOC-004] (active) `EditorDocument.dirtyRoots` is the set of canonical splice-root JSON pointers (see DOC-021) whose subtree has changed since the last successful save.

### applyCommand purity and structural sharing

- [DOC-005] (active) `applyCommand(document, command)` is a pure function: called twice with the same `document` and `command`, it produces equal output and never mutates its `document` argument or that argument's `json`.
- [DOC-006] (active) In `applyCommand`'s output `json`, every subtree not addressed by one of `command.patches` retains the exact object identity (`===`) it had in the input `json` (structural sharing).

### Command shape

- [DOC-007] (active) A `Command` carries `patches: JsonPatchOp[]` — the forward RFC-6902 operations, precomputed against the document state at the command's creation time.
- [DOC-008] (active) A `Command` carries `inverse: JsonPatchOp[]` — precomputed at creation time such that applying `inverse` to the result of applying `patches` restores a `json` deep-equal to the pre-`patches` state.
- [DOC-009] (active) A `Command` carries a `label: string` — a human-readable description shown in history UI.
- [DOC-010] (active) A `Command` carries an optional `coalesceKey`; `HistoryStack.push` merges a newly pushed command into the current top-of-history entry when both share the same defined `coalesceKey` (DOC-015).

### HistoryStack semantics

- [DOC-011] (active) `HistoryStack.push(command)` applies `command.patches` to the current document and appends `command` to the undo log.
- [DOC-012] (active) `HistoryStack.push(command)` clears the redo log.
- [DOC-013] (active) `HistoryStack.undo()` applies the most recently pushed (or redone) command's `inverse` patches to the current document and moves that command from the undo log to the redo log.
- [DOC-014] (active) `HistoryStack.redo()` re-applies the most recently undone command's `patches` to the current document and moves that command from the redo log back to the undo log.
- [DOC-015] (active) `HistoryStack.push` coalesces two consecutive commands that share the same defined `coalesceKey` into a single history entry (one undo/redo step) rather than stacking them as two.
- [DOC-016] (active) `HistoryStack.transact(fn)` groups every command pushed during the synchronous execution of `fn` into a single undo/redo step.
- [DOC-017] (active) The undo/redo log is linear (no branching): once any command has been undone, pushing a new command discards the entire existing redo log.
- [DOC-018] (active) `undo`/`redo` restore prior document states exclusively by applying `inverse`/`patches` JSON-Patch operations — `HistoryStack` never restores state by rewinding to a stored document snapshot pointer.
- [DOC-035] (active) Resolves the open question of whether a coalesced sequence of commands (DOC-015) bumps `rev` (DOC-003) once per pushed command or once per coalesced group, in favor of the former: every call to `applyCommand` that succeeds — including each individual `HistoryStack.push` later merged by coalescing (DOC-015) or grouped by `transact` (DOC-016) — bumps `rev` by exactly one. Coalescing/transacting change only how many entries `HistoryStack`'s undo/redo logs contain, never how many times `rev` advances; a single `undo()`/`redo()` call over a coalesced-or-transacted entry (however many underlying commands it groups) is itself one operation and so bumps `rev` by exactly one, per DOC-003.
- [DOC-036] (active) Resolves the open question of `HistoryStack`'s maximum depth: undo/redo depth is unbounded in v1 — no maximum depth or eviction policy is enforced. A memory-eviction policy (e.g. capping undo depth) is deferred to a future milestone.

### Index-stability policy

- [DOC-019] (active) A command that structurally deletes an array element such that subsequent elements' indices shift emits, within the same patch set, reference-fixup patches that rewrite every reference elsewhere in the document to a shifted index.
- [DOC-020] (active) Reference-fixup patches (DOC-019) cover `KHR_interactivity` pointer strings — index references embedded as extension string values, not only RFC-6902 `path`/`from` fields — wherever such a string encodes a shifted index.
- [DOC-021] (active) All index-shift reference fixups are produced by one shared `fixupReferences` helper, used by every command capable of shifting indices, rather than each command re-implementing its own fixup logic.

### Dirty-root computation

- [DOC-022] (active) Every patch path is truncated to its canonical splice root via a fixed path→canonical-splice-root table (e.g. a patch under `/nodes/3/...` truncates to `/nodes/3`; a patch under `/extensions/KHR_interactivity/graphs/2/...` truncates to `/extensions/KHR_interactivity/graphs/2`).
- [DOC-023] (active) `applyCommand` adds the canonical splice root (DOC-022) of every patch it applies to the resulting document's `dirtyRoots` set.
- [DOC-039] (active) `HistoryStack.entries()` returns every undo-log and redo-log entry (one per coalesced/transacted push) in chronological push order regardless of how many have since been undone, each exposing a representative `label` (its first command's `Command.label`) and its zero-based `index` in that order; `HistoryStack.currentIndex()` returns the index of the most recently applied entry within that same order, or `-1` if none has been applied yet.
- [DOC-040] (active) `HistoryStack.onApply(handler)` registers a callback invoked, after `push`, `undo`, or `redo` mutates `document`, with exactly the forward-direction `JsonPatchOp[]` just applied to reach the new `document.json` (the command's `patches` for `push`/`redo`, its `inverse` for `undo`), so a caller (e.g. a `RenderHost` sync layer) can apply the same delta without recomputing a diff; returns an unsubscribe function.
- [DOC-038] (active) Resolves DOC-022's "full table" open question. The path→canonical-splice-root table is, in priority order: (1) `/extensions/KHR_interactivity/graphs/{N}/...` truncates to `/extensions/KHR_interactivity/graphs/{N}` — one interactivity graph is the editable unit, so any add/remove/reference-fixup entirely inside one graph (new nodes, declarations, variables, custom events, or index-shifted references) stays inside that graph's own root and never needs the reserialize fallback (DOC-025) merely for being "inside an existing graph"; (2) `/extensions/{name}/...` for any other extension (including `KHR_audio_emitter`, per the plan's own example) truncates to `/extensions/{name}` — the whole extension object is the root, so most future extensions need no table change at all, only ones wanting rule-1-style per-element granularity do; (3) `/{arrayRootKey}/{N}/...` for every top-level glTF array root (`nodes`, `meshes`, `materials`, `textures`, `images`, `samplers`, `skins`, `accessors`, `bufferViews`, `buffers`, `animations`, `scenes`, `cameras`) truncates to `/{arrayRootKey}/{N}` — one array element is the editable unit (this is also where `node.extras.gltfi.{x,y}`, DOC-027, ends up, since it is nested under a node root); (4) anything else (`/scene`, `/asset`, `/extensionsUsed`, `/extensionsRequired`, `/extras`, or any future unrecognized top-level key) truncates to that top-level key itself, since these are not arrays of independently-editable elements.

### Save semantics

- [DOC-024] (active) Save splices each entry in `dirtyRoots` into the pristine container's bytes independently, via `locateJsonSpan`/`applyEdits`, one root at a time.
- [DOC-025] (active) When a dirty root is newly created, or its position has been renumbered since the last save such that `locateJsonSpan` cannot locate a stable byte span for it, save falls back to reserializing the entire document for that save — the same fallback `spliceGraph` already uses.
- [DOC-026] (active) Save's byte output is identical to the pristine container's bytes at every byte span outside the dirty roots it spliced (byte-preservation outside dirty roots is asserted by the fallback path's own tests, not merely assumed).

### Node-position storage

- [DOC-027] (active) Editor-authored 2D positions for interactivity-graph canvas nodes are stored at `node.extras.gltfi.{x,y}` inside the authored glTF JSON, so positions travel with the exported file and are undoable through the normal command/patch mechanism.

### State homes

- [DOC-028] (active) Graph node positions (`node.extras.gltfi.{x,y}`, DOC-027) live in the authored asset (`EditorDocument.json`): they are saved with the `.glb`/`.gltf` and are undoable via `HistoryStack`.
- [DOC-029] (active) Panel layout and camera bookmarks live in a per-project sidecar persisted via `StorageProvider` (`ProjectData.sidecar`, SP-012) — not in the glTF JSON, and not undoable via `HistoryStack`.
- [DOC-030] (active) Selection, hover, and play-mode state live only in the ephemeral in-memory store — never written into `EditorDocument.json` or the sidecar.

### Document frozen during play

- [DOC-031] (active) `EditorDocument` is frozen for the duration of play mode: no `Command` may be applied to it (via `applyCommand` or `HistoryStack`) while `PlayController` is running. Play-mode state changes go exclusively through `PlayController`'s fan-out (`SceneAdapter.applyPointer`), never through `applyCommand`/`HistoryStack`.
- [DOC-037] (active) Resolves the open question of whether `applyCommand`/`HistoryStack` throw, no-op, or queue when a command is attempted while `EditorDocument` is frozen (DOC-031), in favor of throwing: `applyCommand` throws a typed `DocumentFrozenError` (not a no-op, not a queued/deferred application) when called against a frozen document; `HistoryStack.push`/`undo`/`redo` propagate the same error rather than swallowing it. UI command dispatch is expected to prevent commands from reaching `applyCommand` while play is running, upstream of this throw.

### Property-test obligations

- [DOC-032] (active) For every command type, applying `command.patches` to a document and then applying that same command's `inverse` yields a `json` deep-equal to the document's `json` before `patches` was applied (command+inverse round-trip property).
- [DOC-033] (active) For any sequence of commands pushed onto a `HistoryStack` starting from a given document, calling `undo()` once per pushed command yields a `json` deep-equal to that document's `json` before the first command was pushed (undo-all ≡ initial property).
- [DOC-034] (active) For any sequence of commands followed by save, reparsing the saved bytes yields a `json` deep-equal to the in-memory `json`, and every byte span outside the dirty roots touched by that sequence is byte-identical to the pristine container's corresponding span (save invariant).

### GraphEdit scaffolding helpers

- [DOC-041] (active) `GraphEdit.ensureGraph(document, graphIndex)` finds-or-scaffolds `extensions.KHR_interactivity.graphs[graphIndex]` (empty `types`/`declarations`/`variables`/`events`/`nodes` arrays, plus the extension's `graph` pointer and an `extensionsUsed` entry when either is missing) as a single command, returning a no-op command (empty `patches`/`inverse`) when that graph already exists — every other `GraphEdit` factory assumes its target graph already exists; this is the one factory a caller (e.g. `specs/ux-inspector.md`'s `UX-412` pointer-shortcut "Add pointer/…" actions) uses first when it can't assume that.
- [DOC-042] (active) `GraphEdit.ensureType(document, graphIndex, signature)` finds-or-appends a `{ signature }` entry into `graph.types`, mirroring `ensureDeclaration`'s (DOC-021) find-or-append semantics for `graph.declarations`, so a caller that must populate a node's `configuration.type` (a `graph.types` index) gets a stable index without duplicating an already-declared signature.
- [DOC-043] (active) `GraphEdit.replaceGraph(document, graphIndex, newGraph)` replaces `extensions.KHR_interactivity.graphs[graphIndex]` wholesale with `newGraph` as a single command whose forward patch is one `replace` at the graph root and whose inverse restores the prior graph value exactly (DOC-007/DOC-008) — it does not diff node-by-node. `specs/ux-script.md`'s `UX-711` "Apply → Graph" action is this factory's one caller: it swaps in a freshly parsed-and-exported script as one undo/redo step.
- [DOC-044] (active) `GraphEdit.setNodeConfig(document, graphIndex, nodeIndex, field, value)` sets `nodes[nodeIndex].configuration[field]` to `{ value }` (add-or-replace), mirroring `setLiteral`'s shape for `values` — the generic single-field config primitive M4's config-field editor (`specs/ux-graph-canvas.md`'s config-editing note) and the pointer-picker dialog's retarget flow (`specs/ux-pointer-picker.md`'s `UX-906`) build their specific edits on top of, alongside `ensureType` (DOC-042) when a field's value needs a fresh `types[]` index. `GraphEdit.addPointerNode`'s `kind` parameter additionally accepts `"get"` (alongside `"set"`/`"interpolate"`) as of the same change, for `specs/ux-graph-canvas.md`'s `UX-508` drag-drop drop-menu's `pointer/get` option.

## Open questions

All four open questions this spec previously carried were resolved in the M1 PR that scaffolded
`packages/editor-core` (see DOC-035, DOC-036, DOC-037, DOC-038 above for the resolutions
themselves): rev-bump semantics under coalescing (DOC-035), `HistoryStack` depth (DOC-036),
command-during-play-freeze behavior (DOC-037), and the full splice-root table (DOC-038). None
remain open as of M1.

Future PRs that add a new editable extension root ahead of DOC-038's rule 2 default (i.e. wanting
rule-1-style per-element granularity for some extension other than `KHR_interactivity`) should
extend DOC-038's table directly rather than reopening this section.
