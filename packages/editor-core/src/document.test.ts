import { describe, expect, it } from "vitest";
import { applyCommand, DocumentFrozenError, freezeDocument, unfreezeDocument } from "./document.js";
import type { Command } from "./command.js";
import { fixtureDocument, fixtureGltfJson } from "./test-fixtures.js";

function renameCommand(name: string): Command {
  return {
    id: "rename",
    label: "Rename node 0",
    patches: [{ op: "replace", path: "/nodes/0/name", value: name }],
    inverse: [{ op: "replace", path: "/nodes/0/name", value: "Alpha" }]
  };
}

describe("EditorDocument (DOC-001..004)", () => {
  it("createDocument starts at rev 0, no dirty roots, container.json === json, not frozen", () => {
    const doc = fixtureDocument();
    expect(doc.rev).toBe(0);
    expect(doc.dirtyRoots.size).toBe(0);
    expect(doc.frozen).toBe(false);
    expect(doc.json).toBe(doc.container.json);
  });

  it("DOC-004: dirtyRoots is the set of canonical splice roots changed since the last save", () => {
    const doc = fixtureDocument();
    expect(doc.dirtyRoots).toEqual(new Set());
    const after = applyCommand(doc, renameCommand("Zed"));
    expect(after.dirtyRoots).toEqual(new Set(["/nodes/0"]));
  });

  it("DOC-001: container is not mutated by applyCommand", () => {
    const doc = fixtureDocument();
    const pristineJsonBefore = doc.container.json;
    applyCommand(doc, renameCommand("Zed"));
    expect(doc.container.json).toBe(pristineJsonBefore);
    expect((doc.container.json as { nodes: Array<{ name: string }> }).nodes[0].name).toBe("Alpha");
  });
});

describe("applyCommand purity and structural sharing (DOC-005, DOC-006)", () => {
  it("does not mutate document or document.json, and is repeatable", () => {
    const doc = fixtureDocument();
    const beforeJson = doc.json;
    const result1 = applyCommand(doc, renameCommand("Zed"));
    expect(doc.json).toBe(beforeJson); // input document object untouched
    expect((doc.json as { nodes: Array<{ name: string }> }).nodes[0].name).toBe("Alpha");

    const result2 = applyCommand(doc, renameCommand("Zed"));
    expect(result1.json).toEqual(result2.json);
    expect(result1.rev).toBe(result2.rev);
  });

  it("keeps every subtree not addressed by the command's patches at exact identity", () => {
    const doc = fixtureDocument();
    const before = doc.json as Record<string, unknown>;
    const after = applyCommand(doc, renameCommand("Zed")).json as Record<string, unknown>;

    expect(after.materials).toBe(before.materials);
    expect(after.extensions).toBe(before.extensions);
    expect(after.scenes).toBe(before.scenes);
  });
});

describe("dirty-root tracking (DOC-023)", () => {
  it("adds the canonical splice root of every applied patch", () => {
    const doc = fixtureDocument();
    const command: Command = {
      id: "c1",
      label: "multi",
      patches: [
        { op: "replace", path: "/nodes/0/name", value: "Zed" },
        { op: "replace", path: "/extensions/KHR_interactivity/graphs/0/nodes/0/declaration", value: 1 }
      ],
      inverse: []
    };
    const after = applyCommand(doc, command);
    expect([...after.dirtyRoots].sort()).toEqual(["/extensions/KHR_interactivity/graphs/0", "/nodes/0"]);
  });

  it("does not mutate the input document's dirtyRoots set", () => {
    const doc = fixtureDocument();
    const after = applyCommand(doc, renameCommand("Zed"));
    expect(doc.dirtyRoots.size).toBe(0);
    expect(after.dirtyRoots.size).toBe(1);
    expect(after.dirtyRoots).not.toBe(doc.dirtyRoots);
  });
});

describe("frozen document (DOC-031, DOC-037)", () => {
  it("applyCommand throws DocumentFrozenError against a frozen document", () => {
    const doc = freezeDocument(fixtureDocument());
    expect(() => applyCommand(doc, renameCommand("Zed"))).toThrow(DocumentFrozenError);
  });

  it("unfreezeDocument allows applyCommand to succeed again", () => {
    const doc = unfreezeDocument(freezeDocument(fixtureDocument()));
    expect(() => applyCommand(doc, renameCommand("Zed"))).not.toThrow();
  });

  it("freeze/unfreeze are pure (return new values, do not mutate input)", () => {
    const doc = fixtureDocument();
    const frozen = freezeDocument(doc);
    expect(doc.frozen).toBe(false);
    expect(frozen.frozen).toBe(true);
    expect(frozen).not.toBe(doc);
  });
});

describe("rev bump semantics (DOC-003, DOC-035)", () => {
  it("every successful applyCommand bumps rev by exactly one", () => {
    const doc = fixtureDocument();
    const r1 = applyCommand(doc, renameCommand("Zed"));
    const r2 = applyCommand(r1, renameCommand("Zed2"));
    expect(r1.rev).toBe(doc.rev + 1);
    expect(r2.rev).toBe(r1.rev + 1);
  });
});

describe("fixture sanity", () => {
  it("fixtureGltfJson round-trips through the container machinery unchanged", () => {
    const doc = fixtureDocument();
    expect(doc.json).toEqual(fixtureGltfJson());
  });
});
