// TEST-ONLY. Mirrors packages/agent-mock's templates/broken.ts and
// templates/neutral-claim.ts exactly in purpose: synthetic Proposal
// fixtures for @gltf-studio/contract-tests' AG-007/AG-008 obligations (a
// behavior-neutral claim needing an EQUIV result; an error-level finding
// blocking one-click acceptance), built directly via the SAME shared
// CommandChain/validateProposalGraph pipeline this provider's real
// request() path uses — bypassing the LLM/fetch entirely, since these
// obligations are about the Proposal SHAPE, not about provoking a real
// model into producing bad output on demand.
import { GraphEdit, getIn, type EditorDocument } from "@gltf-studio/editor-core";
import type { Proposal } from "@gltf-studio/engine-api";
import { CommandChain, validateProposalGraph } from "@gltf-studio/agent-shared";
import { GRAPH_INDEX } from "./tool-handlers.js";

/**
 * AG-008 fixture: a graph whose one event node's "out" flow targets a node
 * index that does not exist — `@gltfi/verify`'s `validateGraph` (run inside
 * `validateProposalGraph`) flags this as an error-level finding.
 */
export function buildDeliberatelyBrokenProposalForTests(document: EditorDocument): Proposal {
  const chain = new CommandChain(document);
  chain.push(GraphEdit.ensureGraph(chain.doc, GRAPH_INDEX));
  chain.push(GraphEdit.addNode(chain.doc, GRAPH_INDEX, "event/onTick", {}));
  const eventNodeIndex =
    ((getIn(chain.json, ["extensions", "KHR_interactivity", "graphs", GRAPH_INDEX, "nodes"]) as unknown[] | undefined)?.length ?? 1) - 1;
  const danglingTarget = eventNodeIndex + 1000;
  chain.push(GraphEdit.connectFlow(chain.doc, GRAPH_INDEX, eventNodeIndex, "out", danglingTarget, "in"));

  return {
    summary: "This proposal claims to be a behavior-neutral no-op refactor, but is intentionally invalid (TEST-ONLY fixture for AG-007/AG-008 contract coverage).",
    commands: chain.commands,
    validationReport: validateProposalGraph(chain.json, GRAPH_INDEX)
  };
}

/**
 * AG-007 positive-case fixture: a genuinely no-op edit (`GraphEdit.
 * replaceGraph` with the exact same graph value it started from), paired
 * with a hand-asserted EQUIV result — the pipeline this provider actually
 * uses is `CommandChain`/`validateProposalGraph`, not an equivalence
 * checker (agent-mock's own equivalent fixture calls `@gltfi/verify`'s
 * `equivalentGraphs` for extra rigor over an identical before/after pair;
 * this fixture asserts the same true fact directly rather than adding a
 * runtime dependency on `@gltfi/verify` this package otherwise has no need
 * for).
 */
export function buildBehaviorNeutralProposalForTests(document: EditorDocument): Proposal {
  const graph = getIn(document.json, ["extensions", "KHR_interactivity", "graphs", GRAPH_INDEX]);
  if (graph === undefined) {
    throw new Error("buildBehaviorNeutralProposalForTests requires a document with an existing KHR_interactivity graph at index 0.");
  }

  const chain = new CommandChain(document);
  chain.push(GraphEdit.replaceGraph(chain.doc, GRAPH_INDEX, graph as Parameters<typeof GraphEdit.replaceGraph>[2]));

  return {
    summary: "No-op refactor: re-applies the identical graph unchanged (behavior-neutral; TEST-ONLY fixture for AG-007 contract coverage).",
    commands: chain.commands,
    validationReport: {
      findings: validateProposalGraph(chain.json, GRAPH_INDEX).findings,
      equivChecks: [{ claim: "graph is behaviorally unchanged", equivalent: true }]
    }
  };
}
