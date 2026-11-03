import { describe, expect, it } from "vitest";
import {
  decodeLiteralComponent,
  encodeLiteralComponent,
  formatLiteralDisplay,
  isFiniteLiteralComponent,
  literalHasNaN
} from "./literal-editors.js";
import { rgb01ToHex } from "./color-field.js";

describe("NaN literal helpers (UX-524)", () => {
  it("decodes the NaN/Infinity string spellings and passes numbers through", () => {
    expect(Number.isNaN(decodeLiteralComponent("NaN"))).toBe(true);
    expect(decodeLiteralComponent("Infinity")).toBe(Infinity);
    expect(decodeLiteralComponent("-Infinity")).toBe(-Infinity);
    expect(decodeLiteralComponent(2.5)).toBe(2.5);
    expect(decodeLiteralComponent(undefined)).toBeUndefined();
    expect(decodeLiteralComponent(true)).toBeUndefined();
  });

  it("encodes non-finite numbers back to JSON-safe strings, never null/0", () => {
    expect(encodeLiteralComponent(Number.NaN)).toBe("NaN");
    expect(encodeLiteralComponent(Infinity)).toBe("Infinity");
    expect(encodeLiteralComponent(-Infinity)).toBe("-Infinity");
    expect(encodeLiteralComponent(0)).toBe(0);
    expect(JSON.stringify([encodeLiteralComponent(Number.NaN), 1])).toBe('["NaN",1]');
  });

  it("literalHasNaN is true for omitted, short, NaN-string components and false for complete finite vectors", () => {
    expect(literalHasNaN([], 3)).toBe(true);
    expect(literalHasNaN([1, 2], 3)).toBe(true);
    expect(literalHasNaN([1, "NaN", 3], 3)).toBe(true);
    expect(literalHasNaN([1, 2, 3], 3)).toBe(false);
    expect(isFiniteLiteralComponent(0)).toBe(true);
  });

  it("formatLiteralDisplay shows NaN for omitted float literals instead of []", () => {
    expect(formatLiteralDisplay([], "float")).toBe("NaN");
    expect(formatLiteralDisplay([], "float3")).toBe("[NaN, NaN, NaN]");
    expect(formatLiteralDisplay([0.5, "NaN"], "float2")).toBe("[0.5, NaN]");
    expect(formatLiteralDisplay([0.5, 0, 0], "float3")).toBe("[0.5, 0, 0]");
    expect(formatLiteralDisplay([3], "int")).toBe("3");
    expect(formatLiteralDisplay([], "int")).toBe("[]");
  });

  it("rgb01ToHex never emits an invalid color for NaN channels", () => {
    expect(rgb01ToHex([Number.NaN, 1, Number.NaN])).toBe("#00ff00");
    expect(rgb01ToHex([Number.NaN, Number.NaN, Number.NaN])).toMatch(/^#[0-9a-f]{6}$/);
  });
});
