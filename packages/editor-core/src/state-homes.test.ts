import { describe, expect, it } from "vitest";
import { applyCommand } from "./document.js";
import { HistoryStack } from "./history.js";
import { GraphEdit } from "./graph-edit.js";
import { fixtureDocument } from "./test-fixtures.js";

type GraphJson = {
  extensions: { KHR_interactivity: { graphs: Array<{ nodes: Array<{ extras?: { gltfi: { x: number; y: number } } }> }> } };
};

/**
 * DOC-028/DOC-029/DOC-030 describe WHERE three kinds of editor state live:
 * graph-node positions in the authored asset (undoable), panel layout /
 * camera bookmarks in a `StorageProvider` sidecar (not editor-core's
 * concern, not undoable), and selection/hover/play-mode state only in an
 * ephemeral in-memory store (never written to `json` or the sidecar). This
 * package implements the first; these tests pin down that editor-core's
 * `EditorDocument`/`Command` surface has no notion of the other two, and
 * that positions really do flow through the normal undo mechanism.
 */
describe("state homes (DOC-028, DOC-029, DOC-030)", () => {
  it("DOC-028: a graph node position edit is saved with json and is undoable via HistoryStack", () => {
    const stack = new HistoryStack(fixtureDocument());
    stack.push(GraphEdit.setNodePosition(stack.document, 0, 0, 100, 200));
    const graph = (stack.document.json as GraphJson).extensions.KHR_interactivity.graphs[0];
    expect(graph.nodes[0].extras?.gltfi).toEqual({ x: 100, y: 200 });

    stack.undo();
    const graphAfterUndo = (stack.document.json as GraphJson).extensions.KHR_interactivity.graphs[0];
    expect(graphAfterUndo.nodes[0].extras).toBeUndefined();
  });

  it("DOC-029/DOC-030: EditorDocument carries no sidecar or ephemeral-state fields", () => {
    const doc = fixtureDocument();
    // Only DOC-001..004's own fields (plus the internal `frozen` flag, DOC-031) exist —
    // no `sidecar`, `selection`, `hover`, or `playMode` field anywhere on the document value.
    expect(Object.keys(doc).sort()).toEqual(["container", "dirtyRoots", "frozen", "json", "rev"]);

    const afterEdit = applyCommand(doc, GraphEdit.addVariable(doc, 0, { id: "v1", type: 0, value: [0] }));
    expect(Object.keys(afterEdit).sort()).toEqual(["container", "dirtyRoots", "frozen", "json", "rev"]);
  });
});
