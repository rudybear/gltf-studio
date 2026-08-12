import { describe, expect, it } from "vitest";
import { buildAudioDiagnosticsByNode } from "./audio-diagnostics.js";
import type { KHRGraph } from "audio-graph-js";
import type { AudioGraphLintResult } from "@gltf-studio/engine-api";

const graph: KHRGraph = {
  nodes: [
    { kind: "gain", label: "gainA", params: { gain: 0.5 } },
    { kind: "lowpass", label: "filterB", params: { frequency: 800 } }
  ],
  connections: [
    { from: { node: 0, output: 0 }, to: { node: 1, input: 0 } },
    { from: { node: 1, output: 0 }, to: { node: 0, input: 0 } }
  ]
};

describe("buildAudioDiagnosticsByNode (UX-609)", () => {
  it("joins a lint result's node LABELS back to the node's raw index", () => {
    const lint: AudioGraphLintResult[] = [
      { graphIndex: 0, severity: "error", code: "cycle", message: "cycle detected (gainA → filterB → gainA)", nodeIds: ["gainA", "filterB"] }
    ];
    const byNode = buildAudioDiagnosticsByNode(graph, 0, lint);
    expect(byNode.get(0)).toEqual([{ severity: "error", code: "cycle", message: "cycle detected (gainA → filterB → gainA)", source: "audio-lint" }]);
    expect(byNode.get(1)).toEqual([{ severity: "error", code: "cycle", message: "cycle detected (gainA → filterB → gainA)", source: "audio-lint" }]);
  });

  it("ignores lint results for a different graphIndex, keeps document-level (-1) ones out of any node's badges", () => {
    const lint: AudioGraphLintResult[] = [
      { graphIndex: 1, severity: "error", code: "cycle", message: "other graph", nodeIds: ["gainA"] },
      { graphIndex: -1, severity: "error", code: "missing-emitter-extension", message: "doc-level", nodeIds: [] }
    ];
    const byNode = buildAudioDiagnosticsByNode(graph, 0, lint);
    expect(byNode.size).toBe(0);
  });

  it("accumulates multiple diagnostics onto the same node", () => {
    const lint: AudioGraphLintResult[] = [
      { graphIndex: 0, severity: "warning", code: "envelope-unsupported", message: "envelope on gainA", nodeIds: ["gainA"] },
      { graphIndex: 0, severity: "error", code: "cycle", message: "cycle involving gainA", nodeIds: ["gainA"] }
    ];
    const byNode = buildAudioDiagnosticsByNode(graph, 0, lint);
    expect(byNode.get(0)).toHaveLength(2);
  });
});
