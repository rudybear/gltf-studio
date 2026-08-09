// MockAgentProvider: the v1 mock/offline AgentService implementation
// (specs/agent-service.md AG-010, docs/adr/0004-agentic-authoring-as-
// command-producer.md). Recognizes a small, hand-coded set of prompt
// templates and builds every Proposal exclusively via editor-core's
// GraphEdit/SceneEdit command factories (AG-003) — never an ad hoc patch —
// validating each one (AG-006) before returning it. Makes no network call
// (AG-010): every template is pure local computation over the document
// already held in memory.
//
// Construction / document threading (judgment call, since AG-001's
// `request(prompt, context)` signature does not take a document parameter,
// and `engine-api` must stay dependency-free — it cannot import
// editor-core's `EditorDocument` type, so `AgentService` itself can't
// either): `MockAgentProvider` takes the document in its CONSTRUCTOR and
// exposes `setDocument()` for whatever wires it up (the future Copilot
// panel/store, Phase 2) to call whenever the store's document changes.
// `EditorDocument` is an immutable value replaced on every command, not a
// mutable object a provider could hold a live reference to and always see
// current — threading it in per-call (`request(prompt, context, document)`)
// was considered, but that would diverge from `AgentService.request`'s
// exact two-argument signature that AG-001 fixes, and every other
// `AgentService` implementation would have to match it. `setDocument` keeps
// `AgentService.request(prompt, context)` unchanged either way — AG-001 is
// satisfied by both approaches, so this is purely a `MockAgentProvider`-
// local judgment call, not something the interface needs to pin down.
import type { EditorDocument } from "@gltf-studio/editor-core";
import type { AgentContextRef, AgentService, Proposal } from "@gltf-studio/engine-api";
import { selectedNodeIndex } from "./context.js";
import { MissingSelectionError, UnrecognizedPromptError } from "./errors.js";
import { buildAddCubeProposal, matchesAddCubeTemplate } from "./templates/add-cube.js";
import { buildMoveProposal, matchesMoveTemplate } from "./templates/move.js";
import { buildPlaySoundProposal, matchesPlaySoundTemplate } from "./templates/play-sound.js";
import { buildSpinProposal, matchesSpinTemplate } from "./templates/spin.js";

export { AgentRequestRefusedError, MissingSelectionError, UnrecognizedPromptError } from "./errors.js";
export { buildDeliberatelyBrokenProposalForTests } from "./templates/broken.js";
export { buildBehaviorNeutralProposalForTests } from "./templates/neutral-claim.js";

export class MockAgentProvider implements AgentService {
  #document: EditorDocument;

  constructor(document: EditorDocument) {
    this.#document = document;
  }

  /** Called by whatever wires this provider up whenever the store's current EditorDocument changes (see file header). */
  setDocument(document: EditorDocument): void {
    this.#document = document;
  }

  /**
   * AG-001: resolves to a Proposal, or rejects with an
   * `AgentRequestRefusedError` subtype (`UnrecognizedPromptError`/
   * `MissingSelectionError`) when no template applies — see errors.ts for
   * why a rejection, not a fabricated empty Proposal, is the chosen shape
   * for "the mock doesn't understand this request".
   *
   * Template order/fallthrough: (a) spin/rotate, (b) move, (c) play-sound,
   * (d) add-cube are tried in that order. (c)'s preconditions (a selected
   * node that actually has audio) can fail even when its prompt regex
   * matches — the task brief's "falls through to the next template or the
   * refusal" — so (c) alone returns `undefined` on precondition failure
   * instead of throwing, letting the next candidate template run.
   */
  async request(prompt: string, context: AgentContextRef[]): Promise<Proposal> {
    const nodeIndex = selectedNodeIndex(context);

    if (matchesSpinTemplate(prompt)) {
      if (nodeIndex === undefined) throw new MissingSelectionError("spin/rotate");
      return buildSpinProposal(this.#document, prompt, nodeIndex);
    }

    if (matchesMoveTemplate(prompt)) {
      if (nodeIndex === undefined) throw new MissingSelectionError("move");
      return buildMoveProposal(this.#document, prompt, nodeIndex);
    }

    if (matchesPlaySoundTemplate(prompt) && nodeIndex !== undefined) {
      const proposal = buildPlaySoundProposal(this.#document, nodeIndex);
      if (proposal) return proposal;
    }

    if (matchesAddCubeTemplate(prompt)) {
      return buildAddCubeProposal(this.#document, prompt, nodeIndex);
    }

    throw new UnrecognizedPromptError(prompt);
  }
}
