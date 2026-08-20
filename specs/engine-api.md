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

At M2, `self-check.test.ts` stopped instantiating `describeStorageProviderContract` (it now runs
real assertions — see `specs/storage-provider.md` — rather than an inventory of `it.todo`s, so it
needs a real `StorageProvider` instead of the placeholder "no implementation yet" factory every
other still-`it.todo` contract here still uses); it is exercised for real instead by
`@gltf-studio/storage`'s own tests. Same rationale as the barrel-file note above: not itself a
change to this file's requirements, noted here for the same file-level-glob accountability reason.

As of the M8-copilot phase-1 PR, `self-check.test.ts` similarly stopped instantiating
`describeAgentServiceContract` as a throwing M0 stub (`throw new Error("no AgentService
implementation yet ...")`) alongside `describeRenderHostContract`/`describeAudioHostContract` — it
now runs real assertions against a real `AgentServiceHarness` (see `specs/agent-service.md`), and is
exercised for real instead by `@gltf-studio/agent-mock`'s own `contract.test.ts`, against
`MockAgentProvider`. `RenderHost`/`AudioHost` remain unimplemented-here stubs in that same file,
unaffected by this change. Same rationale as the two notes above: not itself a change to this file's
requirements, noted here for the same file-level-glob accountability reason.

This file was originally a **seed**, not a full spec: it transcribed ~10 requirements directly
from the program plan's Phase A prose to give the drift-checking tooling something real to check
from commit one. The `RH` (RenderHost) and `SP` (StorageProvider) requirements that were seeded
here have since moved to their own full specs — `specs/render-host.md` and
`specs/storage-provider.md` respectively — per the plan's "Immediate next steps"; the `DOC`
(document model, owned by the not-yet-scaffolded `editor-core` package) spec was written fresh as
`specs/document-model.md`. This file now owns only the `PC` (PlayController), `AH` (AudioHost), and
`AGH` (AudioGraphHost) requirements, and remains a seed for those three pending their own follow-up
spec tasks.

Prefixes used below: `PC` (PlayController), `AH` (AudioHost), `AGH` (AudioGraphHost). `PC-002` was
the one gap reserved for a follow-up spec task (see the previous revision of this note); it is now
filled in by `PC-002` below, along with `PC-004`..`PC-008`, which resolve the three `OPEN(...)`
comments that were embedded directly in `packages/engine-api/src/play-controller.ts` (inspect()'s
shape, start()'s return contract, and onDiagnostic()'s payload shape) plus the cross-file tension
between this file's `PC-003` and `specs/render-host.md`'s `RH-024` over what "the scene snapshot"
`stop()` restores actually means.

**Moved**: RH-001, RH-002, RH-003 moved to `specs/render-host.md` (same IDs, per
`specs/README.md`'s "numbers are never reused" rule — see that file, not here, for their current
text). SP-001, SP-004 moved to `specs/storage-provider.md` likewise.

**RESOLVED(EA-pickresult-shape-tbd)** (M2, `engine-three`): `packages/engine-api/src/value-types.ts`'s
`PickResult` (owned by this file per `specs/ownership.json`, even though it's `RenderHost.pick()`'s
return type — see that file's own header comment on why value-types.ts stays engine-api-owned as a
whole) gained a `distance: number` field alongside `nodeIndex`/`point`. The resolution narrative
lives in `specs/render-host.md`'s "Open questions" (that's the spec whose `RH-015` requirement
`pick()` implements), not duplicated here; this note exists only so this file's own ownership-drift
obligation (a `value-types.ts` change requires an `engine-api.md` diff) is honestly satisfied rather
than routed around.

