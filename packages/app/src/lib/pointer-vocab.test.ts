import { describe, expect, it } from "vitest";
import {
  buildPointerContentTree,
  colorKindForPointerPath,
  lightPropPath,
  lightPropsFor,
  materialPropPath,
  nodePropPath,
  nodePropsFor,
  parsePointerPath
} from "./pointer-vocab";
import type { GltfJsonShape } from "./gltf-scene";

const JSON_FIXTURE: GltfJsonShape = {
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: "Root", children: [1] },
    { name: "Morphy", mesh: 0 }
  ],
  meshes: [{ name: "MorphMesh", primitives: [{ attributes: {}, targets: [{}, {}, {}] }] }],
  materials: [{ name: "Mat0", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
  extensions: { KHR_lights_punctual: { lights: [{ name: "Lamp", type: "point", color: [1, 1, 1], intensity: 500 }] } },
  animations: [{ name: "Idle" }]
};

describe("nodePropsFor (UX-903)", () => {
  it("returns the TRS family for a node without a morph-targeted mesh", () => {
    const props = nodePropsFor(0, JSON_FIXTURE);
    expect(props.map((p) => p.key)).toEqual(["translation", "rotation", "scale"]);
  });

  it("appends a weights row (comps = target count) when the mesh declares morph targets", () => {
    const props = nodePropsFor(1, JSON_FIXTURE);
    const weights = props.find((p) => p.key === "weights");
    expect(weights).toBeDefined();
    expect(weights!.comps).toBe(3);
    expect(weights!.wholeSelectable).toBe(true); // 3 components <= 4 still has a real KHR_interactivity signature (float3)
  });

  it("marks a weights row with >4 components as NOT whole-selectable (no KHR_interactivity signature that wide)", () => {
    const wide: GltfJsonShape = {
      ...JSON_FIXTURE,
      meshes: [{ name: "Wide", primitives: [{ attributes: {}, targets: [{}, {}, {}, {}, {}] }] }]
    };
    const props = nodePropsFor(1, wide);
    const weights = props.find((p) => p.key === "weights")!;
    expect(weights.comps).toBe(5);
    expect(weights.wholeSelectable).toBe(false);
  });
});

describe("path builders", () => {
  it("nodePropPath appends a component index only when given one", () => {
    expect(nodePropPath(2, "translation")).toBe("/nodes/2/translation");
    expect(nodePropPath(2, "translation", 1)).toBe("/nodes/2/translation/1");
  });

  it("materialPropPath routes pbrMetallicRoughness-family keys under that sub-object, others directly under the material", () => {
    expect(materialPropPath(0, "metallicFactor")).toBe("/materials/0/pbrMetallicRoughness/metallicFactor");
    expect(materialPropPath(0, "baseColorFactor", 2)).toBe("/materials/0/pbrMetallicRoughness/baseColorFactor/2");
    expect(materialPropPath(0, "emissiveFactor")).toBe("/materials/0/emissiveFactor");
    expect(materialPropPath(0, "alphaCutoff")).toBe("/materials/0/alphaCutoff");
  });

  it("lightPropPath addresses the root KHR_lights_punctual registry by light index", () => {
    expect(lightPropPath(0, "intensity")).toBe("/extensions/KHR_lights_punctual/lights/0/intensity");
    expect(lightPropPath(1, "spot/outerConeAngle")).toBe("/extensions/KHR_lights_punctual/lights/1/spot/outerConeAngle");
  });
});

describe("lightPropsFor (UX-909): gated by the light's CURRENT type, mirroring LightSection.tsx", () => {
  it("a point light exposes color/intensity/range but not spot cone angles", () => {
    const keys = lightPropsFor(0, JSON_FIXTURE).map((p) => p.key);
    expect(keys).toEqual(["color", "intensity", "range"]);
  });

  it("a spot light exposes all five props including both cone angles", () => {
    const spotDoc: GltfJsonShape = { ...JSON_FIXTURE, extensions: { KHR_lights_punctual: { lights: [{ type: "spot" }] } } };
    const keys = lightPropsFor(0, spotDoc).map((p) => p.key);
    expect(keys).toEqual(["color", "intensity", "range", "spot/innerConeAngle", "spot/outerConeAngle"]);
  });

  it("a directional light exposes only color/intensity (no range, no cone angles)", () => {
    const dirDoc: GltfJsonShape = { ...JSON_FIXTURE, extensions: { KHR_lights_punctual: { lights: [{ type: "directional" }] } } };
    const keys = lightPropsFor(0, dirDoc).map((p) => p.key);
    expect(keys).toEqual(["color", "intensity"]);
  });
});

describe("buildPointerContentTree (UX-901 r2, full punctual-light control)", () => {
  it("orders sections Nodes / Materials / Lights / Animations, in that order", () => {
    const rows = buildPointerContentTree(JSON_FIXTURE, [
      { nodeIndex: 0, name: "Root", depth: 0, icon: "group" },
      { nodeIndex: 1, name: "Morphy", depth: 1, icon: "mesh" }
    ]);
    expect(rows.map((r) => r.section)).toEqual(["nodes", "nodes", "materials", "lights", "animations"]);
    expect(rows.map((r) => r.label)).toEqual(["Root", "Morphy", "Mat0", "Lamp", "Idle"]);
  });

  it("labels an unnamed light by index, like materials/animations do", () => {
    const unnamed: GltfJsonShape = { ...JSON_FIXTURE, extensions: { KHR_lights_punctual: { lights: [{ type: "point" }] } } };
    const rows = buildPointerContentTree(unnamed, []);
    const lightRow = rows.find((r) => r.section === "lights")!;
    expect(lightRow.label).toBe("Light 0");
    expect(lightRow.icon).toBe("light");
  });
});

describe("parsePointerPath (UX-907 preselection)", () => {
  it("parses a whole-vector node property path", () => {
    expect(parsePointerPath("/nodes/0/translation", JSON_FIXTURE)).toEqual({
      section: "nodes",
      index: 0,
      propKey: "translation",
      compIndex: undefined,
      type: "float3"
    });
  });

  it("parses a per-component node property path as a float", () => {
    expect(parsePointerPath("/nodes/0/rotation/2", JSON_FIXTURE)).toEqual({
      section: "nodes",
      index: 0,
      propKey: "rotation",
      compIndex: 2,
      type: "float"
    });
  });

  it("parses a pbrMetallicRoughness material property path", () => {
    expect(parsePointerPath("/materials/0/pbrMetallicRoughness/roughnessFactor", JSON_FIXTURE)).toEqual({
      section: "materials",
      index: 0,
      propKey: "roughnessFactor",
      compIndex: undefined,
      type: "float"
    });
  });

  it("parses an emissiveFactor/alphaCutoff material property path", () => {
    expect(parsePointerPath("/materials/0/emissiveFactor/1", JSON_FIXTURE)).toEqual({
      section: "materials",
      index: 0,
      propKey: "emissiveFactor",
      compIndex: 1,
      type: "float"
    });
  });

  it("parses a light intensity property path", () => {
    expect(parsePointerPath("/extensions/KHR_lights_punctual/lights/0/intensity", JSON_FIXTURE)).toEqual({
      section: "lights",
      index: 0,
      propKey: "intensity",
      compIndex: undefined,
      type: "float"
    });
  });

  it("parses a light color property path as a whole float3", () => {
    expect(parsePointerPath("/extensions/KHR_lights_punctual/lights/0/color", JSON_FIXTURE)).toEqual({
      section: "lights",
      index: 0,
      propKey: "color",
      compIndex: undefined,
      type: "float3"
    });
  });

  it("parses a per-component light color property path as a float", () => {
    expect(parsePointerPath("/extensions/KHR_lights_punctual/lights/0/color/1", JSON_FIXTURE)).toEqual({
      section: "lights",
      index: 0,
      propKey: "color",
      compIndex: 1,
      type: "float"
    });
  });

  it("parses a nested spot cone-angle light property path", () => {
    expect(parsePointerPath("/extensions/KHR_lights_punctual/lights/2/spot/outerConeAngle", JSON_FIXTURE)).toEqual({
      section: "lights",
      index: 2,
      propKey: "spot/outerConeAngle",
      compIndex: undefined,
      type: "float"
    });
  });

  it("returns null for an unrecognized path (never guesses)", () => {
    expect(parsePointerPath("/extensions/KHR_interactivity/asset/majorVersion", JSON_FIXTURE)).toBeNull();
    expect(parsePointerPath("/nodes/0/name", JSON_FIXTURE)).toBeNull();
    expect(parsePointerPath("/extensions/KHR_lights_punctual/lights/0/type", JSON_FIXTURE)).toBeNull(); // type isn't a LIGHT_PROPS entry.
  });
});

describe("colorKindForPointerPath", () => {
  it("detects baseColorFactor as RGBA", () => {
    expect(colorKindForPointerPath("/materials/0/pbrMetallicRoughness/baseColorFactor")).toBe("rgba");
  });

  it("detects emissiveFactor as RGB", () => {
    expect(colorKindForPointerPath("/materials/2/emissiveFactor")).toBe("rgb");
  });

  it("detects a KHR_lights_punctual light color as RGB", () => {
    expect(colorKindForPointerPath("/extensions/KHR_lights_punctual/lights/1/color")).toBe("rgb");
  });

  it("returns undefined for a non-color vector/scalar path (translation, scale, metallicFactor)", () => {
    expect(colorKindForPointerPath("/nodes/0/translation")).toBeUndefined();
    expect(colorKindForPointerPath("/nodes/0/scale")).toBeUndefined();
    expect(colorKindForPointerPath("/materials/0/pbrMetallicRoughness/metallicFactor")).toBeUndefined();
  });

  it("matches by suffix regardless of index digits", () => {
    expect(colorKindForPointerPath("/materials/17/pbrMetallicRoughness/baseColorFactor")).toBe("rgba");
  });
});
