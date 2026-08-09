import { describe, expect, it } from "vitest";
import { coercePointerValue, isPointerValue } from "./pointer-value.js";

describe("isPointerValue", () => {
  it("accepts numbers, booleans, and homogeneous number/boolean arrays", () => {
    expect(isPointerValue(1)).toBe(true);
    expect(isPointerValue(true)).toBe(true);
    expect(isPointerValue([1, 2, 3])).toBe(true);
    expect(isPointerValue([true, false])).toBe(true);
    expect(isPointerValue([])).toBe(true); // vacuously homogeneous
  });

  it("rejects a string, an object, and a mixed array (RH-026)", () => {
    expect(isPointerValue("linear")).toBe(false);
    expect(isPointerValue({ x: 1 })).toBe(false);
    expect(isPointerValue([1, true])).toBe(false);
    expect(isPointerValue(null)).toBe(false);
    expect(isPointerValue(undefined)).toBe(false);
  });
});

describe("coercePointerValue", () => {
  it("returns supported values unchanged", () => {
    expect(coercePointerValue(1.5, "ctx")).toBe(1.5);
    expect(coercePointerValue([1, 2], "ctx")).toEqual([1, 2]);
  });

  it("throws a descriptive TypeError for an unsupported value", () => {
    expect(() => coercePointerValue("linear", "RenderHost.patchScene(/foo)")).toThrow(TypeError);
    expect(() => coercePointerValue("linear", "RenderHost.patchScene(/foo)")).toThrow(/unsupported pointer value/);
  });
});
