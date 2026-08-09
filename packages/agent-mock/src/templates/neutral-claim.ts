// TEST-ONLY. Exported solely for @gltf-studio/contract-tests' AG-007
// "positive case" obligation: a proposal whose summary claims a
// behavior-neutral change AND carries a corresponding EQUIV result. None of
// the four real (a)-(d) templates make a behavior-neutral claim (see
// mock-agent-provider.ts's file header), so there is no real prompt that
// would ever reach this path — a genuinely no-op edit (`GraphEdit.
// replaceGraph` with the exact same graph value it started from) plus a
// real `@gltfi/verify` `equivalentGraphs` check computed over that
// identical before/after pair, rather than a hand-typed `equivalent: true`.
import { GraphEdit, getIn, type EditorDocument } from "@gltf-studio/editor-core";
import type { Proposal } from "@gltf-studio/engine-api";
import type { Graph } from "@gltfi/ir";
import { equivalentGraphs, type VGraph } from "@gltfi/verify";
import { CommandChain } from "../command-chain.js";
import { validateProposalGraph } from "../validate.js";
import { GRAPH_INDEX } from "./shared.js";

export function buildBehaviorNeutralProposalForTests(document: EditorDocument): Proposal {
  const graph = getIn(document.json, ["extensions", "KHR_interactivity", "graphs", GRAPH_INDEX]);
  if (graph === undefined) {
    throw new Error("buildBehaviorNeutralProposalForTests requires a document with an existing KHR_interactivity graph at index 0.");
  }

  const chain = new CommandChain(document);
  chain.push(GraphEdit.replaceGraph(chain.doc, GRAPH_INDEX, graph as Graph));

  const equivalence = equivalentGraphs(graph as VGraph, graph as VGraph);

  return {
    summary: "No-op refactor: re-applies the identical graph unchanged (behavior-neutral; TEST-ONLY fixture for AG-007 contract coverage).",
    commands: chain.commands,
    validationReport: {
      findings: validateProposalGraph(chain.json, GRAPH_INDEX).findings,
      equivChecks: [{ claim: "graph is behaviorally unchanged", equivalent: equivalence.equivalent, detail: equivalence.firstDivergence }]
    }
  };
}
