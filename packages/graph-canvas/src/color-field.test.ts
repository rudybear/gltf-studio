import { describe, expect, it } from "vitest";
import { colorKindForPointerPath, hexToRgb01, rgb01ToHex } from "./color-field.js";

describe("colorKindForPointerPath (mirrors packages/app/src/lib/pointer-vocab.ts)", () => {
  it("detects baseColorFactor as RGBA", () => {
    expect(colorKindForPointerPath("/materials/0/pbrMetallicRoughness/baseColorFactor")).toBe("rgba");
  });

  it("detects emissiveFactor as RGB", () => {
    expect(colorKindForPointerPath("/materials/3/emissiveFactor")).toBe("rgb");
  });

  it("detects a KHR_lights_punctual light color as RGB", () => {
    expect(colorKindForPointerPath("/extensions/KHR_lights_punctual/lights/0/color")).toBe("rgb");
  });

  it("returns undefined for a non-color path", () => {
    expect(colorKindForPointerPath("/nodes/0/translation")).toBeUndefined();
    expect(colorKindForPointerPath("/materials/0/pbrMetallicRoughness/metallicFactor")).toBeUndefined();
  });
});

describe("hexToRgb01 / rgb01ToHex round-trip", () => {
  it("converts a hex color to [0,1] floats and back", () => {
    expect(hexToRgb01("#ff0080")).toEqual([1, 0, 128 / 255]);
    expect(rgb01ToHex([1, 0, 128 / 255])).toBe("#ff0080");
  });

  it("falls back to white for a malformed hex string", () => {
    expect(hexToRgb01("nonsense")).toEqual([1, 1, 1]);
  });

  it("clamps out-of-range components", () => {
    expect(rgb01ToHex([2, -1, 0.5])).toBe("#ff0080");
  });
});
