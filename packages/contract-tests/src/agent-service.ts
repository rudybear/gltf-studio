import { describe, it } from "vitest";
import type { AgentService } from "@gltf-studio/engine-api";

/**
 * AgentService contract obligations, transcribed from
 * specs/agent-service.md. `it.todo` entries below register these as a
 * visible inventory before any AgentService implementation (including the
 * v1 mock/offline provider) exists; flesh out with real assertions once the
 * mock provider lands.
 */
export const agentServiceContractObligations: string[] = [
  "request(prompt, context) resolves to a Proposal (AG-001)",
  "context accepts a selection AgentContextRef, a graph-node AgentContextRef, and an explicit AgentContextRef (AG-002)",
  "every command in a resolved Proposal.commands is produced via a GraphEdit/SceneEdit/AudioGraphEdit/asset-generation factory, never an ad hoc patch (AG-003)",
  "accepting a Proposal applies its commands via exactly one HistoryStack.transact call, producing one undo step (AG-004)",
  "an accepted proposal's history entry is indistinguishable from a manually-authored command's in shape, journal format, and save path (AG-005)",
  "Proposal.validationReport is populated via checkModule/validateGraph before acceptance is offered (AG-006)",
  "a proposal whose summary claims a behavior-neutral change carries a corresponding EQUIV result in validationReport.equivChecks (AG-007)",
  "a proposal with a behavior-neutral claim but no EQUIV result is not eligible for one-click acceptance (AG-007)",
  "a proposal whose validationReport contains an error-level finding is not eligible for one-click acceptance (AG-008)",
  "rejecting a Proposal applies zero commands and creates no HistoryStack entry (AG-009)",
  "discarding a Proposal applies zero commands and creates no HistoryStack entry (AG-009)",
  "the v1 mock/offline provider resolves proposals without making any network call (AG-010)",
  "the v1 mock/offline provider is deterministic: the same prompt+context resolves to an equivalent proposal (AG-010)",
  "AgentService's request/response shape does not change across registered provider implementations (AG-011)",
  "every request's context includes an AgentContextRef for the current selection without the caller manually attaching it (AG-012)",
  "every element assembled into a request's context is exposed for display as a chip before the request is sent (AG-013)",
  "an asset-generation Proposal's commands introduce new buffers/meshes/materials/emitters exclusively via JsonPatchOp, not a side-channel write (AG-014)",
  "the Copilot panel and an inline affordance (right-click/graph chip/inspector chip) produce requests of the identical AgentRequest shape (AG-015)",
  "opening the panel from an inline affordance prefills a removable/editable AgentContextRef chip (AG-015)",
  "Proposal.summary is a non-empty human-readable string distinct from validationReport (AG-016)",
  "Proposal.generatedAssets, when present, lists each generated asset separately from commands (AG-016)"
];

export function describeAgentServiceContract(makeService: () => AgentService): void {
  describe("AgentService contract", () => {
    for (const obligation of agentServiceContractObligations) {
      it.todo(obligation);
    }
  });
  // OPEN(AG-contract-usage-tbd): see the equivalent note on
  // describeRenderHostContract — makeService is unused until obligations
  // gain real assertions (no AgentService implementation, including the
  // mock provider, exists yet).
  void makeService;
}
