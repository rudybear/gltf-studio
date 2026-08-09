// AudioGraphJsHost tests, vitest browser mode (real AudioContext — see
// vitest.config.ts): buildGraph/lint against a valid chain, a cyclic
// (invalid) graph, a document with no KHR_audio_graph at all (AGH-001's
// "reports empty gracefully"), and audition()'s lazy real-node build.
import { describe, expect, it } from "vitest";
import { AudioGraphJsHost } from "../src/index.js";

function baseEmitterExtension() {
  return {
    audio: [{ uri: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=" }],
    sources: [{ audio: 0 }],
    emitters: [{ type: "global" }]
  };
}

describe("AudioGraphJsHost", () => {
  it("reports empty (no lint violations, buildGraph does not throw) when the document has no KHR_audio_graph extension (AGH-001)", () => {
    const host = new AudioGraphJsHost();
    expect(() => host.buildGraph({ asset: { version: "2.0" } })).not.toThrow();
    expect(host.lint()).toEqual([]);
  });

  it("parses and lints a valid bufferSource -> gain -> emitter chain with no violations", () => {
    const doc = {
      asset: { version: "2.0" },
      extensions: {
        KHR_audio_emitter: baseEmitterExtension(),
        KHR_audio_graph: {
          graphs: [
            {
              nodes: [
                { kind: "gain", label: "gain", params: { gain: 0.5 } }
              ],
              connections: [],
              inputs: [{ source: 0, node: 0 }],
              outputs: [{ node: 0, emitter: 0 }]
            }
          ]
        }
      }
    };
    const host = new AudioGraphJsHost();
    host.buildGraph(doc);
    const errors = host.lint().filter((r) => r.severity === "error");
    expect(errors).toEqual([]);
  });

  it("names the actual node path in a cycle violation (UX-602)", () => {
    const doc = {
      asset: { version: "2.0" },
      extensions: {
        KHR_audio_emitter: baseEmitterExtension(),
        KHR_audio_graph: {
          graphs: [
            {
              nodes: [
                { kind: "gain", label: "gainA" },
                { kind: "biquadFilter", label: "filterB" }
              ],
              connections: [
                { from: { node: 0 }, to: { node: 1 } },
                { from: { node: 1 }, to: { node: 0 } }
              ]
            }
          ]
        }
      }
    };
    const host = new AudioGraphJsHost();
    host.buildGraph(doc);
    const cycle = host.lint().find((r) => r.code === "cycle");
    expect(cycle).toBeDefined();
    expect(cycle!.severity).toBe("error");
    expect(cycle!.nodeIds).toEqual(expect.arrayContaining(["gainA", "filterB"]));
    expect(cycle!.message).toContain("gainA");
    expect(cycle!.message).toContain("filterB");
  });

  it("flags KHR_audio_graph present without a sibling KHR_audio_emitter extension", () => {
    const doc = { asset: { version: "2.0" }, extensions: { KHR_audio_graph: { graphs: [{ nodes: [], connections: [] }] } } };
    const host = new AudioGraphJsHost();
    host.buildGraph(doc);
    const results = host.lint();
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("missing-emitter-extension");
    expect(results[0].severity).toBe("error");
  });

  it("audition() lazily builds real Web Audio nodes and does not throw for a known node id; no-ops for an unknown one", () => {
    const doc = {
      asset: { version: "2.0" },
      extensions: {
        KHR_audio_emitter: baseEmitterExtension(),
        KHR_audio_graph: { graphs: [{ nodes: [{ kind: "gain", label: "g" }], connections: [], inputs: [{ source: 0, node: 0 }], outputs: [{ node: 0, emitter: 0 }] }] }
      }
    };
    const host = new AudioGraphJsHost();
    host.buildGraph(doc);
    expect(() => host.audition("g")).not.toThrow();
    expect(() => host.audition("not-a-real-node")).not.toThrow();
    expect(host.trace().length).toBeGreaterThan(0);
    host.close();
  });
});
