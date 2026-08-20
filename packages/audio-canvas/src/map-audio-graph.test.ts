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

  it("M7 audio-graph editing: a freshly-added, still-unconnected node has a default in/out port to drag a connection onto (no chicken-and-egg dead end)", () => {
    const graph: KHRGraph = { nodes: [{ kind: "lowpass", label: "freshFilter", params: { frequency: 500 } }], connections: [] };
    const mapped = mapAudioGraph(graph, 0);
    const node = mapped.nodes[0];
    expect(node.ports.filter((p) => p.kind === "value-in")).toHaveLength(1);
    expect(node.ports.filter((p) => p.kind === "value-out")).toHaveLength(1);
  });

  it("M7 audio-graph editing: a fresh unconnected oscillator has an output but no input (pure source)", () => {
    const graph: KHRGraph = { nodes: [{ kind: "oscillator", label: "freshOsc", params: { type: "sine" } }], connections: [] };
    const mapped = mapAudioGraph(graph, 0);
    const node = mapped.nodes[0];
    expect(node.ports.filter((p) => p.kind === "value-in")).toHaveLength(0);
    expect(node.ports.filter((p) => p.kind === "value-out")).toHaveLength(1);
  });

  it("does not mark edges invalid when there is no cycle violation", () => {
    const graph: KHRGraph = {
      nodes: [{ kind: "gain", label: "g" }, { kind: "biquadFilter", label: "f" }],
      connections: [{ from: { node: 0 }, to: { node: 1 } }]
    };
    const mapped = mapAudioGraph(graph, 0, [], []);
    expect(mapped.edges.every((e) => !e.invalid)).toBe(true);
  });

  describe("UX-615: splitter/channelmerger fan ports seeded from their declared channel-count param", () => {
    it("a fresh, unconnected splitter with numberOfOutputs=4 renders 4 output ports (not just slot 0)", () => {
      const graph: KHRGraph = { nodes: [{ kind: "splitter", label: "split", params: { numberOfOutputs: 4 } }], connections: [] };
      const mapped = mapAudioGraph(graph, 0);
      const node = mapped.nodes[0];
      expect(node.ports.filter((p) => p.kind === "value-in")).toHaveLength(1);
      expect(node.ports.filter((p) => p.kind === "value-out")).toHaveLength(4);
      expect(node.ports.filter((p) => p.kind === "value-out").map((p) => p.name).sort()).toEqual(["out0", "out1", "out2", "out3"]);
    });

    it("a fresh, unconnected channelmerger with numberOfInputs=3 renders 3 input ports", () => {
      const graph: KHRGraph = { nodes: [{ kind: "channelmerger", label: "merge", params: { numberOfInputs: 3 } }], connections: [] };
      const mapped = mapAudioGraph(graph, 0);
      const node = mapped.nodes[0];
      expect(node.ports.filter((p) => p.kind === "value-in")).toHaveLength(3);
      expect(node.ports.filter((p) => p.kind === "value-out")).toHaveLength(1);
    });

    it("falls back to 2 fan ports when numberOfOutputs/numberOfInputs is absent (matching the registry's own field default)", () => {
      const graph: KHRGraph = { nodes: [{ kind: "splitter", label: "split" }], connections: [] };
      const mapped = mapAudioGraph(graph, 0);
      expect(mapped.nodes[0].ports.filter((p) => p.kind === "value-out")).toHaveLength(2);
    });

    it("real connections[] usage beyond the declared count still shows up (union, never a hard cap)", () => {
      const graph: KHRGraph = {
        nodes: [
          { kind: "splitter", label: "split", params: { numberOfOutputs: 2 } },
          { kind: "gain", label: "g" }
        ],
        connections: [{ from: { node: 0, output: 5 }, to: { node: 1, input: 0 } }]
      };
      const mapped = mapAudioGraph(graph, 0);
      const splitNode = mapped.nodes.find((n) => n.op === "splitter")!;
      // Declared 0,1 plus the actually-wired index 5 — 3 distinct output ports.
      expect(splitNode.ports.filter((p) => p.kind === "value-out")).toHaveLength(3);
    });
  });

  describe("UX-617: synthetic source/emitter terminal nodes carry the underlying entity's extras through", () => {
    it("a source terminal's raw.extras reflects sources[N].extras", () => {
      const graph: KHRGraph = { nodes: [{ kind: "gain", label: "g" }], connections: [], inputs: [{ source: 0, node: 0 }] };
      const mapped = mapAudioGraph(graph, 0, [], [], [{ audio: 0, extras: { gltfi: { x: 10, y: 20 } } }]);
      const sourceNode = mapped.nodes.find((n) => n.op === "audio-buffer-source")!;
      expect((sourceNode.raw as { extras?: { gltfi?: { x: number; y: number } } }).extras).toEqual({ gltfi: { x: 10, y: 20 } });
    });

    it("an emitter terminal's raw.extras reflects emitters[N].extras", () => {
      const graph: KHRGraph = { nodes: [{ kind: "gain", label: "g" }], connections: [], outputs: [{ node: 0, emitter: 0 }] };
      const mapped = mapAudioGraph(graph, 0, [{ type: "global", extras: { gltfi: { x: 5, y: 6 } } }]);
      const emitterNode = mapped.nodes.find((n) => n.op === "emitter")!;
      expect((emitterNode.raw as { extras?: { gltfi?: { x: number; y: number } } }).extras).toEqual({ gltfi: { x: 5, y: 6 } });
    });
  });
});
