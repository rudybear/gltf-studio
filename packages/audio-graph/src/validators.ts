// This project's own KHR_audio_graph validators (AGH-001), on top of
// vendored AudioGraphJS's own `lintGraph`/`lintLayeredGraph` (which only
// report a generic "Graph contains a cycle" boolean-ish message with no
// node names). These encode the DAG-only decision and two other concrete,
// checkable gaps from /glTF-audio/03-gap-analysis-audio-graph.md:
//
//  - G3 (DAG-only): a cycle is named by its actual node path
//    (specs/ux-audio-graph.md UX-602's "cycle detected (gain → biquadFilter
//    → panner → gain)" example) rather than left as an opaque boolean.
//    KHR_audio_graph's own connection schema (`to: { node, input?: number
//    }`, numeric-only) has no way to target an AudioParam by name, so "no
//    audio-rate parameter modulation" (gap G4) is enforced by construction,
//    not by a validator here — there is nothing a document COULD express
//    that would need flagging.
//  - G5 (no envelopes/scheduled automation): flags any node `params` key
//    that looks like an attempt at one (the schema doesn't define this
//    either, but unlike G4 a document author could plausibly add an
//    `envelope`/`adsr` key that a naive implementation silently ignores).
//  - G2 (`custom` oscillator/interpolation has no defined data model): flags
//    a `custom` oscillator type or gain `interpolation` with no
//    corresponding payload (`periodicWave`/`curve`).
import type { AudioGraphLintResult } from "@gltf-studio/engine-api";
import type { KHRGraph, KHRGraphNodeSpec } from "audio-graph-js";

function nodeLabel(graph: KHRGraph, index: number): string {
  return graph.nodes[index]?.label ?? `node_${index}`;
}

/** DFS cycle search over the RAW KHR_audio_graph node/connection indices, returning the actual cycle path (node labels) if found. */
export function findCyclePath(graph: KHRGraph): string[] | null {
  const adjacency = new Map<number, number[]>();
  for (let i = 0; i < graph.nodes.length; i += 1) {
    adjacency.set(i, []);
  }
  for (const connection of graph.connections) {
    adjacency.get(connection.from.node)?.push(connection.to.node);
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const stack: number[] = [];

  function visit(node: number): number[] | null {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) {
      return null;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const found = visit(next);
      if (found) {
        return found;
      }
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (let i = 0; i < graph.nodes.length; i += 1) {
    if (!visited.has(i)) {
      const cycle = visit(i);
      if (cycle) {
        return cycle.map((index) => nodeLabel(graph, index));
      }
    }
  }
  return null;
}

const ENVELOPE_KEY_PATTERN = /envelope|adsr|automation/i;

function findEnvelopeLikeParams(node: KHRGraphNodeSpec): string[] {
  return Object.keys(node.params ?? {}).filter((key) => ENVELOPE_KEY_PATTERN.test(key));
}

export function validateGraph(graphIndex: number, graph: KHRGraph): AudioGraphLintResult[] {
  const results: AudioGraphLintResult[] = [];

  const cycle = findCyclePath(graph);
  if (cycle) {
    results.push({
      graphIndex,
      severity: "error",
      code: "cycle",
      message: `cycle detected (${cycle.join(" → ")}) — KHR_audio_graph is DAG-only in v1 (no cycles, envelopes, or param-modulation)`,
      nodeIds: cycle
    });
  }

  graph.nodes.forEach((node, index) => {
    const label = nodeLabel(graph, index);
    const envelopeKeys = findEnvelopeLikeParams(node);
    if (envelopeKeys.length > 0) {
      results.push({
        graphIndex,
        severity: "warning",
        code: "envelope-unsupported",
        message: `node "${label}" has ${envelopeKeys.map((k) => `"${k}"`).join(", ")} param(s), but envelopes/scheduled automation are not supported in v1 (gap-analysis G5) — use KHR_animation_pointer for k-rate control instead`,
        nodeIds: [label]
      });
    }
    if (node.kind === "oscillator" && node.params?.type === "custom" && !node.params?.periodicWave) {
      results.push({
        graphIndex,
        severity: "warning",
        code: "custom-oscillator-undefined",
        message: `node "${label}" is an oscillator with type "custom" but no "periodicWave" data — the custom waveform has no defined payload (gap-analysis G2)`,
        nodeIds: [label]
      });
    }
    if (node.kind === "gain" && node.params?.interpolation === "custom" && !node.params?.curve) {
      results.push({
        graphIndex,
        severity: "warning",
        code: "custom-interpolation-undefined",
        message: `node "${label}" is a gain node with interpolation "custom" but no "curve" data — the custom curve has no defined payload (gap-analysis G2)`,
        nodeIds: [label]
      });
    }
  });

  return results;
}
