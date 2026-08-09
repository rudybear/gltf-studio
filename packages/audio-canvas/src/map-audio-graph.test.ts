import { describe, expect, it } from "vitest";
import type { KHRGraph } from "audio-graph-js";
import { mapAudioGraph, AUDIO_CATEGORY, AUDIO_PORT_TYPE } from "./map-audio-graph.js";

describe("mapAudioGraph", () => {
  it("maps every node to the single 'audio' category, distinct from every behavior-graph category (UX-601)", () => {
    const graph: KHRGraph = { nodes: [{ kind: "gain", label: "g" }], connections: [] };
    const mapped = mapAudioGraph(graph, 0);
    expect(mapped.nodes).toHaveLength(1);
    expect(mapped.nodes[0].category).toBe(AUDIO_CATEGORY);
    expect(AUDIO_CATEGORY).not.toBe("unknown");
  });

  it("gives every port the 'audio' type and only value ports (no flow ports) (UX-605)", () => {
    const graph: KHRGraph = {
      nodes: [
        { kind: "gain", label: "g" },
        { kind: "biquadFilter", label: "f" }
      ],
      connections: [{ from: { node: 0 }, to: { node: 1 } }]
    };
    const mapped = mapAudioGraph(graph, 0);
    for (const node of mapped.nodes) {
      for (const port of node.ports) {
        expect(port.kind === "value-in" || port.kind === "value-out").toBe(true);
        expect(port.type).toBe(AUDIO_PORT_TYPE);
      }
    }
  });

  it("never assigns the 'pointer' category (UX-606)", () => {
    const graph: KHRGraph = { nodes: [{ kind: "gain", label: "g" }], connections: [] };
    const mapped = mapAudioGraph(graph, 0);
    expect(mapped.nodes.every((n) => n.category !== "pointer")).toBe(true);
  });

  it("synthesizes exactly one terminal emitter node per graph.outputs[] entry, with zero outputs and the emitter name as config (UX-607)", () => {
    const graph: KHRGraph = {
      nodes: [{ kind: "gain", label: "g" }],
      connections: [],
      outputs: [{ node: 0, emitter: 0 }]
    };
    const mapped = mapAudioGraph(graph, 0, [{ type: "global", name: "Drone" }]);
    const emitterNode = mapped.nodes.find((n) => n.op === "emitter");
    expect(emitterNode).toBeDefined();
    expect(emitterNode!.subtitle).toBe("Drone");
    expect(emitterNode!.ports.filter((p) => p.kind === "value-out")).toHaveLength(0);
    expect(emitterNode!.ports.filter((p) => p.kind === "value-in")).toHaveLength(1);
  });

  it("marks every edge between two nodes named in a cycle lint result as invalid, dashed-rendered (UX-603)", () => {
    const graph: KHRGraph = {
      nodes: [
        { kind: "gain", label: "gainA" },
        { kind: "biquadFilter", label: "filterB" }
      ],
      connections: [
        { from: { node: 0 }, to: { node: 1 } },
        { from: { node: 1 }, to: { node: 0 } }
      ]
    };
    const mapped = mapAudioGraph(graph, 0, [], [
      { graphIndex: 0, severity: "error", code: "cycle", message: "cycle detected (gainA → filterB → gainA)", nodeIds: ["gainA", "filterB"] }
    ]);
    expect(mapped.edges).toHaveLength(2);
    expect(mapped.edges.every((e) => e.invalid)).toBe(true);
  });

  it("does not mark edges invalid when there is no cycle violation", () => {
    const graph: KHRGraph = {
      nodes: [{ kind: "gain", label: "g" }, { kind: "biquadFilter", label: "f" }],
      connections: [{ from: { node: 0 }, to: { node: 1 } }]
    };
    const mapped = mapAudioGraph(graph, 0, [], []);
    expect(mapped.edges.every((e) => !e.invalid)).toBe(true);
  });
});
