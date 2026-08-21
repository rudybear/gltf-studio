import { describe, expect, it } from "vitest";
import { importAudioGraph } from "@gltf-audiograph/ir";
import { emitAudioModule } from "@gltf-audiograph/emit-ts";
import { parseAudioModule } from "@gltf-audiograph/parse-ts";
import { checkAudioEquivalence } from "./equivalence.js";

const FIXTURE_GRAPH = {
  nodes: [{ kind: "gain", label: "gainA", params: { gain: 0.5 } }],
  connections: [],
  inputs: [{ source: 0, node: 0, input: 0 }],
  outputs: [{ node: 0, output: 0, emitter: 0 }]
};

function reparse(code: string) {
  const { module, diagnostics } = parseAudioModule(code);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return module;
}

describe("checkAudioEquivalence (specs/ux-audio-script.md UX-1400)", () => {
  it("reports EQUIV for an unedited round trip (graph -> emit -> parse)", () => {
    const { module } = importAudioGraph(FIXTURE_GRAPH);
    const { code } = emitAudioModule(module);
    const reparsed = reparse(code);
    expect(checkAudioEquivalence(FIXTURE_GRAPH, module, reparsed)).toEqual({ status: "equiv" });
  });

  it("reports DIVERGED once the parsed code's gain value differs from the graph", () => {
    const { module } = importAudioGraph(FIXTURE_GRAPH);
    const { code } = emitAudioModule(module);
    const edited = code.replace("gain: 0.5", "gain: 0.9");
    const reparsed = reparse(edited);
    const result = checkAudioEquivalence(FIXTURE_GRAPH, module, reparsed);
    expect(result.status).toBe("diverged");
  });

  it("reports DIVERGED once a connection is rewired", () => {
    const { module } = importAudioGraph(FIXTURE_GRAPH);
    const { code } = emitAudioModule(module);
    const edited = code.replace("a.emitter(0)", "a.emitter(1)");
    const reparsed = reparse(edited);
    const result = checkAudioEquivalence(FIXTURE_GRAPH, module, reparsed);
    expect(result.status).toBe("diverged");
  });
});
