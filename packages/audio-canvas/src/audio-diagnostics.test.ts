import { describe, expect, it } from "vitest";
import { buildAudioDiagnosticsByNode } from "./audio-diagnostics.js";
import { mapAudioGraph } from "./map-audio-graph.js";
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

  describe("r2: custom-oscillator-undefined names a synthetic SOURCE terminal (source:{N}), not a real graph.nodes[] label", () => {
    const oscillatorGraph: KHRGraph = {
      nodes: [{ kind: "gain", label: "vol", params: { gain: 0.3 } }],
      connections: [],
      inputs: [{ source: 0, node: 0 }]
    };
    const sources = [{ extensions: { KHR_audio_graph: { oscillator: { type: "custom" as const } } } }];

    it("without the mapped graph, a source: pseudo-id cannot resolve and the badge is silently dropped (the bug this fix addresses)", () => {
      const lint: AudioGraphLintResult[] = [
        { graphIndex: 0, severity: "warning", code: "custom-oscillator-undefined", message: "source #0 is an oscillator with type \"custom\" but no \"periodicWave\" data", nodeIds: ["source:0"] }
      ];
      const byNode = buildAudioDiagnosticsByNode(oscillatorGraph, 0, lint);
      expect(byNode.size).toBe(0);
    });

    it("with the mapped graph passed, resolves source:{N} to the synthetic audio-buffer-source terminal's MappedNode.index", () => {
      const mapped = mapAudioGraph(oscillatorGraph, 0, [], [], sources as never);
      const sourceNode = mapped.nodes.find((n) => n.op === "audio-buffer-source")!;
      const lint: AudioGraphLintResult[] = [
        { graphIndex: 0, severity: "warning", code: "custom-oscillator-undefined", message: "source #0 is an oscillator with type \"custom\" but no \"periodicWave\" data", nodeIds: ["source:0"] }
      ];
      const byNode = buildAudioDiagnosticsByNode(oscillatorGraph, 0, lint, mapped);
      expect(byNode.get(sourceNode.index)).toEqual([
        { severity: "warning", code: "custom-oscillator-undefined", message: "source #0 is an oscillator with type \"custom\" but no \"periodicWave\" data", source: "audio-lint" }
      ]);
    });

    it("resolves emitter:{N} to the synthetic emitter terminal's MappedNode.index the same way", () => {
      const g: KHRGraph = { nodes: [{ kind: "gain", label: "g" }], connections: [], outputs: [{ node: 0, emitter: 0 }] };
      const mapped = mapAudioGraph(g, 0, [{ type: "global" }]);
      const emitterNode = mapped.nodes.find((n) => n.op === "emitter")!;
      const lint: AudioGraphLintResult[] = [{ graphIndex: 0, severity: "error", code: "some-emitter-level-check", message: "m", nodeIds: ["emitter:0"] }];
      const byNode = buildAudioDiagnosticsByNode(g, 0, lint, mapped);
      expect(byNode.get(emitterNode.index)).toHaveLength(1);
    });
  });
});
