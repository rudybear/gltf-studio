// Shared constants/helpers used by more than one template.
import { getIn } from "@gltf-studio/editor-core";

/**
 * Every mock template that touches the interactivity graph targets graph 0.
 * The mock provider has no basis for choosing any other index — a real
 * provider might read `extensions.KHR_interactivity.graph` (the "active"
 * graph pointer) or accept a `{kind: "graph-node"}` context ref naming a
 * specific graph, but no template here needs that yet.
 */
export const GRAPH_INDEX = 0;

/** Reads `extensions.KHR_interactivity.graphs[graphIndex].nodes.length` from `json` (0 if the graph doesn't exist yet). */
export function graphNodeCount(json: unknown, graphIndex: number): number {
  const nodes = getIn(json, ["extensions", "KHR_interactivity", "graphs", graphIndex, "nodes"]) as unknown[] | undefined;
  return nodes?.length ?? 0;
}
