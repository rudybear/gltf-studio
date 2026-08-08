# 2. Document model: raw glTF JSON, edited via JSON-Patch commands

Status: active

## Context

`gltf-studio` edits glTF assets that must remain readable by every other conformant consumer
(the transpiler monorepo, three.js adapter, the VS Code graph viewer, any exported `.glb`'s
eventual runtime). Introducing a second, normalized in-memory model — and translating it back to
glTF JSON on save — risks the model and the file silently diverging, and duplicates validation
logic that already exists against raw glTF JSON (`@gltfi/ir`'s `checkModule`/`validateGraph`).

## Decision

Per Phase A of the program plan, the authored state is the **raw glTF JSON itself**, never a
second normalized model:

- `EditorDocument` holds the pristine last-saved parsed container, the current (immutable,
  structurally-shared) `json`, a revision counter, and the set of dirty roots.
- User intent is expressed through **command factories** (`GraphEdit.*`, `SceneEdit.*`,
  `AudioGraphEdit.*`) that compile into RFC-6902 JSON-Patch operations with precomputed inverses.
  `applyCommand` is pure, and undo is inverse-patch application; history is a linear patch log.
- Structural deletes emit full reference-fixup patches (including into interactivity pointer
  strings) via a shared `fixupReferences` helper.
- Derived views (scene tree, graph canvas, script panel, validation overlay) are memoized selectors
  over the `json`, never separately-maintained state.
- Save is dirty-root-scoped: each dirty root text-splices back into the original bytes via
  `locateJsonSpan`/`applyEdits` (byte-preservation is best-effort per root, with reserialize as a
  tested fallback — never a correctness risk).
- `JsonPatchOp` (the same RFC-6902 shape) is also the autosave/crash-recovery journal format and
  the anticipated future backend sync wire format (see `specs/engine-api.md`'s SP-004) — one patch
  representation, three uses.

`JsonPatchOp` itself is defined once, in the types-only `engine-api` package
(`packages/engine-api/src/json-patch.ts`), since it is shared across `RenderHost.patchScene`,
`StorageProvider.autosaveJournal`/`loadJournal`, and (once `editor-core` is scaffolded) the command
factories' inverse patches — not duplicated per consumer.

## Consequences

Every consumer of a `.glb`/`.gltf` produced by this editor reads exactly the format it always read;
there is no editor-specific serialization step that can drift from spec. The cost is that
structural edits (node reparenting, deletions) require careful reference-fixup rather than "just
edit the normalized graph and re-derive," and byte-preservation on save is necessarily best-effort
rather than guaranteed for every edit shape.
