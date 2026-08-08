# engine-api

Owns: `packages/engine-api/**`, `packages/contract-tests/**` (see `specs/ownership.json`).

`packages/engine-api` is the types-only editor↔engine interface layer (Phase A of the program
plan): `RenderHost`, `PlayController`, `AudioHost`, `AudioGraphHost`, `StorageProvider`, plus the
shared value types they use. `packages/contract-tests` exports a vitest describe-factory per
interface that any implementation must pass before the app registers it.

This file is a **seed**, not the full spec: it transcribes ~10 requirements directly from the
program plan's Phase A prose to give the drift-checking tooling something real to check from
commit one. The full `RH` (RenderHost), `SP` (StorageProvider), and `DOC` (document model, owned
by the not-yet-scaffolded `editor-core` package) specs are a dedicated follow-up task per the
plan's "Immediate next steps" — expect this file to grow substantially, and expect some of these
IDs' statements to be refined (not renumbered — see `specs/README.md`'s "numbers are never reused"
rule) once that task lands.

Prefixes used below: `RH` (RenderHost), `PC` (PlayController), `AH` (AudioHost), `AGH`
(AudioGraphHost), `SP` (StorageProvider). Gaps in numbering (e.g. no `PC-002` yet) are reserved for
requirements the follow-up spec task will add — not a sign of an accidentally skipped ID.

## Requirements

- [RH-001] (active) `RenderHost.patchScene(patches)` returns `"needs-reload"` for any structurally changing patch in v1 (the interpreter/renderer does not attempt a live structural splice); non-structural patches apply via the fast path and return `"applied"`.
- [RH-002] (active) The editor must never import a rendering library (three.js or otherwise) directly — all viewport access goes through `RenderHost`, so a second implementation (e.g. gltf-webgpu) can be added later without editor changes.
- [RH-003] (active) `RenderHost.attachGizmo`/`onGizmoChange` distinguishes a `"drag"` phase (live pointer writes, no history entry) from a `"commit"` phase (exactly one `SceneEdit.setTransform` command, undoable) for the same gesture.
- [PC-001] (active) `PlayController.start(options)` accepts `options.engine` of `"interpreter"` or `"compiled"`; play mode drives the scene only through the fan-out `SceneAdapter.applyPointer -> renderHost ‖ audioHost`, never by mutating the edited document.
- [PC-003] (active) `PlayController.stop()` contractually reloads the scene snapshot captured at play-start — the guaranteed-correct v1 restore for the known dispose/hot-reload lifecycle gap (see the program plan's "Greenfield gaps the project must build").
- [AH-001] (active) `AudioHost.init()` is gesture-gated: it must not create or resume a browser `AudioContext` before a user gesture has occurred.
- [AH-002] (active) `AudioHost`'s method surface in v1 is exactly `init/loadEmitters/applyPointer/setListenerPose/auditionEmitter` plus the `suspend/resume/dispose` lifecycle — no additional emitter-authoring methods.
- [AGH-001] (active) `AudioGraphHost` builds and runs `KHR_audio_graph` via AudioGraphJS's `buildGraph` and exposes lint results — combining AudioGraphJS's own `lint.ts` with this project's audio-graph gap-analysis constraints (DAG-only; no cycles, envelopes, or param-modulation in v1) — to the audio-graph canvas.
- [SP-001] (active) All project persistence goes through `StorageProvider` (`listProjects/create/load/save`); concrete implementations at v1 are IndexedDB and File System Access, with an HTTP implementation planned later, and editor code must depend only on the interface, never on a concrete implementation.
- [SP-004] (active) `StorageProvider.autosaveJournal(sinceRev, patches)` is patch-shaped (RFC 6902 `JsonPatchOp[]`), doubling as the future backend sync wire format; `loadJournal` returns the same patch-journal shape for crash recovery (crash recovery ≡ sync protocol).
