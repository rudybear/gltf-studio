# 4. Agentic authoring: the agent is a command producer, not a privileged writer

Status: active

## Context

The program plan's direct-manipulation editor (scene tree, graph canvas, script panel, viewport
gizmos) is being extended, per user direction, with an agentic creation flow: creators can drive
creation via prompts and other natural-language/structured inputs **alongside** — never instead of
— direct manipulation. The locked v1 capability scope for this flow is deliberately broad: wiring
behavior and audio (interactivity graphs, `KHR_audio_graph`), scene arrangement (node transforms,
hierarchy, scene membership), and asset generation (procedural meshes, materials, and audio) are
all promptable — the full creative loop, not a narrow "explain this graph" assistant.

This lands as architecture before it lands as UI. `packages/engine-api` (`specs/engine-api.md`) and
the not-yet-scaffolded `editor-core` (`specs/document-model.md`, ADR-0002) already commit this
project to one authored-state discipline: the raw glTF JSON, mutated only through command factories
(`GraphEdit.*`, `SceneEdit.*`, `AudioGraphEdit.*`) that compile to RFC-6902 `JsonPatchOp`s with
precomputed inverses, applied through a linear `HistoryStack`. An agentic flow that produced its own
parallel write path — even a well-intentioned one that "also" applies patches — would fork that
discipline in two: one path with undo/journal/save coverage and validation gates, and a second,
newer path racing to catch up. The decision below is the one architectural commitment needed to
prevent that fork before any agent code exists.

LLM provisioning itself is explicitly out of scope for this decision: v1 ships the `AgentService`
interface plus a mock/offline provider only. Which real provider(s) arrive first (bring-your-own-key
calling an LLM directly from the browser, vs. a hosted proxy this project operates) is deferred to a
later decision, made behind the same interface, once the rest of the flow is proven against the
mock.

## Decision

**The agent is a command producer, never a privileged writer.** Concretely:

- `AgentService`'s output is a `Proposal` whose `commands: Command[]` are built via the exact same
  command factories (`GraphEdit.*`, `SceneEdit.*`, `AudioGraphEdit.*`, and the asset-generation
  command factories introduced alongside them) that the direct-manipulation UI already uses to
  construct `Command`s. There is no separate "agent command" type, no agent-only patch shape, and no
  agent-only entry point into `applyCommand`/`HistoryStack`.
- A `Proposal` is applied to the document as **one `HistoryStack.transact` call** — a single
  undo/redo step regardless of how many individual commands the proposal bundles — and is
  **previewable as a diff and rejectable before that transaction ever runs**. Rejecting or
  discarding a proposal performs zero document mutation: no patches applied, no history entry of any
  kind created.
- Before acceptance is offered, every proposal's commands must pass the **same validation gates**
  direct edits are already subject to: `checkModule`/`validateGraph` for interactivity-graph
  correctness, and `EQUIV` wherever the proposal's own summary claims a change is behavior-neutral.
  A proposal is not the same trust tier as a manual edit graduating to "already applied" — it is
  gated *before* the offer to accept, not audited after.
- Once accepted, an agent-originated `HistoryStack` entry is **indistinguishable** from a
  manually-authored one: same `Command` shape, same journal format (`JsonPatchOp`, the
  `StorageProvider.autosaveJournal` wire format), same save path (dirty-root splice /
  reserialize-on-save fallback). Nothing downstream of `HistoryStack.push`/`transact` needs to know
  or care whether a human or an agent produced the commands.
- Asset generation (procedural meshes/materials/audio) is not a special case: a generated asset
  lands as **document patches** — new `buffers`/`meshes`/`materials`/emitter entries added via the
  same JSON-Patch mechanism everything else uses — so it participates in the ordinary dirty-root
  save path rather than a side-channel file write that the save pipeline doesn't know about.
- Surface-wise, the Copilot panel and every inline "ask" affordance (right-click an object, a graph
  chip, an inspector chip) are front doors onto the **same** `AgentService.request` contract; they
  differ only in which context they prefill (an object, a node, a field), never in the request or
  response shape. The current selection always auto-populates as context — the user is never
  required to manually re-describe what they've already selected — and every piece of context sent
  to the agent (selection, graph excerpts, the op registry) is rendered as a visible chip in the
  panel; nothing is sent that the user cannot see was sent.
- `AgentService` is defined as an interface precisely so that LLM provisioning can be deferred: v1
  ships the interface plus a mock/offline provider that returns deterministic proposals without a
  network call; a bring-your-own-key browser-direct provider and/or a hosted proxy provider arrive
  later as additional implementations of the identical interface, not as a breaking change to it.

See `specs/agent-service.md` for the full requirement set (`AG-###`) this decision is checked
against, and `packages/engine-api/src/agent-service.ts` for its types-only transcription.

## Consequences

Every safety property the direct-manipulation editor already has — undo, redo, autosave journal
replay, byte-preserving save, pre-acceptance graph validation — is inherited by agentic edits for
free, because agentic edits are not a structurally different kind of thing. A creator who distrusts
a proposal can inspect its diff, reject it outright, or accept it and still `undo()` exactly as they
would any manual mistake. There is never a moment where an agent's write bypassed validation that a
human's equivalent write would have had to pass.

The honest costs:

- **Asset generation pulls scene-structural mutation earlier than the M8 plan assumed.** The
  program plan's milestone sequencing treated "generate a new mesh/material from a prompt" as a
  later-milestone capability layered on top of an already-stable structural-edit path. Locking v1's
  agent scope to include asset generation means the structural-patch machinery (`RH-011`/`RH-012`'s
  classification, `DOC-019..021`'s reference-fixup, `DOC-024..026`'s reserialize-on-save fallback)
  must be correct and exercised well before M8, not after — this is a real acceleration of load on
  that machinery, not a free scope addition.
- **A generation-provider interface is net-new scope.** Nothing in the program plan as seeded
  anticipated a pluggable procedural-generation-provider boundary (mesh/material/audio generation
  backends, separate from the LLM/prompt provider itself). `specs/agent-service.md` speaks to the
  `AgentService` boundary and treats `GeneratedAssetRef` as an output shape, but the provider(s)
  that actually synthesize geometry/materials/audio, and their own interface, are not designed by
  this ADR and remain open work.
- **Prompt/response privacy is out of scope until a provider exists.** What is logged, retained, or
  sent to a third party is entirely a property of *which* concrete `AgentService` implementation is
  wired up (browser-direct BYO-key vs. hosted proxy have very different privacy postures) — a
  question this ADR defers along with provider selection itself. The mock provider that ships in v1
  has no privacy surface (it makes no network call), so this cost is deferred cleanly, but it is not
  resolved, and must be revisited before any real provider lands.
