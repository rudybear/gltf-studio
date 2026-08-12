import { describe, expect, it } from "vitest";
import { identifyMappedNode, parseInputSocket, parseOutputSocket } from "./audio-entity.js";
import { mapAudioGraph } from "./map-audio-graph.js";
import type { KHRGraph } from "audio-graph-js";

const graph: KHRGraph = {
  nodes: [
    { kind: "gain", label: "gainA", params: { gain: 0.5 } },
    { kind: "lowpass", label: "filterB", params: { frequency: 800 } }
  ],
  connections: [{ from: { node: 0, output: 0 }, to: { node: 1, input: 0 } }],
  inputs: [{ source: 0, node: 0, input: 0 }],
  outputs: [{ node: 1, output: 0, emitter: 0 }]
};

describe("identifyMappedNode", () => {
  it("identifies real graph nodes by their raw KHRGraphNodeSpec shape, with rawIndex === mapped index", () => {
    const mapped = mapAudioGraph(graph, 0);
    expect(identifyMappedNode(mapped.nodes[0])).toEqual({ type: "node", rawIndex: 0 });
    expect(identifyMappedNode(mapped.nodes[1])).toEqual({ type: "node", rawIndex: 1 });
  });

  it("identifies the synthetic source terminal", () => {
    const mapped = mapAudioGraph(graph, 0);
    const sourceNode = mapped.nodes.find((n) => n.op === "audio-buffer-source");
    expect(sourceNode).toBeDefined();
    expect(identifyMappedNode(sourceNode!)).toEqual({ type: "source", sourceIndex: 0 });
  });

  it("identifies the synthetic emitter terminal", () => {
    const mapped = mapAudioGraph(graph, 0);
    const emitterNode = mapped.nodes.find((n) => n.op === "emitter");
    expect(emitterNode).toBeDefined();
    expect(identifyMappedNode(emitterNode!)).toEqual({ type: "emitter", emitterIndex: 0 });
  });
});

describe("parseInputSocket / parseOutputSocket", () => {
  it("parses the single-port fallback name to index 0", () => {
    expect(parseInputSocket("in")).toBe(0);
    expect(parseOutputSocket("out")).toBe(0);
  });

  it("parses a numbered multi-port name to its index", () => {
    expect(parseInputSocket("in3")).toBe(3);
    expect(parseOutputSocket("out2")).toBe(2);
  });
});
