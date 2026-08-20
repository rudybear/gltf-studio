// Template (a): "spin"/"rotate" a selected node.
//
// Phrasing rules (deliberately simple — this is a mock, not an NLU system):
//   - the request matches this template at all when /spin|rotate/i appears
//     anywhere in the prompt (checked by the caller, mock-agent-provider.ts);
//   - within that, /\b(click|tap|select)\b/i selects an `event/onSelect`
//     trigger ("spin on click"); anything else (including an explicit
//     "always"/"continuously"/"tick") defaults to `event/onTick` (a
//     continuous per-frame trigger) — `onTick` is the more visually obvious
//     "yes, it's spinning" demo default when the prompt doesn't specify a
//     trigger.
//
// Builds: ensureGraph -> event node -> pointer/interpolate targeting
// `/nodes/{n}/rotation` (a quaternion, hence `float4`) -> connectFlow event
// -> interpolate. `pointer/interpolate`'s declared value sockets
// (packages/kernel/src/registry.ts in the sibling gltf-interactivity repo):
// `value` (T, here float4), `duration` (float), `p1`/`p2` (float2 bezier
// easing control points) — `GraphEdit.addPointerNode` only fills in the
// node's `configuration` (pointer/type), not these value sockets, so this
// template builds the node directly via `GraphEdit.addNode` for full
// control over them, using a linear ease (p1=[0,0], p2=[1,1]).
import { GraphEdit, getIn, type EditorDocument } from "@gltf-studio/editor-core";
import type { Proposal } from "@gltf-studio/engine-api";
import { CommandChain, validateProposalGraph } from "@gltf-studio/agent-shared";
import { GRAPH_INDEX, graphNodeCount } from "./shared.js";

/** A visible-but-modest 120-degree turn around Y, played over 1.5s with a linear ease. */
const SPIN_DURATION_SECONDS = 1.5;
const SPIN_ROTATION_QUATERNION: [number, number, number, number] = [0, 0.866025, 0, 0.5]; // 120deg about Y

export function matchesSpinTemplate(prompt: string): boolean {
  return /spin|rotate/i.test(prompt);
}

export function buildSpinProposal(document: EditorDocument, prompt: string, nodeIndex: number): Proposal {
  const useOnSelect = /\b(click|tap|select)\b/i.test(prompt);
  const chain = new CommandChain(document);

  chain.push(GraphEdit.ensureGraph(chain.doc, GRAPH_INDEX));

  chain.push(
    useOnSelect
      ? GraphEdit.addNode(chain.doc, GRAPH_INDEX, "event/onSelect", {
          extension: "KHR_node_selectability",
          configuration: { nodeIndex: { value: [nodeIndex] } }
        })
      : GraphEdit.addNode(chain.doc, GRAPH_INDEX, "event/onTick", {})
  );
  const eventNodeIndex = graphNodeCount(chain.json, GRAPH_INDEX) - 1;

  const { command: float4TypeCmd, index: float4TypeIndex } = GraphEdit.ensureType(chain.doc, GRAPH_INDEX, "float4");
  chain.push(float4TypeCmd);
  const { command: floatTypeCmd, index: floatTypeIndex } = GraphEdit.ensureType(chain.doc, GRAPH_INDEX, "float");
  chain.push(floatTypeCmd);
  const { command: float2TypeCmd, index: float2TypeIndex } = GraphEdit.ensureType(chain.doc, GRAPH_INDEX, "float2");
  chain.push(float2TypeCmd);

  chain.push(
    GraphEdit.addNode(chain.doc, GRAPH_INDEX, "pointer/interpolate", {
      configuration: {
        pointer: { value: [`/nodes/${nodeIndex}/rotation`] },
        type: { value: [float4TypeIndex] }
      },
      values: {
        value: { type: float4TypeIndex, value: SPIN_ROTATION_QUATERNION },
        duration: { type: floatTypeIndex, value: [SPIN_DURATION_SECONDS] },
        p1: { type: float2TypeIndex, value: [0, 0] },
        p2: { type: float2TypeIndex, value: [1, 1] }
      }
    })
  );
  const interpolateNodeIndex = graphNodeCount(chain.json, GRAPH_INDEX) - 1;

  chain.push(GraphEdit.connectFlow(chain.doc, GRAPH_INDEX, eventNodeIndex, "out", interpolateNodeIndex, "in"));

  const nodeName = getIn(document.json, ["nodes", nodeIndex, "name"]);
  const target = typeof nodeName === "string" ? `"${nodeName}"` : `node ${nodeIndex}`;

  return {
    summary: useOnSelect
      ? `When clicked, rotate ${target} 120 degrees over ${SPIN_DURATION_SECONDS}s.`
      : `Continuously rotate ${target} 120 degrees every ${SPIN_DURATION_SECONDS}s.`,
    commands: chain.commands,
    validationReport: validateProposalGraph(chain.json, GRAPH_INDEX)
  };
}
