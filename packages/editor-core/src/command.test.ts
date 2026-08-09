import { describe, expect, it } from "vitest";
import type { CommandLike } from "@gltf-studio/engine-api";
import { combineCommandParts, makeCommandId, type Command } from "./command.js";

/**
 * @spec DOC-007
 * @spec DOC-008
 * @spec DOC-009
 * @spec DOC-010
 */
describe("Command shape", () => {
  it("carries patches, inverse, label, and an optional coalesceKey", () => {
    const command: Command = {
      id: makeCommandId("test"),
      label: "Do a thing",
      patches: [{ op: "replace", path: "/a", value: 1 }],
      inverse: [{ op: "replace", path: "/a", value: 0 }]
    };
    expect(command.coalesceKey).toBeUndefined();
    expect(command.label).toBe("Do a thing");

    const coalescable: Command = { ...command, coalesceKey: "group-1" };
    expect(coalescable.coalesceKey).toBe("group-1");
  });

  it("every Command is structurally a valid CommandLike (OPEN(AG-commandlike-unification-tbd) resolution)", () => {
    const command: Command = {
      id: makeCommandId("test"),
      label: "Do a thing",
      patches: [],
      inverse: []
    };
    const asCommandLike: CommandLike = command; // compiles: Command extends CommandLike, coalesceKey is additive/optional
    expect(asCommandLike.id).toBe(command.id);
  });

  it("makeCommandId produces unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeCommandId("x")));
    expect(ids.size).toBe(50);
  });
});

describe("combineCommandParts", () => {
  it("concatenates patches forward and inverses in reversed part order", () => {
    const partA = { patches: [{ op: "add" as const, path: "/a", value: 1 }], inverse: [{ op: "remove" as const, path: "/a" }] };
    const partB = { patches: [{ op: "add" as const, path: "/b", value: 2 }], inverse: [{ op: "remove" as const, path: "/b" }] };
    const combined = combineCommandParts([partA, partB]);
    expect(combined.patches).toEqual([partA.patches[0], partB.patches[0]]);
    expect(combined.inverse).toEqual([partB.inverse[0], partA.inverse[0]]);
  });
});