**Follow-up** (same ownership note as above, same rationale): `value-types.ts` also gained a new
`PickOptions` interface (`{ ignoreEligibility?: boolean }`), `RenderHost.pick()`'s new optional third
parameter. The requirement text and full narrative (a user-reported bug: EDIT-mode viewport clicks on
a node with `KHR_node_selectability`'s `selectable: false` silently did nothing) live in
`specs/render-host.md`'s `RH-027` and `specs/ux-viewport.md`'s `UX-312` — not duplicated here, for the
same "diff satisfied honestly, not routed around" reason as `EA-pickresult-shape-tbd` above.

## Requirements

- [PC-001] (active) `PlayController.start(options)` accepts `options.engine` of `"interpreter"` or `"compiled"`; play mode drives the scene only through the fan-out `SceneAdapter.applyPointer -> renderHost ‖ audioHost`, never by mutating the edited document.
- [PC-002] (active) `PlayController.inspect()` returns `{ time: number; variables: Record<string, unknown>; sentEvents: readonly unknown[] }`; `variables` is keyed by each variable's declared `id` from the document's `KHR_interactivity` graph where the graph declares one, and by its numeric index (as a string) otherwise; `sentEvents` mirrors the underlying engine's `sentEvents` at the most recent tick.
- [PC-003] (active) `PlayController.stop()` contractually reloads the scene snapshot captured at play-start — the guaranteed-correct v1 restore for the known dispose/hot-reload lifecycle gap (see the program plan's "Greenfield gaps the project must build").
- [PC-004] (active) `PlayController.start(options)` returns `Promise<void>`, resolving once the interpreter or compiled engine has been constructed, bound to the fan-out `SceneAdapter`, and started (i.e. play is already ticking by the time the promise resolves); it rejects (without partially mutating play state) if engine construction fails (e.g. a compiled-engine emit/import error).
- [PC-005] (active) `PlayController.onDiagnostic(handler)` delivers `{ kind: "unhandled-pointer" | "engine-error"; message: string; pointer?: string }` events raised either by the fan-out `SceneAdapter` (an `applyPointer` call the active `RenderHost`/`AudioHost` could not resolve) or by an uncaught engine error during a tick; returns an unsubscribe function.
- [PC-006] (active) `PlayController.stop()` returns `Promise<void>`; it is idempotent (calling `stop()` when already stopped resolves immediately without re-invoking `renderHost.loadScene`), and while a `stop()` call's returned promise is pending, `start()` must not be called again (callers await `stop()` before restarting).
- [PC-007] (active) Resolves the tension `specs/render-host.md`'s `RH-024` OPEN note raised against `PC-003`: "the scene snapshot" `PlayController.stop()` restores is the `EditorDocument.json` captured at the moment `start()` was called (not `RenderHost.snapshot()`'s rendered-image Blob, which remains solely for `RH-024`'s image-export use case); `stop()` restores by calling `renderHost.loadScene({ json, binary })` with that captured JSON AND the binary `getBinary()` returned at that same `start()` call (fix: the binary was previously dropped, which silently rendered no meshes at all for any document whose buffer isn't a `data:` URI — i.e. most real-world `.glb`s, and always true of a multi-file `.gltf` import packed via `packMultiFileGltf`, specs/ux-shell.md UX-115).
- [PC-008] (active) While play mode is `playing` or `paused` (i.e. between `start()` resolving and `stop()` being called), viewport pointer picks are routed to the active engine's `EngineInteractive.fireSelect`/`fireHoverIn`/`fireHoverOut` (from `@gltfi/runtime`/`@gltfi/runtime-lib`) instead of the editor's own `selectNode`/hover state — both the interpreter engine (via `InteractivityRuntime.asEngineLike()`) and the compiled engine (the `EngineFactory` result) satisfy this same `EngineInteractive` surface, so play-mode pointer routing is identical across both `engine` kinds.
- [AH-001] (active) `AudioHost.init()` is gesture-gated: it must not create or resume a browser `AudioContext` before a user gesture has occurred.
- [AH-002] (active) `AudioHost`'s method surface in v1 is exactly `init/loadEmitters/applyPointer/setListenerPose/auditionEmitter` plus the `suspend/resume/dispose` lifecycle — no additional emitter-authoring methods.
- [AGH-001] (active) `AudioGraphHost` builds and runs `KHR_audio_graph` via AudioGraphJS's `buildGraph` and exposes lint results — combining AudioGraphJS's own `lint.ts` with this project's audio-graph gap-analysis constraints (DAG-only; no cycles, envelopes, or param-modulation in v1) — to the audio-graph canvas.

## Implementation notes

- Usage mapping (`specs/render-host.md`'s `RH-029`/`RH-030`, a new `RenderHost.setReferenceHighlight`
  method): the fake `RenderHost` test doubles this file's own `PlayController` coverage builds
  (`packages/contract-tests/src/play-controller.ts`'s harness, `packages/play/src/play-controller.
  test.ts`'s local fixture) gained a no-op `setReferenceHighlight` stub alongside their existing
  `setHighlight` one, purely to keep satisfying the widened `RenderHost` interface — no
  `PlayController`/`PC-###` behavior here changed or depends on the new method.

## Open questions

- RESOLVED(AH-init-signature-tbd) (by `audio-webaudio`, M7): the gesture is an app-side calling-convention obligation, not something `init()` detects itself — see `packages/engine-api/src/audio-host.ts`'s updated doc comment on `init()`.
- RESOLVED(AH-loademitters-shape-tbd) (by `audio-webaudio`, M7): `loadEmitters(json)` accepts the full glTF document, or the `{ json, binary }` container shape mirroring `specs/render-host.md`'s RH-loadscene-shape-tbd resolution for `RenderHost.loadScene` — see `packages/engine-api/src/audio-host.ts` and `@gltf-studio/audio-webaudio`'s `WebAudioHost.loadEmitters`/`LoadEmittersInput` doc comments for the full contract (idempotent rebuild, `bufferView` vs `data:`-URI resolution, external-URI gap).
- RESOLVED(AH-pointer-value-tbd) (by `audio-webaudio`, M7): accepts the three-adapter's `number[] | number` at runtime (only the first element is read — every audio pointer is scalar-valued); silently ignores anything outside the audio extension pointer families rather than throwing, since PC-001's fan-out calls both `RenderHost` and `AudioHost` unconditionally for every pointer write. `WebAudioHost` additionally documents one nonstandard pointer it matches: `/extensions/KHR_audio_emitter/sources/{i}/playing`, a one-shot playback trigger with no basis in the base `KHR_audio_emitter` spec's Object Model (this project's own prototype for interactivity-driven sample triggering, e.g. a drum pad) — not guaranteed portable to another `AudioHost` implementation.
- RESOLVED(AH-listenerpose-shape-tbd) (by `audio-webaudio`, M7): confirmed as `RenderHost`'s `CameraPose` (not a distinct type) — both describe a position+orientation in one scene coordinate space, and the intended v1 usage drives both hosts from the same one per-frame camera pose while playing. `setListenerPose` doubles as `AudioHost`'s sole per-frame update hook (zone crossfade, doppler, cone/air-absorption filtering), replacing the lifted `AudioSystem`'s separate camera-coupled `update()` method — see `WebAudioHost.setListenerPose`'s doc comment.
- RESOLVED(AH-audition-signature-tbd) (by `audio-webaudio`, M7): confirmed as an emitter index (`extensions.KHR_audio_emitter.emitters` array), matching `specs/ux-inspector.md`'s UX-406 Audition control.
- RESOLVED(AGH-buildgraph-signature-tbd) (by `audio-graph`, M7): mirrors `AudioHost.loadEmitters`'s resolution above — the full glTF document (or `{ json, binary }`), not a pre-resolved `KHR_audio_graph` slice, since a graph's nodes reference `KHR_audio_emitter`'s `sources`/`emitters` by index and AudioGraphJS's own `parseLayeredExtensions` requires the same. Parsing/linting need no `AudioContext`; real Web Audio node construction is deferred to `audition()` — see `packages/engine-api/src/audio-graph-host.ts`'s updated doc comment on `buildGraph`.
- RESOLVED(AGH-lint-shape-tbd) (by `audio-graph`, M7): `AudioGraphLintResult[]`, one entry per violation: `{ graphIndex: number; severity: "error" | "warning"; code: string; message: string; nodeIds: string[] }` — `message` always names the specific nodes involved in plain language (`specs/ux-audio-graph.md`'s UX-602), `nodeIds` the ordered node-label path for a cycle (empty when not applicable). See `packages/engine-api/src/audio-graph-host.ts`'s updated doc comment.
- RESOLVED(AGH-audition-signature-tbd) (by `audio-graph`, M7): confirmed as a node id (a `KHRGraphNodeSpec.label`, or `node_{i}` for an unlabeled node).
- RESOLVED(AGH-trace-shape-tbd) (by `audio-graph`, M7): a snapshot accessor returning `string[]` — the accumulated lines from AudioGraphJS's own `createMemoryTrace()` `TraceLogger`, not a subscribe-style live stream. Minimal by design, matching the plan's "trace hooks" phrasing.
- OPEN(AGH-lifecycle-tbd) remains open (unchanged by this milestone): `AudioGraphHost` still has no interface-level `dispose`/lifecycle method; `@gltf-studio/audio-graph`'s concrete `AudioGraphJsHost` exposes its own extra, non-interface `close()` for the host app to call on unmount, the same pattern `WebAudioHost.getDiagnostics()` already establishes for `AudioHost`.
- Emitter/environment/listener authoring (audio pass 3/3, `specs/ux-inspector.md`'s `UX-419`..`423`): `AH-002`'s method surface is UNCHANGED (still exactly `init/loadEmitters/applyPointer/setListenerPose/auditionEmitter` + lifecycle) — this pass only widens which pointer FAMILIES `applyPointer` recognizes, extending `AH-pointer-value-tbd`'s resolution above rather than reopening it. Newly matched: `/extensions/KHR_audio_emitter/emitters/{i}/positional/(refDistance|maxDistance|coneInnerAngle|coneOuterAngle|coneOuterGain)`, applied directly onto the live `PannerNode` (these five are plain PannerNode attributes, not `AudioParam`s, per the Web Audio API — no `setTargetAtTime` smoothing needed or possible; angle values convert radians, the glTF unit, to degrees, the PannerNode unit, at the boundary). Every OTHER new emitter/environment/listener field this pass's Inspector UI adds (type, distance model, shape, rolloff factor — deliberately excluded from the direct-apply set because it interacts with `buildEmitterChain`'s custom-distance-curve special case, which zeroes `rolloffFactor` and adds a `distanceGain` node — source loop/autoplay/clip rebinding, and every `KHR_audio_environment` environment/listener/zone/scene-binding field) is NOT wired through `applyPointer` at all; `packages/app`'s `attachAudioHost` already reloads (`loadEmitters`, a full idempotent rebuild) on every `HistoryStack.onApply`, so every one of those fields still renders — see `specs/ux-inspector.md`'s `UX-423` for the full split and its honest gaps (a reload cuts a currently-playing Audition voice; Audition's listener pose is the Web Audio API default, not live-fed from the viewport camera outside play mode).
