// UX-608/610/618/619 coverage for the palette/param-field catalog:
// defaultParamsFor's optional-field exclusion, isParamFieldVisible's showIf
// gating, and the fan-port/curve/periodic-wave/compressor fields — updated
// for spec r2 (oscillator is a KHR_audio_emitter SOURCE, never a node kind;
// splitter/channelmerger arity is DERIVED from wiring, no more authored
// numberOfOutputs/numberOfInputs — see UX-615's superseding note in
// audio-node-registry.ts's own header comment).
import { describe, expect, it } from "vitest";
import {
  AUDIO_NODE_REGISTRY,
  OSCILLATOR_SOURCE_FIELDS,
  audioNodeSpec,
  defaultOscillatorSourceParams,
  defaultParamsFor,
  isOscillatorSourceFieldVisible,
  isParamFieldVisible
} from "./audio-node-registry.js";

describe("audio-node-registry: every kind string is unique", () => {
  it("has no duplicate kind entries", () => {
    const kinds = AUDIO_NODE_REGISTRY.map((spec) => spec.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("has exactly the 16 r2 node kinds — no 'oscillator' among them", () => {
    const kinds = AUDIO_NODE_REGISTRY.map((spec) => spec.kind).sort();
    expect(kinds).not.toContain("oscillator");
    expect(kinds).toEqual(
      [
        "allpass",
        "audiomixer",
        "bandpass",
        "channelmerger",
        "channelmixer",
        "compressor",
        "delay",
        "gain",
        "highpass",
        "highshelf",
        "lowpass",
        "lowshelf",
        "notch",
        "peaking",
        "splitter",
        "waveshaper"
      ].sort()
    );
  });

  it("has no 'Generators' category any more (oscillator authoring moved to KHR_audio_emitter sources)", () => {
    const categories = new Set(AUDIO_NODE_REGISTRY.map((spec) => spec.category));
    expect(categories.has("Generators" as never)).toBe(false);
  });
});

describe("defaultParamsFor", () => {
  it("includes every non-optional field's default", () => {
    const params = defaultParamsFor("gain");
    expect(params).toEqual({ gain: 1.0, interpolation: "linear", duration: 0 });
  });

  it("excludes optional fields (curve) from a freshly-created node's params (UX-618)", () => {
    expect(defaultParamsFor("gain")).not.toHaveProperty("curve");
    expect(defaultParamsFor("waveshaper")).not.toHaveProperty("curve");
  });

  it("returns {} for an unregistered kind (including the removed 'oscillator' node kind)", () => {
    expect(defaultParamsFor("not-a-real-kind")).toEqual({});
    expect(defaultParamsFor("oscillator")).toEqual({});
  });

  it("fills a schema-required-but-default-less field with this file's own creation-time default (filter frequency, channelmixer outputChannels)", () => {
    expect(defaultParamsFor("lowpass")).toMatchObject({ frequency: 350 });
    expect(defaultParamsFor("channelmixer")).toMatchObject({ outputChannels: 2 });
  });

  it("keeps a UI-only max bound the kernel's schema-derived spec doesn't declare (regression, code review: this was silently lost when the registry was rebased onto @gltf-audiograph/kernel)", () => {
    const spec = audioNodeSpec("channelmixer")!;
    const field = spec.params.find((f) => f.key === "outputChannels")!;
    expect(field.min).toBe(1); // from the kernel's own schema-derived spec
    expect(field.max).toBe(32); // this file's own UI-only overlay (Web Audio's real channelCount ceiling)
  });
});

describe("r2: splitter/channelmerger have NO authored arity param any more", () => {
  it("splitter has no numberOfOutputs field", () => {
    const spec = audioNodeSpec("splitter")!;
    expect(spec.params.find((f) => f.key === "numberOfOutputs")).toBeUndefined();
    expect(spec.params.map((f) => f.key)).toEqual(["channelInterpretation"]);
  });

  it("channelmerger has no numberOfInputs field", () => {
    const spec = audioNodeSpec("channelmerger")!;
    expect(spec.params.find((f) => f.key === "numberOfInputs")).toBeUndefined();
    expect(spec.params.map((f) => f.key)).toEqual(["channelInterpretation"]);
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

  it("waveshaper's curve field has no showIf — always visible (fully runtime-supported, UX-618)", () => {
    const spec = audioNodeSpec("waveshaper")!;
    const field = spec.params.find((f) => f.key === "curve")!;
    expect(field.showIf).toBeUndefined();
    expect(isParamFieldVisible(spec, field, {})).toBe(true);
  });
});

describe("r2: OSCILLATOR_SOURCE_FIELDS (KHR_audio_emitter source oscillator payload, specs/ux-inspector.md UX-420)", () => {
  it("has exactly the oscillator source's 5 fields", () => {
    const keys = OSCILLATOR_SOURCE_FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual(["detune", "frequency", "periodicWave", "pulseWidth", "type"]);
  });

  it("defaultOscillatorSourceParams fills type/frequency/detune/pulseWidth but excludes optional periodicWave", () => {
    const params = defaultOscillatorSourceParams();
    expect(params).toEqual({ type: "sine", frequency: 440, detune: 0, pulseWidth: 0.5 });
    expect(params).not.toHaveProperty("periodicWave");
  });

  it("periodicWave is hidden until type is 'custom' (UX-618-style showIf, mirrored one level down)", () => {
    const field = OSCILLATOR_SOURCE_FIELDS.find((f) => f.key === "periodicWave")!;
    expect(isOscillatorSourceFieldVisible(field, { type: "sine" })).toBe(false);
    expect(isOscillatorSourceFieldVisible(field, { type: "custom" })).toBe(true);
    // falls back to type's own default ("sine") when the bag doesn't have "type" set yet
    expect(isOscillatorSourceFieldVisible(field, {})).toBe(false);
  });
});
