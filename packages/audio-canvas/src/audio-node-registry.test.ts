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
  audioNodeCardSummary,
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

// Regression guard (bug report: "audio graph nodes have no values/
// parameters, only sockets") for the panel-correctness half of the fix —
// asserts the registry->panel plumbing this file/audio-param-panel.tsx share
// stays schema-driven and non-empty for EVERY creatable kind, so a future
// @gltf-audiograph/kernel shape change (a renamed AudioParamSpec field, a
// param dropped from a kind's list, ...) fails a fast unit test here rather
// than silently rendering an empty param panel/card summary in the app.
describe("registry->panel/card plumbing: every creatable kind has a real, fully-defaulted param schema", () => {
  it("every AUDIO_NODE_REGISTRY entry has at least one param field (never an empty schema for a real kind)", () => {
    for (const spec of AUDIO_NODE_REGISTRY) {
      expect(spec.params.length, `${spec.kind} has no param fields`).toBeGreaterThan(0);
    }
  });

  it("defaultParamsFor(kind) leaves no non-optional field undefined (a required-but-default-less kernel param without this file's own creationDefault would leak an undefined value into a freshly-created node's params, then render as a blank/'0' field)", () => {
    for (const spec of AUDIO_NODE_REGISTRY) {
      const params = defaultParamsFor(spec.kind);
      for (const field of spec.params) {
        if (field.optional) continue;
        expect(params[field.key], `${spec.kind}.${field.key} has no default/creationDefault`).not.toBeUndefined();
      }
    }
  });

  it("audioNodeSpec resolves every kernel-registered kind (no drift between this file's KIND_ORDER and @gltf-audiograph/kernel's AUDIO_KIND_REGISTRY — a mismatch here would make the whole module throw at import time, per this file's own header comment)", () => {
    for (const spec of AUDIO_NODE_REGISTRY) {
      expect(audioNodeSpec(spec.kind)).toBeDefined();
    }
  });
});

describe("audioNodeCardSummary (UX-620: card-legibility parity)", () => {
  it("summarizes a freshly-created (defaultParamsFor) node of EVERY creatable kind as a non-empty string — a palette-added node is exactly as legible as an imported one", () => {
    for (const spec of AUDIO_NODE_REGISTRY) {
      const summary = audioNodeCardSummary(spec.kind, defaultParamsFor(spec.kind));
      expect(summary, `${spec.kind} produced no card summary`).toBeTruthy();
      expect(summary!.length).toBeGreaterThan(0);
    }
  });

  it("formats a number param with its registry label's own unit suffix (e.g. 'Frequency (Hz)' -> 'Frequency: 350 Hz')", () => {
    expect(audioNodeCardSummary("lowpass", { frequency: 350, qualityFactor: 1 })).toBe("Frequency: 350 Hz · Q: 1");
  });

  it("shows a plain value with no unit suffix when the field's label has none (e.g. gain's own 'Gain' label)", () => {
    expect(audioNodeCardSummary("gain", { gain: 0.6, interpolation: "linear", duration: 0 })).toBe("Gain: 0.6 · Interpolation: linear · Duration: 0 s");
  });

  it("falls back to the field's own registry default when a param key is absent from the bag (a hand-authored/legacy node missing a key still summarizes)", () => {
    expect(audioNodeCardSummary("gain", {})).toBe("Gain: 1 · Interpolation: linear · Duration: 0 s");
  });

  it("excludes curve/periodic-wave fields (unbounded arrays, not card-legible) even when present and non-empty", () => {
    const summary = audioNodeCardSummary("gain", { gain: 0.6, interpolation: "custom", duration: 0, curve: [0, 0.5, 1] });
    expect(summary).not.toMatch(/curve/i);
    expect(summary).toContain("Interpolation: custom");
  });

  it("respects showIf visibility the same way the param panel does (UX-618) — a hidden field never appears in the summary", () => {
    const summaryHiddenBypass = audioNodeCardSummary("gain", { gain: 0.6, interpolation: "linear", duration: 0 });
    expect(summaryHiddenBypass).toBe("Gain: 0.6 · Interpolation: linear · Duration: 0 s");
  });

  it("returns undefined for an unregistered kind (e.g. the removed 'oscillator' node kind) rather than throwing or rendering a dangling row", () => {
    expect(audioNodeCardSummary("oscillator", {})).toBeUndefined();
    expect(audioNodeCardSummary("not-a-real-kind", {})).toBeUndefined();
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
