// AG-006..009 design note (see mock-agent-provider.ts's file header for the
// full reasoning): when no template recognizes a prompt (or a template's
// preconditions aren't met by anything else that could handle it),
// `MockAgentProvider.request` REJECTS its promise with one of these typed
// errors rather than resolving to a fabricated `Proposal` with empty/fake
// commands. `AgentService.request`'s return type (`Promise<Proposal>`) has
// no "refusal" variant, and inventing a zero-command `Proposal` would be a
// worse fit than an honest rejection: AG-016 says a `Proposal.summary`
// describes "what accepting it will do" — a zero-command proposal has
// nothing for accepting to mean, so it would either lie (imply there is
// something to accept) or be indistinguishable from a real but currently-
// empty proposal. A rejected promise is unambiguous and lets the (Phase 2)
// UI layer render it as a plain assistant message instead of a proposal
// card.
export class AgentRequestRefusedError extends Error {}

const SUPPORTED_TEMPLATES =
  'spin/rotate a selected node ("spin the cube", "rotate on click"), ' +
  'move a selected node ("move it up", "move right 2"), ' +
  "play a sound when a node with audio is clicked (\"play sound on click\"), " +
  'or add/generate cubes ("add 3 cubes").';

export class UnrecognizedPromptError extends AgentRequestRefusedError {
  constructor(prompt: string) {
    super(`No Copilot template recognizes this request. Supported requests: ${SUPPORTED_TEMPLATES} Prompt was: "${prompt}"`);
    this.name = "UnrecognizedPromptError";
  }
}

export class MissingSelectionError extends AgentRequestRefusedError {
  constructor(action: string) {
    super(`"${action}" needs a target node, but the request's context included no selection.`);
    this.name = "MissingSelectionError";
  }
}
