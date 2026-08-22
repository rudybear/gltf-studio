import { describe, expect, it } from "vitest";
import { buildAudioEmitView, provenanceComment } from "./emit-view.js";

const FIXTURE_GRAPH = {
  nodes: [{ kind: "gain", label: "gainA", params: { gain: 0.5 } }],
  connections: [],
  inputs: [{ source: 0, node: 0, input: 0 }],
  outputs: [{ node: 0, output: 0, emitter: 0 }]
};

describe("buildAudioEmitView (specs/ux-audio-script.md UX-1400)", () => {
  it("opens with a leading provenance comment naming the source audio graph", () => {
    const view = buildAudioEmitView(FIXTURE_GRAPH, 0);
    expect(view.code.startsWith(provenanceComment(0))).toBe(true);
    expect(view.code).toContain("generated from audio graph 0");
  });

  it("contains the fixture's expected declarations and names, keyed by node/source index", () => {
    const view = buildAudioEmitView(FIXTURE_GRAPH, 0);
    expect(view.code).toContain("a.gain(");
    expect(view.code).toContain(".out.connect(a.emitter(0));");
    expect(view.names[0]).toBeDefined();
    expect(view.code).toContain(`const ${view.names[0]} =`);
  });

  it("does not throw on a graph referencing an out-of-range node index (importAudioGraph's own robustness, exercised through this wrapper)", () => {
    const badGraph = { nodes: [], connections: [], outputs: [{ node: 5, output: 0, emitter: 0 }] };
    expect(() => buildAudioEmitView(badGraph, 0)).not.toThrow();
  });

  it("surfaces an r2 diagnostic (not a throw) for a legacy oscillator-as-node-kind graph — a foreign/malformed-document shape, no longer producible via this app's own canvas/palette (specs/ux-audio-script.md Implementation notes)", () => {
    const legacyGraph = { nodes: [{ kind: "oscillator", params: { type: "sine", frequency: 440 } }], connections: [], outputs: [] };
    const view = buildAudioEmitView(legacyGraph, 0);
    expect(view.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});
