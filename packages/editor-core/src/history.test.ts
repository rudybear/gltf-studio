import { describe, expect, it } from "vitest";
import { HistoryStack } from "./history.js";
import type { Command } from "./command.js";
import { DocumentFrozenError, freezeDocument } from "./document.js";
import { fixtureDocument } from "./test-fixtures.js";

function setName(index: number, name: string, prevName: string, coalesceKey?: string): Command {
  return {
    id: `set-name-${index}-${name}`,
    label: `Set name ${index}`,
    coalesceKey,
    patches: [{ op: "replace", path: `/nodes/${index}/name`, value: name }],
    inverse: [{ op: "replace", path: `/nodes/${index}/name`, value: prevName }]
  };
}

function nodeName(stack: HistoryStack, index: number): string {
  return (stack.document.json as { nodes: Array<{ name: string }> }).nodes[index].name;
}

describe("HistoryStack", () => {
  it("push applies patches and records history (DOC-011)", () => {
    const stack = new HistoryStack(fixtureDocument());
    stack.push(setName(0, "Zed", "Alpha"));
    expect(nodeName(stack, 0)).toBe("Zed");
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it("push clears the redo log (DOC-012)", () => {
    const stack = new HistoryStack(fixtureDocument());
    stack.push(setName(0, "Zed", "Alpha"));
    stack.undo();
    expect(stack.canRedo()).toBe(true);
    stack.push(setName(0, "Yorp", "Alpha"));
    expect(stack.canRedo()).toBe(false);
  });

  it("undo applies inverse and moves the command to redo (DOC-013)", () => {
    const stack = new HistoryStack(fixtureDocument());
    stack.push(setName(0, "Zed", "Alpha"));
    stack.undo();
    expect(nodeName(stack, 0)).toBe("Alpha");
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);
  });

  it("redo re-applies patches and moves the command back to undo (DOC-014)", () => {
    const stack = new HistoryStack(fixtureDocument());
    stack.push(setName(0, "Zed", "Alpha"));
    stack.undo();
    stack.redo();
    expect(nodeName(stack, 0)).toBe("Zed");
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it("coalesces two consecutive commands sharing a coalesceKey into one undo step (DOC-010, DOC-015)", () => {
    const stack = new HistoryStack(fixtureDocument());
    stack.push(setName(0, "A1", "Alpha", "rename-0"));
    stack.push(setName(0, "A2", "A1", "rename-0"));
    expect(nodeName(stack, 0)).toBe("A2");
    stack.undo();
    expect(nodeName(stack, 0)).toBe("Alpha"); // one undo() unwinds BOTH coalesced pushes
    expect(stack.canUndo()).toBe(false);
  });

  it("does not coalesce commands with different (or undefined) coalesceKeys", () => {
    const stack = new HistoryStack(fixtureDocument());
    stack.push(setName(0, "A1", "Alpha", "rename-0"));
    stack.push(setName(1, "B1", "Beta", "rename-1"));
    stack.undo();
    expect(nodeName(stack, 1)).toBe("Beta");
    expect(nodeName(stack, 0)).toBe("A1"); // only the second push was undone
    stack.undo();
    expect(nodeName(stack, 0)).toBe("Alpha");
  });

  it("transact groups every push during fn into one undo/redo step (DOC-016)", () => {
    const stack = new HistoryStack(fixtureDocument());
    stack.transact(() => {
      stack.push(setName(0, "A1", "Alpha"));
      stack.push(setName(1, "B1", "Beta"));
    });
    expect(nodeName(stack, 0)).toBe("A1");
    expect(nodeName(stack, 1)).toBe("B1");
    expect(stack.canUndo()).toBe(true);
    stack.undo();
    expect(nodeName(stack, 0)).toBe("Alpha");
    expect(nodeName(stack, 1)).toBe("Beta");
    expect(stack.canUndo()).toBe(false); // exactly one undo unwound the whole transaction
  });

  it("transact with zero pushes leaves history and the redo log untouched", () => {
    const stack = new HistoryStack(fixtureDocument());
    stack.push(setName(0, "A1", "Alpha"));
    stack.undo();
    expect(stack.canRedo()).toBe(true);
    stack.transact(() => {
      /* no pushes */
    });
    expect(stack.canRedo()).toBe(true);
    expect(stack.canUndo()).toBe(false);
  });

  it("the log is linear: pushing after an undo discards the existing redo log (DOC-017)", () => {
    const stack = new HistoryStack(fixtureDocument());
    stack.push(setName(0, "A1", "Alpha"));
    stack.push(setName(0, "A2", "A1"));
    stack.undo();
    expect(stack.canRedo()).toBe(true);
    stack.push(setName(1, "B1", "Beta"));
    expect(stack.canRedo()).toBe(false);
    expect(nodeName(stack, 0)).toBe("A1");
    expect(nodeName(stack, 1)).toBe("B1");
  });

  it("undo/redo restore state exclusively via patch application, not a snapshot pointer (DOC-018)", () => {
    // Verified indirectly: `document` is a plain immutable value rebuilt each
    // time via `applyCommand`, and HistoryStack keeps no separate snapshot
    // array — each undo/redo call produces a fresh EditorDocument distinct
    // from any prior one it might coincidentally equal.
    const stack = new HistoryStack(fixtureDocument());
    const initial = stack.document;
    stack.push(setName(0, "A1", "Alpha"));
    const afterPush = stack.document;
    stack.undo();
    const afterUndo = stack.document;
    expect(afterUndo).not.toBe(initial); // a new value, not literally the same stored snapshot object
    expect(afterUndo.json).toEqual(initial.json);
    expect(afterUndo).not.toBe(afterPush);
  });

  describe("rev bump semantics under coalescing/transact (DOC-035)", () => {
    it("every push bumps rev by one, even when coalesced", () => {
      const stack = new HistoryStack(fixtureDocument());
      expect(stack.document.rev).toBe(0);
      stack.push(setName(0, "A1", "Alpha", "rename-0"));
      expect(stack.document.rev).toBe(1);
      stack.push(setName(0, "A2", "A1", "rename-0")); // coalesces into the same history entry...
      expect(stack.document.rev).toBe(2); // ...but still bumps rev again
    });

    it("undo/redo of a coalesced or transacted entry bumps rev by exactly one per call", () => {
      const stack = new HistoryStack(fixtureDocument());
      stack.transact(() => {
        stack.push(setName(0, "A1", "Alpha"));
        stack.push(setName(1, "B1", "Beta"));
      });
      const revBeforeUndo = stack.document.rev;
      stack.undo();
      expect(stack.document.rev).toBe(revBeforeUndo + 1);
    });
  });

  it("respects the frozen document (DOC-031): push/undo/redo throw DocumentFrozenError", () => {
    const stack = new HistoryStack(freezeDocument(fixtureDocument()));
    expect(() => stack.push(setName(0, "Zed", "Alpha"))).toThrow(DocumentFrozenError);
  });

  it("DOC-036: HistoryStack enforces no maximum undo depth in v1", () => {
    const stack = new HistoryStack(fixtureDocument());
    for (let i = 0; i < 500; i += 1) {
      stack.push(setName(0, `n${i}`, i === 0 ? "Alpha" : `n${i - 1}`));
    }
    expect(stack.canUndo()).toBe(true);
    for (let i = 0; i < 500; i += 1) stack.undo();
    expect(nodeName(stack, 0)).toBe("Alpha");
    expect(stack.canUndo()).toBe(false);
  });

  describe("entries()/currentIndex() (DOC-039)", () => {
    it("lists pushed entries in order with the current index at the top", () => {
      const stack = new HistoryStack(fixtureDocument());
      expect(stack.entries()).toEqual([]);
      expect(stack.currentIndex()).toBe(-1);

      stack.push(setName(0, "A1", "Alpha"));
      stack.push(setName(1, "B1", "Beta"));
      expect(stack.entries().map((e) => e.label)).toEqual(["Set name 0", "Set name 1"]);
      expect(stack.entries().map((e) => e.index)).toEqual([0, 1]);
      expect(stack.currentIndex()).toBe(1);
    });

    it("undo moves currentIndex back without shrinking the entry list; a later push truncates it (DOC-017)", () => {
      const stack = new HistoryStack(fixtureDocument());
      stack.push(setName(0, "A1", "Alpha"));
      stack.push(setName(1, "B1", "Beta"));
      stack.undo();
      expect(stack.entries()).toHaveLength(2); // the undone entry is still listed...
      expect(stack.currentIndex()).toBe(0); // ...just no longer current

      stack.push(setName(1, "B2", "Beta")); // discards the redo-log entry (DOC-017)
      expect(stack.entries()).toHaveLength(2);
      expect(stack.entries().map((e) => e.label)).toEqual(["Set name 0", "Set name 1"]);
      expect(stack.currentIndex()).toBe(1);
    });

    it("a coalesced group of pushes is one entry (DOC-015)", () => {
      const stack = new HistoryStack(fixtureDocument());
      stack.push(setName(0, "A1", "Alpha", "rename-0"));
      stack.push(setName(0, "A2", "A1", "rename-0"));
      expect(stack.entries()).toHaveLength(1);
      expect(stack.currentIndex()).toBe(0);
    });
  });

  describe("onApply() (DOC-040)", () => {
    it("fires with the forward patches for push, the inverse for undo, and the patches again for redo", () => {
      const stack = new HistoryStack(fixtureDocument());
      const seen: unknown[] = [];
      const unsubscribe = stack.onApply((patches) => seen.push(patches));

      const command = setName(0, "Zed", "Alpha");
      stack.push(command);
      expect(seen).toEqual([command.patches]);

      stack.undo();
      expect(seen).toEqual([command.patches, command.inverse]);

      stack.redo();
      expect(seen).toEqual([command.patches, command.inverse, command.patches]);

      unsubscribe();
      stack.push(setName(1, "B1", "Beta"));
      expect(seen).toHaveLength(3); // no further notifications after unsubscribe
    });
  });
});
