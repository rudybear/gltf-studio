import { describe, expect, it } from "vitest";
import { otherNodesUsingMesh, primitiveModeLabel, triangleCount, uniqueMaterialIndices } from "./mesh-info.js";
import type { GltfJsonShape, GltfMeshJson } from "./gltf-scene.js";

describe("primitiveModeLabel (specs/ux-inspector.md UX-408)", () => {
  it("defaults to TRIANGLES (glTF mode 4) when mode is omitted", () => {
    expect(primitiveModeLabel(undefined)).toBe("TRIANGLES");
  });
  it("labels every named glTF primitive mode", () => {
    expect(primitiveModeLabel(0)).toBe("POINTS");
    expect(primitiveModeLabel(1)).toBe("LINES");
    expect(primitiveModeLabel(5)).toBe("TRIANGLE_STRIP");
  });
});

describe("triangleCount", () => {
  it("derives triangle count from the indices accessor's count", () => {
    const prim = { attributes: {}, indices: 0 };
    expect(triangleCount(prim, [{ type: "SCALAR", componentType: 5123, count: 9 }])).toBe(3);
  });
  it("is undefined for a non-indexed primitive", () => {
    expect(triangleCount({ attributes: {} }, [])).toBeUndefined();
  });
});

describe("otherNodesUsingMesh (UX-410)", () => {
  it("lists every OTHER node sharing the mesh, excluding the current one", () => {
    const json: GltfJsonShape = {
      nodes: [{ name: "A", mesh: 0 }, { name: "B", mesh: 0 }, { name: "C", mesh: 1 }]
    };
    expect(otherNodesUsingMesh(json, 0, 0)).toEqual(["B"]);
    expect(otherNodesUsingMesh(json, 0, 1)).toEqual(["A"]);
    expect(otherNodesUsingMesh(json, 1, 2)).toEqual([]);
  });
});

describe("uniqueMaterialIndices", () => {
  it("dedupes materials shared across primitives, preserving first-appearance order", () => {
    const mesh: GltfMeshJson = {
      primitives: [{ attributes: {}, material: 2 }, { attributes: {}, material: 0 }, { attributes: {}, material: 2 }]
    };
    expect(uniqueMaterialIndices(mesh)).toEqual([2, 0]);
  });
  it("skips primitives with no material", () => {
    const mesh: GltfMeshJson = { primitives: [{ attributes: {} }] };
    expect(uniqueMaterialIndices(mesh)).toEqual([]);
  });
});
