// UX-608/610/615/618/619 coverage for the palette/param-field catalog:
// defaultParamsFor's optional-field exclusion, isParamFieldVisible's showIf
// gating, and the new fan-port/curve/periodic-wave/compressor fields this
// PR adds.
import { describe, expect, it } from "vitest";
import { AUDIO_NODE_REGISTRY, audioNodeSpec, defaultParamsFor, isParamFieldVisible } from "./audio-node-registry.js";

describe("audio-node-registry: every kind string is unique", () => {
  it("has no duplicate kind entries", () => {
    const kinds = AUDIO_NODE_REGISTRY.map((spec) => spec.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe("defaultParamsFor", () => {
  it("includes every non-optional field's default", () => {
    const params = defaultParamsFor("gain");
    expect(params).toEqual({ gain: 1.0, interpolation: "linear", duration: 0 });
  });

  it("excludes optional fields (curve/periodic-wave) from a freshly-created node's params (UX-618)", () => {
    expect(defaultParamsFor("gain")).not.toHaveProperty("curve");
    expect(defaultParamsFor("oscillator")).not.toHaveProperty("periodicWave");
    expect(defaultParamsFor("waveshaper")).not.toHaveProperty("curve");
  });

  it("returns {} for an unregistered kind", () => {
    expect(defaultParamsFor("not-a-real-kind")).toEqual({});
  });
});

describe("UX-615: splitter numberOfOutputs / channelmerger numberOfInputs fan-port params", () => {
  it("splitter has a numberOfOutputs integer field", () => {
    const spec = audioNodeSpec("splitter")!;
    const field = spec.params.find((f) => f.key === "numberOfOutputs");
    expect(field).toBeDefined();
    expect(field!.type).toBe("integer");
    expect(field!.default).toBe(2);
  });

  it("channelmerger has a numberOfInputs integer field", () => {
    const spec = audioNodeSpec("channelmerger")!;
    const field = spec.params.find((f) => f.key === "numberOfInputs");
    expect(field).toBeDefined();
    expect(field!.type).toBe("integer");
    expect(field!.default).toBe(2);
  });
});

describe("UX-619: compressor is a registered, authorable node kind (gap-analysis G1, resolved-in-schema)", () => {
  it("is in the Dynamics & Shaping category with the ratified schema's 5 params", () => {
    const spec = audioNodeSpec("compressor");
    expect(spec).toBeDefined();
    expect(spec!.category).toBe("Dynamics & Shaping");
    const keys = spec!.params.map((f) => f.key).sort();
    expect(keys).toEqual(["attack", "knee", "ratio", "release", "threshold"]);
  });
});

describe("isParamFieldVisible (UX-618)", () => {
  it("a field with no showIf is always visible", () => {
    const spec = audioNodeSpec("gain")!;
    const gainField = spec.params.find((f) => f.key === "gain")!;
    expect(isParamFieldVisible(spec, gainField, {})).toBe(true);
  });

  it("gain's curve field is hidden until interpolation is 'custom'", () => {
    const spec = audioNodeSpec("gain")!;
    const curveField = spec.params.find((f) => f.key === "curve")!;
    expect(isParamFieldVisible(spec, curveField, {})).toBe(false); // falls back to interpolation's own default "linear"
    expect(isParamFieldVisible(spec, curveField, { interpolation: "linear" })).toBe(false);
    expect(isParamFieldVisible(spec, curveField, { interpolation: "custom" })).toBe(true);
  });

  it("oscillator's periodicWave field is hidden until type is 'custom'", () => {
    const spec = audioNodeSpec("oscillator")!;
    const field = spec.params.find((f) => f.key === "periodicWave")!;
    expect(isParamFieldVisible(spec, field, { type: "sine" })).toBe(false);
    expect(isParamFieldVisible(spec, field, { type: "custom" })).toBe(true);
  });

  it("waveshaper's curve field has no showIf — always visible (fully runtime-supported, UX-618)", () => {
    const spec = audioNodeSpec("waveshaper")!;
    const field = spec.params.find((f) => f.key === "curve")!;
    expect(field.showIf).toBeUndefined();
    expect(isParamFieldVisible(spec, field, {})).toBe(true);
  });
});
