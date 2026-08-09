import { describe, expect, it } from "vitest";
import { applyPatches, type EditorDocument } from "@gltf-studio/editor-core";
import { ensureTypeIndex, setLiteralValue } from "./graph-edit-ext.js";

function makeDocument(graph: unknown): EditorDocument {
  const json = { asset: { version: "2.0" }, extensions: { KHR_interactivity: { graphs: [graph] } } };
  // `container` is never read by GraphEdit/graph-edit-ext — only `.json` is.
  return { container: {} as never, json, rev: 0, dirtyRoots: new Set(), frozen: false };
}

describe("ensureTypeIndex", () => {
  it("appends a new types[] entry and returns its index", () => {
    const document = makeDocument({ types: [{ signature: "bool" }], declarations: [], nodes: [] });
    const { command, index } = ensureTypeIndex(document, 0, "float");
    expect(index).toBe(1);
    expect(command.patches).toHaveLength(1);
    const next = applyPatches(document.json, command.patches) as { extensions: { KHR_interactivity: { graphs: [{ types: Array<{ signature: string }> }] } } };
    expect(next.extensions.KHR_interactivity.graphs[0].types).toEqual([{ signature: "bool" }, { signature: "float" }]);
  });

  it("returns the existing index with a no-op command when the signature is already present", () => {
    const document = makeDocument({ types: [{ signature: "bool" }, { signature: "float" }], declarations: [], nodes: [] });
    const { command, index } = ensureTypeIndex(document, 0, "float");
    expect(index).toBe(1);
    expect(command.patches).toEqual([]);
    expect(command.inverse).toEqual([]);
  });
});

describe("setLiteralValue", () => {
  it("ensures the type entry and sets a literal in one undoable command", () => {
    const document = makeDocument({
      types: [],
      declarations: [{ op: "math/add" }],
      nodes: [{ declaration: 0 }]
    });
    const command = setLiteralValue(document, 0, 0, "a", "float", [2.5]);
    const after = applyPatches(document.json, command.patches) as {
      extensions: { KHR_interactivity: { graphs: [{ types: Array<{ signature: string }>; nodes: Array<{ values?: Record<string, unknown> }> }] } };
    };
    const graph = after.extensions.KHR_interactivity.graphs[0];
    expect(graph.types).toEqual([{ signature: "float" }]);
    expect(graph.nodes[0].values).toEqual({ a: { type: 0, value: [2.5] } });

    // Undo restores the original graph (no types[], no values) exactly.
    const restored = applyPatches(after, command.inverse) as typeof document.json;
    expect(restored).toEqual(document.json);
  });

  it("reuses an existing type index across two literals of the same signature (no duplicate types[] entries)", () => {
    let document = makeDocument({
      types: [],
      declarations: [{ op: "math/add" }],
      nodes: [{ declaration: 0 }]
    });
    const first = setLiteralValue(document, 0, 0, "a", "float", [1]);
    document = { ...document, json: applyPatches(document.json, first.patches) };
    const second = setLiteralValue(document, 0, 0, "b", "float", [2]);
    document = { ...document, json: applyPatches(document.json, second.patches) };

    const graph = (document.json as { extensions: { KHR_interactivity: { graphs: unknown[] } } }).extensions.KHR_interactivity.graphs[0] as {
      types: Array<{ signature: string }>;
      nodes: Array<{ values: Record<string, { type: number; value: number[] }> }>;
    };
    expect(graph.types).toEqual([{ signature: "float" }]);
    expect(graph.nodes[0].values.a).toEqual({ type: 0, value: [1] });
    expect(graph.nodes[0].values.b).toEqual({ type: 0, value: [2] });
  });
});
