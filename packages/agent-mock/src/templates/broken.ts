// TEST-ONLY. Not reachable from `MockAgentProvider.request` for any real
// prompt — exported from the package's index.ts solely so
// `@gltf-studio/contract-tests`' AG-007/AG-008 obligations (a
// behavior-neutral claim needing an EQUIV result; an error-level finding
// blocking one-click acceptance) have something to exercise without a
// fifth invented user-facing template whose only purpose would be to fail
// validation on demand.
//
// Builds a graph with one `event/onTick` node whose "out" flow is wired to
// a node index that does not exist (`eventNodeIndex + 1000`, guaranteed out
// of range for any graph this small). `@gltfi/verify`'s `validateGraph`
// flags this as `GV025` ("node N flow \"socket\" references out-of-range
// node M") at `severity: "error"` — see the sibling gltf-interactivity
// repo's `packages/verify/src/index.ts`.
import { GraphEdit, type EditorDocument } from "@gltf-studio/editor-core";
import type { Proposal } from "@gltf-studio/engine-api";
import { CommandChain } from "../command-chain.js";
import { validateProposalGraph } from "../validate.js";
import { GRAPH_INDEX, graphNodeCount } from "./shared.js";

export function buildDeliberatelyBrokenProposalForTests(document: EditorDocument): Proposal {
  const chain = new CommandChain(document);
  chain.push(GraphEdit.ensureGraph(chain.doc, GRAPH_INDEX));
  chain.push(GraphEdit.addNode(chain.doc, GRAPH_INDEX, "event/onTick", {}));
  const eventNodeIndex = graphNodeCount(chain.json, GRAPH_INDEX) - 1;
  const danglingTarget = eventNodeIndex + 1000;
  chain.push(GraphEdit.connectFlow(chain.doc, GRAPH_INDEX, eventNodeIndex, "out", danglingTarget, "in"));

  return {
    summary: "This proposal claims to be a behavior-neutral no-op refactor, but is intentionally invalid (TEST-ONLY fixture for AG-007/AG-008 contract coverage).",
    commands: chain.commands,
    validationReport: validateProposalGraph(chain.json, GRAPH_INDEX)
  };
}
