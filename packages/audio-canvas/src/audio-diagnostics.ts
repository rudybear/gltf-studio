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
//
// r2: `validateGraph`'s `custom-oscillator-undefined` check (validators.ts)
// names a synthetic SOURCE terminal, not a real `graph.nodes[]` entry —
// since an oscillator is `KHR_audio_emitter` source data now, never a graph
// node, that diagnostic's one `nodeIds` entry is `source:{sourceIndex}`,
// the SAME pseudo-id `map-audio-graph.ts`'s synthetic `audio-buffer-source`
// terminal keys its `byId` map with. That id is not a `graph.nodes[]`
// label, so it can never resolve through `labelToIndex` above — this
// function additionally takes the already-computed `MappedGraph` (`mapped`,
// optional so a caller with no graph yet can still call this with `[]`
// results) and resolves `source:{N}`/`emitter:{N}` against ITS synthetic
// nodes' `raw.source`/`raw.emitter` fields to find the right `MappedNode
// .index` — reusing that projection's id ordering rather than
// re-deriving it a second time here.
import type { GraphDiagnostic, MappedGraph } from "@gltf-studio/graph-canvas";
import type { AudioGraphLintResult } from "@gltf-studio/engine-api";
import type { KHRGraph } from "audio-graph-js";

export function buildAudioDiagnosticsByNode(graph: KHRGraph, graphIndex: number, lintResults: AudioGraphLintResult[], mapped?: MappedGraph | null): Map<number, GraphDiagnostic[]> {
  const labelToIndex = new Map<string, number>();
  graph.nodes.forEach((node, i) => {
    labelToIndex.set(node.label ?? `node_${i}`, i);
  });

  const pseudoIdToIndex = new Map<string, number>();
  for (const node of mapped?.nodes ?? []) {
    if (node.op === "audio-buffer-source") {
      const sourceIndex = (node.raw as { source?: number } | undefined)?.source;
      if (typeof sourceIndex === "number") pseudoIdToIndex.set(`source:${sourceIndex}`, node.index);
    } else if (node.op === "emitter") {
      const emitterIndex = (node.raw as { emitter?: number } | undefined)?.emitter;
      if (typeof emitterIndex === "number") pseudoIdToIndex.set(`emitter:${emitterIndex}`, node.index);
    }
  }

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
      const nodeIndex = labelToIndex.get(label) ?? pseudoIdToIndex.get(label);
      if (nodeIndex !== undefined) {
        pushFor(nodeIndex, diagnostic);
      }
    }
  }

  return byNode;
}
