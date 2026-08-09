import { locateJsonSpan } from "@gltfi/gltf";
import { describe, expect, it } from "vitest";
import type { Command } from "./command.js";
import { applyCommand } from "./document.js";
import { GraphEdit } from "./graph-edit.js";
import { deepEqualJson, typedPathFromPointer } from "./json-pointer.js";
import { save } from "./save.js";
import { SceneEdit } from "./scene-edit.js";
import { fixtureDocument } from "./test-fixtures.js";

/** Asserts every byte OUTSIDE `pointer`'s span, in the pristine text, is byte-identical to the corresponding span in the new text (DOC-026). */
function expectByteIdenticalOutsideRoot(originalText: string, newText: string, pointer: string, referenceJson: unknown) {
  const typedPath = typedPathFromPointer(pointer, referenceJson)!;
  const span = locateJsonSpan(originalText, typedPath)!;
  const prefix = originalText.slice(0, span.start);
  const suffix = originalText.slice(span.end);
  expect(newText.startsWith(prefix)).toBe(true);
  expect(newText.endsWith(suffix)).toBe(true);
}

describe("save (DOC-024, DOC-026): per-root splice path", () => {
  it("splices one dirty root, reports it, and leaves everything outside its span byte-identical", () => {
    const doc = fixtureDocument();
    const edited = applyCommand(doc, SceneEdit.setName(doc, 0, "Renamed"));
    const { document: saved, report } = save(edited);

    expect(report.reserialized).toBe(false);
    expect(report.splicedRoots).toEqual(["/nodes/0"]);
    expect(saved.dirtyRoots.size).toBe(0);
    expect(saved.json).toEqual(edited.json); // authored content unchanged by saving

    expectByteIdenticalOutsideRoot(doc.container.jsonText, saved.container.jsonText, "/nodes/0", doc.json);
    expect((saved.container.json as { nodes: Array<{ name: string }> }).nodes[0].name).toBe("Renamed");
  });

  it("splices multiple independent dirty roots in one save", () => {
    const doc = fixtureDocument();
    let edited = applyCommand(doc, SceneEdit.setName(doc, 0, "Renamed"));
    edited = applyCommand(edited, SceneEdit.setMaterialProperty(edited, 0, ["name"], "NewMat"));
    const { report, document: saved } = save(edited);

    expect(report.reserialized).toBe(false);
    expect([...report.splicedRoots].sort()).toEqual(["/materials/0", "/nodes/0"]);
    expect(deepEqualJson(saved.container.json, edited.json)).toBe(true);
  });

  it("a no-op save (nothing dirty) reproduces the pristine bytes and reports no splice/reserialize", () => {
    const doc = fixtureDocument();
    const { report, document: saved } = save(doc);
    expect(report.reserialized).toBe(false);
    expect(report.splicedRoots).toEqual([]);
    expect(saved.container.jsonText).toBe(doc.container.jsonText);
  });
});

describe("save (DOC-025): whole-document reserialize fallback", () => {
  // Every implemented GraphEdit factory edits WITHIN an already-existing
  // `graphs[N]` element — and DOC-022's table makes that whole graph object
  // one splice root — so `GraphEdit.addNode`/`addVariable`/etc. never
  // actually need the fallback: the graph root itself already existed in
  // the pristine text, only its *contents* changed. The fallback is a
  // property of `save()` itself, triggered whenever a dirty root's OWN
  // array slot is new/renumbered (e.g. a brand-new `graphs[1]`, or a future
  // M8 `SceneEdit.addNode`) — exercised directly here with a hand-built
  // Command standing in for "some command that creates a new root".
  function addSecondGraphCommand(): Command {
    const path = "/extensions/KHR_interactivity/graphs/1";
    return {
      id: "test-add-graph",
      label: "add a second graph (test-only stand-in for a future root-creating command)",
      patches: [{ op: "add", path, value: { types: [], declarations: [], nodes: [] } }],
      inverse: [{ op: "remove", path }]
    };
  }

  it("falls back to reserializing the whole document when a dirty root is newly created", () => {
    const doc = fixtureDocument();
    const edited = applyCommand(doc, addSecondGraphCommand());
    expect([...edited.dirtyRoots]).toEqual(["/extensions/KHR_interactivity/graphs/1"]);

    const { report, document: saved } = save(edited);

    expect(report.reserialized).toBe(true);
    expect(report.splicedRoots).toEqual([]);
    expect(deepEqualJson(saved.container.json, edited.json)).toBe(true); // DOC-034's reparse-equality, checked directly here too
    expect(saved.dirtyRoots.size).toBe(0);
  });

  it("the returned document becomes the new pristine baseline (its container round-trips the saved bytes)", () => {
    const doc = fixtureDocument();
    const edited = applyCommand(doc, addSecondGraphCommand());
    const { document: saved } = save(edited);
    expect(deepEqualJson(saved.container.json, saved.json)).toBe(true);
  });

  it("an ordinary GraphEdit.addNode does NOT need the fallback: its graph root already exists in the pristine text", () => {
    const doc = fixtureDocument();
    const edited = applyCommand(doc, GraphEdit.addNode(doc, 0, "math/multiply"));
    const { report } = save(edited);
    expect(report.reserialized).toBe(false);
    expect(report.splicedRoots).toEqual(["/extensions/KHR_interactivity/graphs/0"]);
  });
});
