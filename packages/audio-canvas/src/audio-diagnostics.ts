// Converts `AudioGraphHost.lint()` results (specs/engine-api.md AGH-001)
// into the SAME `Map<number, GraphDiagnostic[]>` shape `@gltf-studio/graph-
// canvas`'s own `validateInteractivityGraph` produces for the behavior
// graph — `GraphView`/`OpNode`'s per-node corner badge (`gcanvas.badge.*`,
// UX-506) already renders straight off this map, so reusing the type here
// (rather than building bespoke UI) is how UX-609 ("lint violations show a
// red badge on every implicated node, not only the banner") gets
// implemented for free off shared, already-tested rendering code.
//
// `AudioGraphLintResult.nodeIds` is an ordered list of node LABELS (or
// `node_{i}` fallback — the exact fallback `map-audio-graph.ts`'s
// `nodeLabel`/`labelOfRawIndex` also use), not indices, so joining back to
// a `MappedNode.index` goes label -> raw `graph.nodes[]` index (via the
// SAME fallback convention) -> mapped index (identical to the raw index for
// every real node — see `audio-entity.ts`'s `identifyMappedNode` doc
// comment for why that identity always holds).
import type { GraphDiagnostic } from "@gltf-studio/graph-canvas";
import type { AudioGraphLintResult } from "@gltf-studio/engine-api";
import type { KHRGraph } from "audio-graph-js";

export function buildAudioDiagnosticsByNode(graph: KHRGraph, graphIndex: number, lintResults: AudioGraphLintResult[]): Map<number, GraphDiagnostic[]> {
  const labelToIndex = new Map<string, number>();
  graph.nodes.forEach((node, i) => {
    labelToIndex.set(node.label ?? `node_${i}`, i);
  });

  const byNode = new Map<number, GraphDiagnostic[]>();
  function pushFor(nodeIndex: number, diagnostic: GraphDiagnostic) {
    const list = byNode.get(nodeIndex);
    if (list) {
      list.push(diagnostic);
    } else {
      byNode.set(nodeIndex, [diagnostic]);
    }
  }

  for (const result of lintResults) {
    if (result.graphIndex !== graphIndex && result.graphIndex !== -1) continue;
    const diagnostic: GraphDiagnostic = {
      severity: result.severity,
      code: result.code,
      message: result.message,
      source: "audio-lint"
    };
    for (const label of result.nodeIds) {
      const nodeIndex = labelToIndex.get(label);
      if (nodeIndex !== undefined) {
        pushFor(nodeIndex, diagnostic);
      }
    }
  }

  return byNode;
}
