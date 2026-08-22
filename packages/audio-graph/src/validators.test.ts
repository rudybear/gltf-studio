// validateGraph (AGH-001) tests: the cycle-path naming already covered via
// audio-graph-host.test.ts's browser-mode suite gets its own direct
// coverage here for the newer checks this file doesn't exercise yet —
// G1/G2 runtime-vs-schema messaging (validators.ts's header comment), now
// updated for spec r2: oscillators are `KHR_audio_emitter` SOURCES (never a
// `graph.nodes[]` kind), and splitter/channelmerger arity is derived from
// wiring (no more authored `numberOfOutputs`/`numberOfInputs` params, so no
// more "declared count" bounds check).
import { describe, expect, it } from "vitest";
import type { AudioEmitterSource, KHRGraph } from "audio-graph-js";
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

describe("validateGraph: custom-oscillator source payload (gap-analysis G2, r2 source-data shape)", () => {
  const graphWithOneOscillatorInput = (): KHRGraph => ({
    nodes: [{ kind: "gain", label: "vol", params: { gain: 0.5 } }],
    connections: [],
    inputs: [{ source: 0, node: 0 }]
  });

  it("flags an undefined custom-oscillator payload when the referenced source's periodicWave is absent", () => {
    const graph = graphWithOneOscillatorInput();
    const sources: AudioEmitterSource[] = [{ extensions: { KHR_audio_graph: { oscillator: { type: "custom" } } } }];
    const results = validateGraph(0, graph, sources);
    const hit = results.find((r) => r.code === "custom-oscillator-undefined");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
    expect(hit!.nodeIds).toEqual(["source:0"]);
  });

  it("does not flag once the source's periodicWave IS authored — the vendored runtime now builds a real PeriodicWave from it", () => {
    const graph = graphWithOneOscillatorInput();
    const sources: AudioEmitterSource[] = [
      { extensions: { KHR_audio_graph: { oscillator: { type: "custom", periodicWave: { real: [0, 1], imag: [0, 0] } } } } }
    ];
    const results = validateGraph(0, graph, sources);
    expect(results.find((r) => r.code === "custom-oscillator-undefined")).toBeUndefined();
    // r2: periodicWave IS audible now (nodes/oscillator.ts builds a real PeriodicWave) — no runtime-unimplemented warning exists for this any more.
    expect(results.some((r) => r.code === "oscillator-periodicwave-runtime-unimplemented")).toBe(false);
  });

  it("does not flag a non-custom oscillator source even with no periodicWave", () => {
    const graph = graphWithOneOscillatorInput();
    const sources: AudioEmitterSource[] = [{ extensions: { KHR_audio_graph: { oscillator: { type: "sine", frequency: 440 } } } }];
    const results = validateGraph(0, graph, sources);
    expect(results.find((r) => r.code === "custom-oscillator-undefined")).toBeUndefined();
  });

  it("does nothing when no sources are passed (default [])", () => {
    const graph = graphWithOneOscillatorInput();
    expect(() => validateGraph(0, graph)).not.toThrow();
  });

  it("does not flag a malformed source declaring BOTH audio and an oscillator payload as an oscillator (regression, code review: this discriminator must match map-audio-graph.ts's/AudioSection.tsx's, which both require audio to be absent)", () => {
    const graph = graphWithOneOscillatorInput();
    const sources: AudioEmitterSource[] = [{ audio: 0, extensions: { KHR_audio_graph: { oscillator: { type: "custom" } } } }];
    const results = validateGraph(0, graph, sources);
    // A source with `audio` set is a CLIP everywhere else in this app (the vendored runtime's own
    // lintLayeredGraph flags the both-set case as its own "audio-and-oscillator" error) — this
    // check must not additionally call it "an oscillator" too, contradicting every other rendering.
    expect(results.find((r) => r.code === "custom-oscillator-undefined")).toBeUndefined();
  });
});

describe("validateGraph: gain curve (gap-analysis G2)", () => {
  it("flags an undefined custom-interpolation payload when curve is absent", () => {
    const graph: KHRGraph = { nodes: [{ kind: "gain", label: "g", params: { interpolation: "custom" } }], connections: [] };
    const results = validateGraph(0, graph);
    expect(results.find((r) => r.code === "custom-interpolation-undefined")).toBeDefined();
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

describe("validateGraph: r2 splitter/channelmerger arity is derived, not authored", () => {
  it("never flags channel-port-out-of-bounds any more — arity is unbounded/derived from wiring", () => {
    const graph: KHRGraph = {
      nodes: [
        { kind: "splitter", label: "split", params: {} },
        { kind: "gain", label: "g0", params: {} },
        { kind: "gain", label: "g1", params: {} }
      ],
      connections: [
        { from: { node: 0, output: 0 }, to: { node: 1, input: 0 } },
        { from: { node: 0, output: 7 }, to: { node: 2, input: 0 } }
      ]
    };
    const results = validateGraph(0, graph);
    expect(results.find((r) => r.code === "channel-port-out-of-bounds")).toBeUndefined();
  });

  it("does not read numberOfOutputs/numberOfInputs params at all (legacy params, if present, are simply ignored by this validator)", () => {
    const graph: KHRGraph = {
      nodes: [
        { kind: "channelmerger", label: "merge", params: { numberOfInputs: 2 } },
        { kind: "gain", label: "g", params: {} }
      ],
      connections: [{ from: { node: 1, output: 0 }, to: { node: 0, input: 5 } }]
    };
    const results = validateGraph(0, graph);
    expect(results.find((r) => r.code === "channel-port-out-of-bounds")).toBeUndefined();
  });
});
