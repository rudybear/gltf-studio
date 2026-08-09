# agent-service

Owns: `packages/engine-api/src/agent-service.ts`, `packages/contract-tests/src/agent-service.ts`
(see `specs/ownership.json`).

`AgentService` is the editor's agentic-authoring boundary (per user direction — see
`docs/adr/0004-agentic-authoring-as-command-producer.md`): creators drive creation via prompts and
other inputs **alongside**, never instead of, direct manipulation. v1's capability scope is the full
creative loop — wiring behavior (`GraphEdit.*`/`AudioGraphEdit.*`) and audio, scene arrangement
(`SceneEdit.*`), and asset generation (procedural meshes/materials/audio) are all promptable.

The core architectural commitment this spec encodes, normatively: **the agent is a command
producer, never a privileged writer.** `AgentService`'s output is a `Proposal` whose `commands` are
built via the same command factories (`GraphEdit.*`, `SceneEdit.*`, `AudioGraphEdit.*`, and
asset-generation command factories) the direct-manipulation UI uses to build `Command`s (see
`specs/document-model.md`'s `DOC-007..010`). Proposals apply as a single `HistoryStack.transact`
transaction, are previewable as a diff, rejectable, and undoable once accepted; they must pass the
same validation gates (`checkModule`/`validateGraph`, and `EQUIV` wherever a proposal's summary
claims a behavior-neutral change) before acceptance is even offered. There is no agent-only write
path: an accepted proposal's history entry, journal entry, and save behavior are indistinguishable
from a manually-authored command's.

LLM provisioning is deferred: v1 ships this interface plus a mock/offline provider only (`AG-010`).
Real providers (bring-your-own-key direct-from-browser, or a hosted proxy) arrive later as
additional implementations of the same interface (`AG-011`).

Prefix: `AG`.

## Requirements

### Request/response shape

- [AG-001] (active) `AgentService.request(prompt, context)` accepts a natural-language `prompt: string` plus `context: AgentContextRef[]` and returns `Promise<Proposal>`.
- [AG-002] (active) `AgentContextRef` covers at minimum three kinds of context an editor can attach to a request: the current selection, a reference into the interactivity-graph index (a specific graph/node), and an explicit user-attached chip (any object/asset the user manually attaches beyond the auto-populated selection).

### Commands are produced through existing factories, never a parallel path

- [AG-003] (active) `Proposal.commands` is a `CommandLike[]` (see `packages/engine-api/src/agent-service.ts`'s `CommandLike`; `editor-core`'s `Command`, `DOC-007..010`, is `CommandLike & { coalesceKey?: string }` per DOC-007..010's unification note) built exclusively via the same command factories (`GraphEdit.*`, `SceneEdit.*`, `AudioGraphEdit.*`, and the asset-generation command factories) the direct-manipulation UI uses — no distinct agent-only command type or agent-only patch shape exists anywhere in the stack.

### Transactional application

- [AG-004] (active) Accepting a `Proposal` applies its `commands` to the document via exactly one `HistoryStack.transact` call (`DOC-016`), producing a single undo/redo step regardless of how many individual commands the proposal bundles.
- [AG-005] (active) Once applied via `HistoryStack.transact` (`AG-004`), an agent-originated history entry is structurally indistinguishable from a manually-authored one: same `Command` shape (`DOC-007..010`), same autosave-journal format (`JsonPatchOp`, `SP-004`), and same save path (`DOC-024..026`) — no privileged or agent-only write path exists at any layer.

### Pre-acceptance validation

- [AG-006] (active) Before acceptance is offered, `AgentService` (or its caller, before invoking `HistoryStack.transact`) runs every proposal's `commands` through the same validation gates a manual edit of equivalent shape would be subject to — `checkModule`/`validateGraph` for interactivity-graph correctness — and attaches the result as `Proposal.validationReport`.
- [AG-007] (active) Wherever a `Proposal.summary` asserts that its change is behavior-neutral (e.g. a refactor-style proposal), `Proposal.validationReport` includes an `EQUIV` check result for that claim; a behavior-neutral claim with no corresponding `EQUIV` result is not eligible for one-click acceptance.
- [AG-008] (active) A `ValidationReport` containing any error-level finding is not eligible for one-click acceptance — the UI must surface the failing finding(s) before offering to apply the proposal.

### Reject/discard semantics

- [AG-009] (active) Rejecting or discarding a `Proposal` performs zero mutation of `EditorDocument` — no `commands` are applied and no `HistoryStack` entry (undo or redo) is created — so a rejected proposal never requires an explicit undo step to "clean up" after it.

### Mock provider and pluggability

- [AG-010] (active) v1 ships a mock/offline `AgentService` implementation that returns deterministic proposals (canned or rule-based) without making any network call, registered as a first-class, always-available provider — not a placeholder removed once a real provider lands.
- [AG-011] (active) `AgentService` is defined so that additional providers (a bring-your-own-key implementation calling an LLM directly from the browser, and/or a hosted-proxy implementation) can be registered later without changing `AgentService`'s request/response interface or requiring any caller of `request()` to change.

### Context assembly and visibility

- [AG-012] (active) The editor auto-populates `context` with an `AgentContextRef` for the current selection on every request, without requiring the user to manually re-attach what they've already selected.
- [AG-013] (active) Every element the editor assembles into a request's `context` — the current selection, relevant graph JSON excerpts, and the registry of operations offered to the prompt — is rendered as a user-visible chip in the Copilot panel before the request is sent; no context reaches `AgentService.request` that was not shown to the user as a chip.

### Asset generation

- [AG-014] (active) Asset-generation proposals (procedural mesh/material/audio) express their entire output as ordinary document patches — new `buffers`/`meshes`/`materials`/emitter entries added via the same `JsonPatchOp` mechanism (`DOC-007..010`) — never as a side-channel file write invisible to the save pipeline, so generated assets participate in save's dirty-root/reserialize-on-save path (`DOC-024..026`) like any other structural edit.

### Inline affordances

- [AG-015] (active) The Copilot panel and every inline "ask" affordance (right-click on a scene/graph object, a graph-node chip, an inspector-field chip) construct and send the identical `AgentRequest` shape defined by `AG-001`, differing only in which `AgentContextRef` they prefill — never in the request or response contract — and that prefilled chip remains editable or removable by the user before the request is sent.

### Proposal shape

- [AG-016] (active) A `Proposal` carries a `summary: string` (a human-readable description of what accepting it will do, never a substitute for `validationReport`) and an optional `generatedAssets` manifest listing each newly generated asset (its kind, the document pointer(s) it introduces, and a provenance note) separately from `commands`, so the UI can render asset-specific preview without re-deriving that information from raw patches.

## Open questions

- OPEN(AG-preview-render-tbd): whether an accepted-but-not-yet-applied proposal's diff previews in the viewport as a "ghost" overlay of the resulting scene state, or only as a list/text diff alongside the Copilot panel, is deferred to UX freeze; this spec requires a diff be previewable and rejectable (per `docs/adr/0004`) but does not pin down its rendering.
- OPEN(AG-multiturn-tbd): multi-turn refinement semantics — whether a follow-up prompt on a still-pending (not yet accepted/rejected) proposal replaces it, amends it, or starts a new independent proposal, and whether prior turns' context persists — are not specified here.
- OPEN(AG-determinism-tbd): the mock provider (`AG-010`) is deterministic by construction, but a reproducibility/determinism policy for real providers (e.g. whether identical prompt+context must reproduce identical proposals, and how generation seeds for procedural assets are recorded for reproducibility) is not specified here.
- RESOLVED (M1, was OPEN(AG-commandlike-unification-tbd)): `CommandLike` (`packages/engine-api/src/agent-service.ts`) is unchanged — `editor-core`'s `Command` (`DOC-007..010`, `packages/editor-core/src/command.ts`) is defined as `CommandLike & { coalesceKey?: string }` rather than `CommandLike` becoming an alias, since `engine-api` stays dependency-free and cannot import `editor-core`'s type. Every `CommandLike` a `Proposal` builds is already a structurally valid `Command` (coalescing is optional).
- OPEN(AG-genprovider-tbd): the procedural-generation provider(s) that actually synthesize mesh/material/audio content behind `GeneratedAssetRef` — and whether that is itself a pluggable interface analogous to `AgentService` — is net-new scope not designed by this spec (see `docs/adr/0004`'s consequences).
- OPEN(AG-privacy-tbd): prompt/response logging, retention, and third-party data handling are properties of whichever concrete `AgentService` provider is wired up; the mock provider (`AG-010`) has no privacy surface (no network call), so this is deferred rather than resolved.
- Implementation note (M8-copilot phase 1, `packages/agent-mock`): `@gltf-studio/agent-mock`'s `MockAgentProvider` now exists and is `AG-010`'s real mock/offline implementation — its four prompt templates (spin/rotate, move, play-sound-on-click, procedural add-cube) are built exclusively via `editor-core`'s `GraphEdit`/`SceneEdit` factories, per `AG-003`'s "no distinct agent-only command type" commitment. All 21 obligations in `packages/contract-tests/src/agent-service.ts` are now real assertions against it (via its own `contract.test.ts`), not an `it.todo` inventory; one obligation — "opening the panel from an inline affordance prefills a removable/editable `AgentContextRef` chip" (`AG-015`) — stays `it.todo`, since chip removability/editability is a Phase-2 UI concern this headless package cannot exercise until `packages/app` grows a Copilot panel.
- RESOLVED (M8-copilot phase 1, was OPEN(AG-validationfinding-shape-tbd) — the open note in `packages/engine-api/src/agent-service.ts`'s `ValidationFinding` doc comment, never promoted to a numbered entry here): `packages/agent-mock/src/validate.ts`'s `toFinding` maps `@gltfi/ir`'s `Diagnostic` (`{severity, code, message, nodeIndex?}`) onto `ValidationFinding` directly — `severity` passes through unchanged (`checkModule`/`validateGraph` already only ever emit `"error" | "warning" | "info"`, the same union `ValidationFinding.severity` declares), `code` is folded into `message` as `` `${code}: ${message}` `` rather than kept as a separate field, and `nodeIndex` (when present) is resolved into a document `pointer` (`/extensions/KHR_interactivity/graphs/{graphIndex}/nodes/{nodeIndex}`) rather than staying a bare graph-local index. This is `agent-mock`'s own informal resolution, not a widening of `ValidationFinding`'s declared type — a future non-mock `AgentService` implementation remains free to keep `code` as its own field instead.
