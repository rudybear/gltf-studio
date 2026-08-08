# engine-api

Owns: `packages/engine-api/src/{json-patch,value-types,play-controller,audio-host,audio-graph-host,index}.ts`,
`packages/contract-tests/src/{play-controller,audio-host,index,self-check.test}.ts` (see
`specs/ownership.json` — `render-host.ts`/`storage-provider.ts` and their contract-test files are
now owned by `specs/render-host.md`/`specs/storage-provider.md` respectively; `agent-service.ts` in
both packages is likewise owned by `specs/agent-service.md`, not this file).

`packages/engine-api` is the types-only editor↔engine interface layer (Phase A of the program
plan): `RenderHost`, `PlayController`, `AudioHost`, `AudioGraphHost`, `StorageProvider`, plus the
shared value types they use. `packages/contract-tests` exports a vitest describe-factory per
interface that any implementation must pass before the app registers it. Both packages' `index.ts`
and (for `contract-tests`) `self-check.test.ts` barrel/aggregate every interface, including
`AgentService` (`specs/agent-service.md`) as of the agentic-authoring work — a barrel-file change
that only adds a re-export of an already-independently-specified module is not itself a change to
this file's requirements, but is noted here so the ownership-drift check's file-level (not
package-wide) globs on these two files stay accountable to a real cross-reference rather than a
silent touch.

This file was originally a **seed**, not a full spec: it transcribed ~10 requirements directly
from the program plan's Phase A prose to give the drift-checking tooling something real to check
from commit one. The `RH` (RenderHost) and `SP` (StorageProvider) requirements that were seeded
here have since moved to their own full specs — `specs/render-host.md` and
`specs/storage-provider.md` respectively — per the plan's "Immediate next steps"; the `DOC`
(document model, owned by the not-yet-scaffolded `editor-core` package) spec was written fresh as
`specs/document-model.md`. This file now owns only the `PC` (PlayController), `AH` (AudioHost), and
`AGH` (AudioGraphHost) requirements, and remains a seed for those three pending their own follow-up
spec tasks.

Prefixes used below: `PC` (PlayController), `AH` (AudioHost), `AGH` (AudioGraphHost). Gaps in
numbering (e.g. no `PC-002` yet) are reserved for requirements a follow-up spec task will add — not
a sign of an accidentally skipped ID.

**Moved**: RH-001, RH-002, RH-003 moved to `specs/render-host.md` (same IDs, per
`specs/README.md`'s "numbers are never reused" rule — see that file, not here, for their current
text). SP-001, SP-004 moved to `specs/storage-provider.md` likewise.

## Requirements

- [PC-001] (active) `PlayController.start(options)` accepts `options.engine` of `"interpreter"` or `"compiled"`; play mode drives the scene only through the fan-out `SceneAdapter.applyPointer -> renderHost ‖ audioHost`, never by mutating the edited document.
- [PC-003] (active) `PlayController.stop()` contractually reloads the scene snapshot captured at play-start — the guaranteed-correct v1 restore for the known dispose/hot-reload lifecycle gap (see the program plan's "Greenfield gaps the project must build").
- [AH-001] (active) `AudioHost.init()` is gesture-gated: it must not create or resume a browser `AudioContext` before a user gesture has occurred.
- [AH-002] (active) `AudioHost`'s method surface in v1 is exactly `init/loadEmitters/applyPointer/setListenerPose/auditionEmitter` plus the `suspend/resume/dispose` lifecycle — no additional emitter-authoring methods.
- [AGH-001] (active) `AudioGraphHost` builds and runs `KHR_audio_graph` via AudioGraphJS's `buildGraph` and exposes lint results — combining AudioGraphJS's own `lint.ts` with this project's audio-graph gap-analysis constraints (DAG-only; no cycles, envelopes, or param-modulation in v1) — to the audio-graph canvas.
