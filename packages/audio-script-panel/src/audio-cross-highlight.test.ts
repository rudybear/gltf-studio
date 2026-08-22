import { describe, expect, it } from "vitest";
import { importAudioGraph } from "@gltf-audiograph/ir";
import { emitAudioModule } from "@gltf-audiograph/emit-ts";
import { findHighlightForAudioNode, findHighlightForAudioSource, offsetToLineColumn } from "./audio-cross-highlight.js";

const FIXTURE_GRAPH = {
  nodes: [
    { kind: "gain", label: "gainA", params: { gain: 0.5 } },
    { kind: "lowpass", label: "filterB", params: { frequency: 800 } }
  ],
  connections: [{ from: { node: 0, output: 0 }, to: { node: 1, input: 0 } }],
  inputs: [{ source: 0, node: 0, input: 0 }],
  outputs: [{ node: 1, output: 0, emitter: 0 }]
};

describe("findHighlightForAudioNode/findHighlightForAudioSource (specs/ux-audio-script.md UX-1400)", () => {
  it("resolves a node index to its declaration identifier's exact text range", () => {
    const { module } = importAudioGraph(FIXTURE_GRAPH);
    const { code, names } = emitAudioModule(module);
    const match = findHighlightForAudioNode(names, code, 1);
    expect(match).not.toBeNull();
    expect(code.slice(match!.offset, match!.offset + match!.length)).toBe(names[1]);
  });

  it("resolves a source index to its declaration identifier's exact text range", () => {
    const { module } = importAudioGraph(FIXTURE_GRAPH);
    const { code, sourceNames } = emitAudioModule(module);
    const match = findHighlightForAudioSource(sourceNames, code, 0);
    expect(match).not.toBeNull();
    expect(code.slice(match!.offset, match!.offset + match!.length)).toBe(sourceNames[0]);
  });

  it("returns null for an index with no name entry (e.g. stale after a graph edit)", () => {
    const { module } = importAudioGraph(FIXTURE_GRAPH);
    const { code, names } = emitAudioModule(module);
    expect(findHighlightForAudioNode(names, code, 99)).toBeNull();
  });
});

describe("offsetToLineColumn", () => {
  it("converts a plain offset to 1-based line/column", () => {
    const code = "line one\nline two\nline three";
    expect(offsetToLineColumn(code, 0)).toEqual({ lineNumber: 1, column: 1 });
    expect(offsetToLineColumn(code, 9)).toEqual({ lineNumber: 2, column: 1 });
    expect(offsetToLineColumn(code, 14)).toEqual({ lineNumber: 2, column: 6 });
  });
});
