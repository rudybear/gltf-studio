// validateGraph (AGH-001) tests: the cycle-path naming already covered via
// audio-graph-host.test.ts's browser-mode suite gets its own direct
// coverage here for the newer checks this file doesn't exercise yet —
// G1/G2 runtime-vs-schema messaging (validators.ts's header comment) and
// the splitter/channelmerger channel-port bounds check (UX-615).
import { describe, expect, it } from "vitest";
import type { KHRGraph } from "audio-graph-js";
import { validateGraph } from "./validators.js";

describe("validateGraph: compressor (gap-analysis G1, resolved-in-schema/runtime-not-yet-caught-up)", () => {
  it("flags a compressor node as a runtime-unimplemented warning, not an error", () => {
    const graph: KHRGraph = {
      nodes: [{ kind: "compressor", label: "comp", params: { threshold: -24 } }],
      connections: []
    };
    const results = validateGraph(0, graph);
    const hit = results.find((r) => r.code === "compressor-runtime-unimplemented");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
    expect(hit!.message).toMatch(/valid per the ratified KHR_audio_graph schema/);
    expect(hit!.message).toMatch(/vendored AudioGraphJS runtime/);
  });
});

describe("validateGraph: oscillator periodicWave / gain curve (gap-analysis G2, resolved-in-schema/runtime-not-yet-caught-up)", () => {
  it("still flags an undefined custom-oscillator payload when periodicWave is absent", () => {
    const graph: KHRGraph = { nodes: [{ kind: "oscillator", label: "osc", params: { type: "custom" } }], connections: [] };
    const results = validateGraph(0, graph);
    expect(results.find((r) => r.code === "custom-oscillator-undefined")).toBeDefined();
    expect(results.find((r) => r.code === "oscillator-periodicwave-runtime-unimplemented")).toBeUndefined();
  });

  it("switches to the runtime-unimplemented warning once periodicWave IS authored (schema-valid, not yet audible)", () => {
    const graph: KHRGraph = {
      nodes: [{ kind: "oscillator", label: "osc", params: { type: "custom", periodicWave: { real: [0, 1], imag: [0, 0] } } }],
      connections: []
    };
    const results = validateGraph(0, graph);
    expect(results.find((r) => r.code === "custom-oscillator-undefined")).toBeUndefined();
    const hit = results.find((r) => r.code === "oscillator-periodicwave-runtime-unimplemented");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
  });

  it("switches to the runtime-unimplemented warning once a gain curve IS authored", () => {
    const graph: KHRGraph = {
      nodes: [{ kind: "gain", label: "g", params: { interpolation: "custom", curve: [0, 0.5, 1] } }],
      connections: []
    };
    const results = validateGraph(0, graph);
    expect(results.find((r) => r.code === "custom-interpolation-undefined")).toBeUndefined();
    const hit = results.find((r) => r.code === "gain-curve-runtime-unimplemented");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
  });
});

describe("validateGraph: splitter/channelmerger channel-port bounds (UX-615)", () => {
  it("flags a splitter connection whose output index exceeds its declared numberOfOutputs", () => {
    const graph: KHRGraph = {
      nodes: [
        { kind: "splitter", label: "split", params: { numberOfOutputs: 2 } },
        { kind: "gain", label: "g0", params: {} },
        { kind: "gain", label: "g1", params: {} }
      ],
      connections: [
        { from: { node: 0, output: 0 }, to: { node: 1, input: 0 } },
        { from: { node: 0, output: 3 }, to: { node: 2, input: 0 } }
      ]
    };
    const results = validateGraph(0, graph);
    const hit = results.find((r) => r.code === "channel-port-out-of-bounds");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("error");
    expect(hit!.message).toContain("split");
    expect(hit!.message).toContain("3");
    expect(hit!.message).toContain("numberOfOutputs");
  });

  it("flags a channelmerger connection whose input index exceeds its declared numberOfInputs", () => {
    const graph: KHRGraph = {
      nodes: [
        { kind: "gain", label: "g0", params: {} },
        { kind: "channelmerger", label: "merge", params: { numberOfInputs: 2 } }
      ],
      connections: [{ from: { node: 0, output: 0 }, to: { node: 1, input: 5 } }]
    };
    const results = validateGraph(0, graph);
    const hit = results.find((r) => r.code === "channel-port-out-of-bounds");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("error");
    expect(hit!.message).toContain("merge");
    expect(hit!.message).toContain("numberOfInputs");
  });

  it("does not flag a splitter/channelmerger whose connections stay within the declared count", () => {
    const graph: KHRGraph = {
      nodes: [
        { kind: "splitter", label: "split", params: { numberOfOutputs: 4 } },
        { kind: "gain", label: "g", params: {} }
      ],
      connections: [{ from: { node: 0, output: 3 }, to: { node: 1, input: 0 } }]
    };
    const results = validateGraph(0, graph);
    expect(results.find((r) => r.code === "channel-port-out-of-bounds")).toBeUndefined();
  });

  it("falls back to the default declared count (2) when numberOfOutputs/numberOfInputs is absent", () => {
    const graph: KHRGraph = {
      nodes: [
        { kind: "splitter", label: "split", params: {} },
        { kind: "gain", label: "g", params: {} }
      ],
      connections: [{ from: { node: 0, output: 2 }, to: { node: 1, input: 0 } }]
    };
    const results = validateGraph(0, graph);
    expect(results.find((r) => r.code === "channel-port-out-of-bounds")).toBeDefined();
  });
});
