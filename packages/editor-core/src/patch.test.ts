import { describe, expect, it } from "vitest";
import { applyPatches } from "./patch.js";
import { deepEqualJson } from "./json-pointer.js";

describe("applyPatches", () => {
  it("applies add/replace/remove without mutating the input (DOC-002, DOC-005)", () => {
    const original = { nodes: [{ name: "A" }, { name: "B" }] };
    const snapshot = JSON.parse(JSON.stringify(original));

    const result = applyPatches(original, [
      { op: "replace", path: "/nodes/0/name", value: "A2" },
      { op: "add", path: "/nodes/2", value: { name: "C" } },
      { op: "remove", path: "/nodes/1" }
    ]);

    expect(deepEqualJson(original, snapshot)).toBe(true); // input untouched
    expect(result).toEqual({ nodes: [{ name: "A2" }, { name: "C" }] });
  });

  it("is pure: identical inputs produce deep-equal outputs on repeat calls (DOC-005)", () => {
    const json = { a: 1, b: { c: [1, 2, 3] } };
    const ops = [{ op: "replace" as const, path: "/b/c/1", value: 99 }];
    const r1 = applyPatches(json, ops);
    const r2 = applyPatches(json, ops);
    expect(deepEqualJson(r1, r2)).toBe(true);
    expect(r1).not.toBe(r2); // distinct objects, but...
    expect(deepEqualJson(json, { a: 1, b: { c: [1, 2, 3] } })).toBe(true); // ...original still unchanged
  });

  it("keeps untouched subtrees at exact object identity (structural sharing, DOC-006)", () => {
    const untouchedMaterial = { name: "keep-me" };
    const original = {
      nodes: [{ name: "A" }, { name: "B" }],
      materials: [untouchedMaterial],
      scenes: [{ nodes: [0, 1] }]
    };
    const result = applyPatches(original, [{ op: "replace", path: "/nodes/0/name", value: "A2" }]) as typeof original;

    expect(result.materials).toBe(original.materials); // sibling top-level array untouched
    expect(result.materials[0]).toBe(untouchedMaterial);
    expect(result.scenes).toBe(original.scenes);
    expect(result.nodes[1]).toBe(original.nodes[1]); // untouched array element
    expect(result.nodes).not.toBe(original.nodes); // spine to the touched element is cloned
    expect(result.nodes[0]).not.toBe(original.nodes[0]);
  });

  it("supports move, copy, and test ops", () => {
    const original = { a: { x: 1 }, list: [1, 2, 3] };
    const moved = applyPatches(original, [{ op: "move", from: "/a", path: "/b" }]);
    expect(moved).toEqual({ list: [1, 2, 3], b: { x: 1 } });

    const copied = applyPatches(original, [{ op: "copy", from: "/a", path: "/c" }]);
    expect(copied).toEqual({ a: { x: 1 }, c: { x: 1 }, list: [1, 2, 3] });

    expect(() => applyPatches(original, [{ op: "test", path: "/a/x", value: 1 }])).not.toThrow();
    expect(() => applyPatches(original, [{ op: "test", path: "/a/x", value: 2 }])).toThrow();
  });

  it("array add shifts subsequent elements up; array remove shifts them down", () => {
    const original = { arr: ["a", "b", "c"] };
    expect(applyPatches(original, [{ op: "add", path: "/arr/1", value: "x" }])).toEqual({ arr: ["a", "x", "b", "c"] });
    expect(applyPatches(original, [{ op: "remove", path: "/arr/1" }])).toEqual({ arr: ["a", "c"] });
  });
});
