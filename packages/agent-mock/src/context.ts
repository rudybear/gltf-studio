// AG-002: resolves an `AgentContextRef[]` down to the one thing every
// template below actually needs — an optional target node index. Only the
// "selection" kind is consulted for a target today (the "graph-node" and
// "explicit" kinds exist per AG-002 but none of the four mock templates
// target a specific existing graph node or an explicitly-attached
// non-selection object, so there is nothing for those two kinds to resolve
// to yet — a future template can extend this without changing the shape).
import type { AgentContextRef } from "@gltf-studio/engine-api";

/** The first selected node index from `context`, or `undefined` if no selection ref is present (or it's empty). */
export function selectedNodeIndex(context: AgentContextRef[]): number | undefined {
  for (const ref of context) {
    if (ref.kind === "selection" && ref.nodeIndices.length > 0) {
      return ref.nodeIndices[0];
    }
  }
  return undefined;
}
