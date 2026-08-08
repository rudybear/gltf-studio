# document-model

Owns: `packages/editor-core/**` (see `specs/ownership.json`). **`packages/editor-core` is not yet
scaffolded** — this spec is written ahead of the package per the program plan's "Immediate next
steps" ("First three specs ... `DOC` (document model)"); the ownership glob is added now so
`scripts/check-drift.mjs`'s ownership-drift check governs the package from the moment it is
created, with no separate follow-up PR required to wire that up.

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

### Index-stability policy

- [DOC-019] (active) A command that structurally deletes an array element such that subsequent elements' indices shift emits, within the same patch set, reference-fixup patches that rewrite every reference elsewhere in the document to a shifted index.
- [DOC-020] (active) Reference-fixup patches (DOC-019) cover `KHR_interactivity` pointer strings — index references embedded as extension string values, not only RFC-6902 `path`/`from` fields — wherever such a string encodes a shifted index.
- [DOC-021] (active) All index-shift reference fixups are produced by one shared `fixupReferences` helper, used by every command capable of shifting indices, rather than each command re-implementing its own fixup logic.

### Dirty-root computation

- [DOC-022] (active) Every patch path is truncated to its canonical splice root via a fixed path→canonical-splice-root table (e.g. a patch under `/nodes/3/...` truncates to `/nodes/3`; a patch under `/extensions/KHR_interactivity/graphs/2/...` truncates to `/extensions/KHR_interactivity/graphs/2`).
- [DOC-023] (active) `applyCommand` adds the canonical splice root (DOC-022) of every patch it applies to the resulting document's `dirtyRoots` set.

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

### Property-test obligations

- [DOC-032] (active) For every command type, applying `command.patches` to a document and then applying that same command's `inverse` yields a `json` deep-equal to the document's `json` before `patches` was applied (command+inverse round-trip property).
- [DOC-033] (active) For any sequence of commands pushed onto a `HistoryStack` starting from a given document, calling `undo()` once per pushed command yields a `json` deep-equal to that document's `json` before the first command was pushed (undo-all ≡ initial property).
- [DOC-034] (active) For any sequence of commands followed by save, reparsing the saved bytes yields a `json` deep-equal to the in-memory `json`, and every byte span outside the dirty roots touched by that sequence is byte-identical to the pristine container's corresponding span (save invariant).

## Open questions

- OPEN: the precise rules for whether a coalesced sequence of commands (DOC-015) bumps `rev` (DOC-003) once per pushed command or once per coalesced group are not specified by the plan.
- OPEN: the full contents of the path→canonical-splice-root table (DOC-022) — every extension root that needs an entry, not only the three the plan names as examples (`/extensions/KHR_interactivity/graphs/{N}`, `/nodes/{i}`, `/extensions/KHR_audio_emitter`) — are not enumerated by the plan; DOC-022 requires such a table exist, but future PRs adding new editable extension roots must extend it.
- OPEN: `HistoryStack`'s maximum depth or any memory-eviction policy (e.g. capping undo depth) is not specified by the plan.
- OPEN: whether `applyCommand`/`HistoryStack` throw, no-op, or queue when a command is attempted while `EditorDocument` is frozen for play (DOC-031) is not specified by the plan.
