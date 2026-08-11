import { describe, expect, it } from "vitest";
import { fixupReferences } from "./fixup-references.js";

/** @spec DOC-021 */
describe("fixupReferences", () => {
  /** @spec DOC-019 */
  it("graphNodeRef: shifts refs above the removed index down by one; leaves refs below or equal to it untouched", () => {
    // Remove index 1. Node 4 (the holder) references: 0 (below -> untouched),
    // 1 (the removed node itself -> dangling, untouched), 2 and 3 (above -> shift to 1 and 2).
    const json = {
      extensions: {
        KHR_interactivity: {
          graphs: [
            {
              nodes: [
                { declaration: 0 }, // 0: below the removed index
                { declaration: 0 }, // 1: removed
                { declaration: 0 }, // 2: shifts to 1
                { declaration: 0 }, // 3: shifts to 2
                {
                  declaration: 1,
                  values: {
                    refBelow: { node: 0 },
                    refDangling: { node: 1 },
                    refAbove1: { node: 2 },
                    refAbove2: { node: 3 }
                  }
                } // 4: the holder — itself shifts to 3, but that's the remove op's job, not fixupReferences'
              ]
            }
          ]
        }
      }
    };

    const { patches, inverse } = fixupReferences(json, 1, [
      { kind: "graphNodeRef", graphPath: ["extensions", "KHR_interactivity", "graphs", 0] }
    ]);

    // Paths address the holder by its PRE-removal index (4) — see fixupReferences'
    // "ORDERING REQUIREMENT" doc comment: these patches must run before the remove op.
    expect(patches).toEqual(
      expect.arrayContaining([
        { op: "replace", path: "/extensions/KHR_interactivity/graphs/0/nodes/4/values/refAbove1/node", value: 1 },
        { op: "replace", path: "/extensions/KHR_interactivity/graphs/0/nodes/4/values/refAbove2/node", value: 2 }
      ])
    );
    expect(patches).toHaveLength(2); // refBelow and refDangling produce no patch at all.

    expect(inverse).toEqual(
      expect.arrayContaining([
        { op: "replace", path: "/extensions/KHR_interactivity/graphs/0/nodes/4/values/refAbove1/node", value: 2 },
        { op: "replace", path: "/extensions/KHR_interactivity/graphs/0/nodes/4/values/refAbove2/node", value: 3 }
      ])
    );
  });

  /** @spec DOC-020 */
  it("jsonPointerLiteral: rewrites embedded array-index references inside string leaves anywhere in the document", () => {
    const json = {
      extensions: {
        KHR_interactivity: {
          graphs: [
            {
              nodes: [
                {
                  declaration: 0,
                  configuration: { pointer: { value: ["/nodes/5/translation"] } }
                },
                {
                  declaration: 0,
                  configuration: { pointer: { value: ["/nodes/1/translation"] } } // below removed index, untouched
                }
              ]
            }
          ]
        }
      }
    };

    const { patches, inverse } = fixupReferences(json, 2, [{ kind: "jsonPointerLiteral", arrayName: "nodes" }]);

    expect(patches).toEqual([
      {
        op: "replace",
        path: "/extensions/KHR_interactivity/graphs/0/nodes/0/configuration/pointer/value/0",
        value: "/nodes/4/translation"
      }
    ]);
    expect(inverse).toEqual([
      {
        op: "replace",
        path: "/extensions/KHR_interactivity/graphs/0/nodes/0/configuration/pointer/value/0",
        value: "/nodes/5/translation"
      }
    ]);
  });

  it("treats a multi-digit index as one whole number, not a matching digit prefix (digit-boundary safe)", () => {
    // "/nodes/1abc" is not a valid pointer-index boundary at all (no match); "/nodes/25"
    // must be read as the whole number 25, not misread as a "1"/"2" prefix match.
    const json = { note: "/nodes/1abc stays; /nodes/25/x shifts" };
    const { patches } = fixupReferences(json, 20, [{ kind: "jsonPointerLiteral", arrayName: "nodes" }]);
    expect(patches).toEqual([{ op: "replace", path: "/note", value: "/nodes/1abc stays; /nodes/24/x shifts" }]);
  });

  /** @spec DOC-048 */
  describe("graphConfigLiteral", () => {
    it("shifts a literal configuration[field].value[0] above the removed index; leaves it untouched below, dangling-equal, or at the -1 sentinel", () => {
      const json = {
        extensions: {
          KHR_interactivity: {
            graphs: [
              {
                nodes: [
                  { declaration: 0, configuration: { nodeIndex: { value: [0] } } }, // below -> untouched
                  { declaration: 0, configuration: { nodeIndex: { value: [1] } } }, // dangling (equal) -> untouched
                  { declaration: 0, configuration: { nodeIndex: { value: [4] } } }, // above -> shifts to 3
                  { declaration: 0, configuration: { nodeIndex: { value: [-1] } } }, // sentinel -> untouched
                  { declaration: 1 } // no configuration.nodeIndex at all -> silently skipped
                ]
              }
            ]
          }
        }
      };
      const { patches, inverse } = fixupReferences(json, 1, [
        { kind: "graphConfigLiteral", graphPath: ["extensions", "KHR_interactivity", "graphs", 0], field: "nodeIndex" }
      ]);
      expect(patches).toEqual([
        { op: "replace", path: "/extensions/KHR_interactivity/graphs/0/nodes/2/configuration/nodeIndex/value/0", value: 3 }
      ]);
      expect(inverse).toEqual([
        { op: "replace", path: "/extensions/KHR_interactivity/graphs/0/nodes/2/configuration/nodeIndex/value/0", value: 4 }
      ]);
    });
  });

  /** @spec DOC-048 */
  describe("indexArray", () => {
    it("raw-number array (nodeFieldPath omitted): drops an entry equal to the removed index, shifts entries above it, leaves entries below untouched", () => {
      const json = { nodes: [{ children: [0, 1, 2, 3] }] };
      const { patches, inverse } = fixupReferences(json, 1, [{ kind: "indexArray", path: ["nodes", 0, "children"] }]);
      expect(patches).toEqual([{ op: "replace", path: "/nodes/0/children", value: [0, 1, 2] }]);
      expect(inverse).toEqual([{ op: "replace", path: "/nodes/0/children", value: [0, 1, 2, 3] }]);
    });

    it("removes the whole property when every entry is dropped or the array was already empty-after-filtering", () => {
      const json = { nodes: [{ children: [3] }] };
      const { patches, inverse } = fixupReferences(json, 3, [{ kind: "indexArray", path: ["nodes", 0, "children"] }]);
      expect(patches).toEqual([{ op: "remove", path: "/nodes/0/children" }]);
      expect(inverse).toEqual([{ op: "add", path: "/nodes/0/children", value: [3] }]);
    });

    it("emits no patch at all when nothing in the array is affected", () => {
      const json = { nodes: [{ children: [0, 1] }] };
      const { patches, inverse } = fixupReferences(json, 5, [{ kind: "indexArray", path: ["nodes", 0, "children"] }]);
      expect(patches).toEqual([]);
      expect(inverse).toEqual([]);
    });

    it("object array with nodeFieldPath: drops the whole element when its nested field matches, shifts it (preserving sibling fields) when above", () => {
      const json = {
        animations: [
          {
            channels: [
              { sampler: 0, target: { node: 0, path: "translation" } },
              { sampler: 1, target: { node: 1, path: "rotation" } },
              { sampler: 2, target: { node: 2, path: "scale" } }
            ]
          }
        ]
      };
      const { patches, inverse } = fixupReferences(json, 1, [
        { kind: "indexArray", path: ["animations", 0, "channels"], nodeFieldPath: ["target", "node"] }
      ]);
      expect(patches).toEqual([
        {
          op: "replace",
          path: "/animations/0/channels",
          value: [
            { sampler: 0, target: { node: 0, path: "translation" } },
            { sampler: 2, target: { node: 1, path: "scale" } }
          ]
        }
      ]);
      expect(inverse).toEqual([{ op: "replace", path: "/animations/0/channels", value: json.animations[0].channels }]);
    });
  });

  /** @spec DOC-048 */
  describe("indexScalar", () => {
    it("shifts a scalar field above the removed index", () => {
      const json = { skins: [{ skeleton: 4 }] };
      const { patches, inverse } = fixupReferences(json, 1, [{ kind: "indexScalar", path: ["skins", 0, "skeleton"] }]);
      expect(patches).toEqual([{ op: "replace", path: "/skins/0/skeleton", value: 3 }]);
      expect(inverse).toEqual([{ op: "replace", path: "/skins/0/skeleton", value: 4 }]);
    });

    it("removes the property entirely when it equals the removed index exactly (drop-on-match, not left dangling)", () => {
      const json = { skins: [{ skeleton: 1 }] };
      const { patches, inverse } = fixupReferences(json, 1, [{ kind: "indexScalar", path: ["skins", 0, "skeleton"] }]);
      expect(patches).toEqual([{ op: "remove", path: "/skins/0/skeleton" }]);
      expect(inverse).toEqual([{ op: "add", path: "/skins/0/skeleton", value: 1 }]);
    });

    it("leaves a value below the removed index untouched", () => {
      const json = { skins: [{ skeleton: 0 }] };
      const { patches } = fixupReferences(json, 1, [{ kind: "indexScalar", path: ["skins", 0, "skeleton"] }]);
      expect(patches).toEqual([]);
    });
  });
});
