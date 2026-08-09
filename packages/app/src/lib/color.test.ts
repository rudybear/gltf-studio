import { describe, expect, it } from "vitest";
import { hexToRgb01, rgb01ToHex } from "./color.js";

describe("hexToRgb01 / rgb01ToHex (specs/ux-inspector.md UX-405)", () => {
  it("converts pure red/green/blue both ways", () => {
    expect(hexToRgb01("#ff0000")).toEqual([1, 0, 0]);
    expect(rgb01ToHex([1, 0, 0])).toBe("#ff0000");
    expect(hexToRgb01("#00ff00")).toEqual([0, 1, 0]);
    expect(hexToRgb01("#0000ff")).toEqual([0, 0, 1]);
  });

  it("round-trips an arbitrary color within one 8-bit quantization step", () => {
    const hex = "#8a2f5c";
    const rgb = hexToRgb01(hex);
    expect(rgb01ToHex(rgb)).toBe(hex);
  });

  it("falls back to white for a malformed hex string", () => {
    expect(hexToRgb01("not-a-color")).toEqual([1, 1, 1]);
  });
});
