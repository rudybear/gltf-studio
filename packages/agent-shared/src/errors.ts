// AG-006..009 design note (see agent-mock's mock-agent-provider.ts file
// header for the full reasoning): when a provider can't turn a request into
// a usable Proposal (no template/no resolvable plan, a missing precondition
// like a target selection), `AgentService.request` REJECTS its promise with
// one of these typed errors rather than resolving to a fabricated
// `Proposal` with empty/fake commands. `AgentService.request`'s return type
// (`Promise<Proposal>`) has no "refusal" variant, and inventing a
// zero-command `Proposal` would be a worse fit than an honest rejection:
// AG-016 says a `Proposal.summary` describes "what accepting it will do" —
// a zero-command proposal has nothing for accepting to mean, so it would
// either lie (imply there is something to accept) or be indistinguishable
// from a real but currently-empty proposal. A rejected promise is
// unambiguous and lets the (Phase 2) UI layer render it as a plain
// assistant message instead of a proposal card.
//
// Shared across every AgentService provider (agent-mock, agent-llm): this
// base class and MissingSelectionError's wording are generic enough to fit
// any provider's refusal. Provider-specific refusal subclasses (e.g.
// agent-mock's UnrecognizedPromptError, agent-llm's NoPlanProducedError)
// extend AgentRequestRefusedError from here rather than redefining it.
export class AgentRequestRefusedError extends Error {}

export class MissingSelectionError extends AgentRequestRefusedError {
  constructor(action: string) {
    super(`"${action}" needs a target node, but the request's context included no selection.`);
    this.name = "MissingSelectionError";
  }
}
