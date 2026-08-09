import { describe, expect, it } from "vitest";
import { applyPatches, type EditorDocument } from "@gltf-studio/editor-core";
import { ensureGraphScaffold } from "./ensure-graph.js";

function makeDocument(json: unknown): EditorDocument {
  return { container: {} as never, json, rev: 0, dirtyRoots: new Set(), frozen: false };
}

describe("ensureGraphScaffold", () => {
  it("creates extensions.KHR_interactivity + extensionsUsed when absent, preserving sibling extensions", () => {
    const document = makeDocument({ asset: { version: "2.0" }, extensions: { KHR_lights_punctual: { lights: [] } } });
    const result = ensureGraphScaffold(document);
    expect(result.command).not.toBeNull();
    expect(result.graphIndex).toBe(0);

    const next = applyPatches(document.json, result.command!.patches) as {
      extensions: { KHR_lights_punctual: unknown; KHR_interactivity: { graphs: Array<{ types: unknown[]; declarations: unknown[]; nodes: unknown[] }> } };
      extensionsUsed: string[];
    };
    expect(next.extensions.KHR_lights_punctual).toEqual({ lights: [] });
    expect(next.extensions.KHR_interactivity.graphs).toEqual([{ types: [], declarations: [], nodes: [] }]);
    expect(next.extensionsUsed).toContain("KHR_interactivity");
    expect(result.documentAfter.json).toEqual(next);

    // Undo restores exactly.
    const restored = applyPatches(next, result.command!.inverse);
    expect(restored).toEqual(document.json);
  });

  it("adds extensionsUsed without duplicating an existing array", () => {
    const document = makeDocument({ asset: { version: "2.0" }, extensionsUsed: ["KHR_lights_punctual"] });
    const result = ensureGraphScaffold(document);
    const next = applyPatches(document.json, result.command!.patches) as { extensionsUsed: string[] };
    expect(next.extensionsUsed).toEqual(["KHR_lights_punctual", "KHR_interactivity"]);
  });

  it("is a no-op when a graph already exists", () => {
    const document = makeDocument({ extensions: { KHR_interactivity: { graphs: [{ types: [], declarations: [], nodes: [] }] } } });
    const result = ensureGraphScaffold(document);
    expect(result.command).toBeNull();
    expect(result.graphIndex).toBe(0);
    expect(result.documentAfter).toBe(document);
  });
});
