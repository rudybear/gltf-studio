// Static catalog of the KHR_audio_graph node "kinds" a document can legally
// declare (specs/ux-audio-graph.md UX-608's palette) PLUS the KHR_audio_emitter
// oscillator SOURCE fields (specs/ux-inspector.md UX-420's Sources sub-list) —
// both re-exported from `@gltf-audiograph/kernel`'s `AUDIO_KIND_REGISTRY`/
// `OSCILLATOR_SOURCE_SPEC` (packages/kernel/src/registry.ts in the sibling
// gltf-audiograph repo, vendored here as `@gltf-audiograph/kernel`) rather than
// hand-copied from the schema a second time — the same registry the Audio
// Script tab's parse/emit pipeline is built on, so the canvas palette and the
// script surface can never drift against each other again. This file adds
// only PRESENTATION metadata (category/label/description/UI field label/
// slider step/`showIf`) plus creation-time convenience defaults for
// schema-required-but-default-less params (see `PARAM_UI` below) — never a
// second copy of the kind/param/default facts themselves.
//
// r2 (spec PR #2632 rudybear/glTF@KHR_audio_graph @ c0042d7f, mirrored in
// `@gltf-audiograph/kernel`'s own registry.ts header comment):
//  - The `oscillator` node KIND was REMOVED from the node `oneOf` (17 -> 16
//    kinds) — an oscillator is now a `KHR_audio_emitter` SOURCE with no
//    `audio` index, carrying `extensions.KHR_audio_graph.oscillator`
//    (type/frequency/detune/pulseWidth/periodicWave), entering a graph via
//    `inputs[]` exactly like an opaque audio-clip source, never as a
//    `graph.nodes[]` entry. This file therefore has NO "Generators" category
//    and no creatable "oscillator" node any more — oscillator authoring
//    moved to the Audio Emitter inspector's Sources sub-list
//    (`packages/app/src/components/inspector/AudioSection.tsx`,
//    `specs/ux-inspector.md` UX-420), which uses this file's
//    `OSCILLATOR_SOURCE_FIELDS`/`defaultOscillatorSourceParams` instead of
//    a `AUDIO_NODE_REGISTRY` entry.
//  - `splitter`'s `numberOfOutputs`/`channelmerger`'s `numberOfInputs`
//    authored params were REMOVED — port arity is now DERIVED from the
//    highest port index referenced in `connections[]`/`inputs[]` (spec
//    rules 9/10; `@gltf-audiograph/kernel`'s `ports.ts` reports both as
//    `Infinity` at the params-only level for exactly this reason). Neither
//    kind has a channel-count field in this file any more — see
//    `map-audio-graph.ts`'s `defaultPortSlots` for how the canvas now grows
//    a splitter's/channelmerger's rendered port count purely from wiring.
//
// M7 audio-graph gaps-closed pass (UX-618, "fuller param coverage") field
// types, unchanged by r2 and still present on `gain`/`waveshaper` (curve)
// and the oscillator source (periodicWave):
//  - "curve": a flat `number[]` (waveshaper/gain's `curve`) — edited as a
//    textarea of comma/whitespace-separated numbers, committed as an array.
//  - "periodic-wave": the oscillator's `{ real: number[]; imag: number[] }`
//    Fourier-coefficient pair — edited as two "curve"-style textareas,
//    committed together as one nested object.
// Both are `optional: true` (kernel's own `AudioParamSpec.optional`): unlike
// every other field, `defaultParamsFor`/`defaultOscillatorSourceParams` do
// NOT pre-populate them onto a freshly-created node/source — an empty
// `curve: []` would violate the ratified schema's own `minItems: 2`, and an
// unedited `periodicWave` has no meaningful default shape to force onto
// every non-"custom" oscillator. They only enter `params` once the author
// actually edits them.
import {
  AUDIO_KIND_REGISTRY,
  OSCILLATOR_SOURCE_SPEC,
  type AudioKind,
  type AudioParamSpec,
  type AudioParamValue
} from "@gltf-audiograph/kernel";

export type AudioParamFieldType = AudioParamSpec["type"];

export interface AudioParamField {
  key: string;
  label: string;
  type: AudioParamFieldType;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  /** Only for `type: "enum"`. */
  options?: string[];
  /** Excluded from `defaultParamsFor`'s initial params bag — see this file's header comment on "curve"/"periodic-wave". */
  optional?: boolean;
  /** Only rendered/editable in `audio-param-panel.tsx` when `params[showIf.key] === showIf.equals` (falling back to that OTHER field's own registry default when the param bag doesn't have `showIf.key` set yet) — e.g. a gain's `curve` only makes sense once `interpolation` is `"custom"`. */
  showIf?: { key: string; equals: unknown };
}

/** r2: "Generators" is gone — oscillators are sources, not nodes. See this file's header. */
export type AudioNodeCategory = "Filters" | "Dynamics & Shaping" | "Channel Routing";

export interface AudioNodeSpec {
  kind: AudioKind;
  category: AudioNodeCategory;
  /** Short display label — the filter kinds' `kind` IS their filter type (there is no separate "biquadFilter" kind + `type` param), so this is what tells them apart in the palette. */
  label: string;
  description: string;
  params: AudioParamField[];
}

/** Presentation-only metadata this file overlays onto `@gltf-audiograph/kernel`'s data-only registry: which palette category a kind sits in, its display label/description, and per-param UI hints (a friendlier label, a slider `step`, `showIf` gating). `creationDefault` is this file's OWN addition for a kernel param that has no schema `default` (required or not) — a sensible starting value so a freshly `addNode`-ed node isn't immediately schema-invalid or visually blank; it is never used to override an already-authored value. */
interface KindUiMeta {
  category: AudioNodeCategory;
  label: string;
  description: string;
  params: Record<string, { label: string; step?: number; creationDefault?: AudioParamValue; showIf?: { key: string; equals: unknown } }>;
}

const FILTER_PARAM_UI = {
  frequency: { label: "Frequency (Hz)", step: 10, creationDefault: 350 },
  qualityFactor: { label: "Q", step: 0.1 },
  gain: { label: "Gain (dB)", step: 1 }
};

const KIND_UI: Record<AudioKind, KindUiMeta> = {
  gain: {
    category: "Dynamics & Shaping",
    label: "Gain",
    description: "Multiplies the signal by a linear gain factor.",
    params: {
      gain: { label: "Gain", step: 0.05 },
      interpolation: { label: "Interpolation" },
      duration: { label: "Duration (s)", step: 0.05 },
      curve: { label: "Custom curve (gain factors 0-1, sampled over duration)", showIf: { key: "interpolation", equals: "custom" } }
    }
  },
  delay: {
    category: "Dynamics & Shaping",
    label: "Delay",
    description: "Delays the signal by a fixed time.",
    params: {
      delayTime: { label: "Delay time (s)", step: 0.01 },
      maxDelayTime: { label: "Max delay time (s)", step: 0.1 }
    }
  },
  waveshaper: {
    category: "Dynamics & Shaping",
    label: "Wave Shaper",
    description: "Nonlinear distortion/shaping curve.",
    params: {
      amount: { label: "Amount", step: 0.01, creationDefault: 0.5 },
      oversample: { label: "Oversample" },
      // UX-618: unlike gain's "curve" (approximated at runtime) or the
      // oscillator source's "periodicWave" (fully applied at runtime), the
      // vendored AudioGraphJS runtime DOES apply this one directly
      // (`nodes/waveShaper.js` uses `params.curve` verbatim when present,
      // falling back to an `amount`-derived tanh curve only when absent) —
      // a genuinely fully-supported param, not just schema-legal.
      curve: { label: "Explicit shaping curve (-1 to 1, overrides Amount)" }
    }
  },
  lowpass: { category: "Filters", label: "Lowpass Filter", description: "Attenuates frequencies above the cutoff.", params: FILTER_PARAM_UI },
  highpass: { category: "Filters", label: "Highpass Filter", description: "Attenuates frequencies below the cutoff.", params: FILTER_PARAM_UI },
  bandpass: { category: "Filters", label: "Bandpass Filter", description: "Passes a band around the center frequency.", params: FILTER_PARAM_UI },
  notch: { category: "Filters", label: "Notch Filter", description: "Attenuates a narrow band around the center frequency.", params: FILTER_PARAM_UI },
  allpass: { category: "Filters", label: "Allpass Filter", description: "Passes all frequencies, shifting phase.", params: FILTER_PARAM_UI },
  lowshelf: { category: "Filters", label: "Lowshelf Filter", description: "Boosts/cuts frequencies below the corner frequency.", params: FILTER_PARAM_UI },
  highshelf: { category: "Filters", label: "Highshelf Filter", description: "Boosts/cuts frequencies above the corner frequency.", params: FILTER_PARAM_UI },
  peaking: { category: "Filters", label: "Peaking Filter", description: "Boosts/cuts a band around the center frequency.", params: FILTER_PARAM_UI },
  splitter: {
    category: "Channel Routing",
    label: "Channel Splitter",
    description: "Splits a multi-channel signal into separate single-channel outputs (fan-out count is derived from wiring — connect to grow it).",
    params: { channelInterpretation: { label: "Channel interpretation" } }
  },
  channelmerger: {
    category: "Channel Routing",
    label: "Channel Merger",
    description: "Merges separate single-channel inputs into one multi-channel output (fan-in count is derived from wiring — connect to grow it).",
    params: { channelInterpretation: { label: "Channel interpretation" } }
  },
  channelmixer: {
    category: "Channel Routing",
    label: "Channel Mixer",
    description: "Remixes to a target channel count.",
    params: {
      outputChannels: { label: "Output channels", creationDefault: 2 },
      channelInterpretation: { label: "Channel interpretation" }
    }
  },
  audiomixer: {
    category: "Channel Routing",
    label: "Audio Mixer",
    description: "Sums multiple inputs into one output (a plain summing junction).",
    params: { channelInterpretation: { label: "Channel interpretation" } }
  },
  compressor: {
    category: "Dynamics & Shaping",
    label: "Compressor",
    description: "Dynamics compressor (schema-valid; not yet built by this project's vendored runtime — see the lint warning).",
    params: {
      threshold: { label: "Threshold (dB)", step: 1 },
      knee: { label: "Knee (dB)", step: 1 },
      ratio: { label: "Ratio", step: 0.5 },
      attack: { label: "Attack (s)", step: 0.001 },
      release: { label: "Release (s)", step: 0.01 }
    }
  }
};

/** Palette display order — grouped by category, matching `AUDIO_NODE_CATEGORIES` below (kernel's own `AUDIO_KIND_REGISTRY` Map iterates in schema-file order, which does not group nicely for a palette). */
const KIND_ORDER: AudioKind[] = [
  "gain",
  "delay",
  "waveshaper",
  "compressor",
  "lowpass",
  "highpass",
  "bandpass",
  "notch",
  "allpass",
  "lowshelf",
  "highshelf",
  "peaking",
  "splitter",
  "channelmerger",
  "channelmixer",
  "audiomixer"
];

function toField(spec: AudioParamSpec, ui: { label: string; step?: number; creationDefault?: AudioParamValue; showIf?: { key: string; equals: unknown } }): AudioParamField {
  return {
    key: spec.key,
    label: ui.label,
    type: spec.type,
    default: spec.optional ? spec.default : (spec.default ?? ui.creationDefault),
    min: spec.min,
    max: spec.max,
    step: ui.step,
    options: spec.options ? [...spec.options] : undefined,
    optional: spec.optional,
    showIf: ui.showIf
  };
}

export const AUDIO_NODE_REGISTRY: AudioNodeSpec[] = KIND_ORDER.map((kind) => {
  const kernelSpec = AUDIO_KIND_REGISTRY.get(kind);
  if (!kernelSpec) {
    throw new Error(`audio-node-registry.ts: "${kind}" is in KIND_ORDER but not in @gltf-audiograph/kernel's AUDIO_KIND_REGISTRY — registries have drifted.`);
  }
  const ui = KIND_UI[kind];
  return {
    kind,
    category: ui.category,
    label: ui.label,
    description: ui.description,
    params: kernelSpec.params.map((spec) => toField(spec, ui.params[spec.key] ?? { label: spec.key }))
  };
});

export const AUDIO_NODE_CATEGORIES: AudioNodeCategory[] = ["Filters", "Dynamics & Shaping", "Channel Routing"];

export function audioNodeSpec(kind: string): AudioNodeSpec | undefined {
  return AUDIO_NODE_REGISTRY.find((spec) => spec.kind === kind);
}

/** The default `params` object a freshly-created node of `kind` gets (one key per NON-`optional` registry field, at its `default`) — `optional: true` fields (`curve`/`periodic-wave`, this file's header comment) are deliberately left out until the author actually edits them. */
export function defaultParamsFor(kind: string): Record<string, unknown> {
  const spec = audioNodeSpec(kind);
  if (!spec) return {};
  const params: Record<string, unknown> = {};
  for (const field of spec.params) {
    if (field.optional) continue;
    params[field.key] = field.default;
  }
  return params;
}

/** UX-618: whether `field` should currently be rendered/edited, given the REST of the node's current `params` (its own `showIf.key`'s value, falling back to that OTHER field's own registry default when unset). Fields with no `showIf` are always visible. */
export function isParamFieldVisible(spec: AudioNodeSpec, field: AudioParamField, params: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  const controllingField = spec.params.find((f) => f.key === field.showIf!.key);
  const currentValue = params[field.showIf.key] ?? controllingField?.default;
  return currentValue === field.showIf.equals;
}

// ---------------------------------------------------------------------------
// r2: the oscillator SOURCE payload (KHR_audio_emitter.sources[N].extensions
// .KHR_audio_graph.oscillator) — no longer a graph node, so it lives outside
// AUDIO_NODE_REGISTRY entirely. Consumed by the Audio Emitter inspector's
// Sources sub-list (specs/ux-inspector.md UX-420,
// packages/app/src/components/inspector/AudioSection.tsx), not by the
// audio-graph canvas palette.
// ---------------------------------------------------------------------------

const OSCILLATOR_SOURCE_UI: Record<string, { label: string; step?: number; creationDefault?: AudioParamValue; showIf?: { key: string; equals: unknown } }> = {
  type: { label: "Waveform", creationDefault: "sine" },
  frequency: { label: "Frequency (Hz)", step: 1 },
  detune: { label: "Detune (cents)", step: 1 },
  pulseWidth: { label: "Pulse width", step: 0.01 },
  periodicWave: { label: "Custom waveform (Fourier coefficients)", showIf: { key: "type", equals: "custom" } }
};

/** The oscillator source's editable field list, in the same `AudioParamField` shape `audio-param-panel.tsx` already knows how to render a node's `params` with — an oscillator source's `extensions.KHR_audio_graph.oscillator` bag is edited the identical way. */
export const OSCILLATOR_SOURCE_FIELDS: AudioParamField[] = OSCILLATOR_SOURCE_SPEC.params.map((spec) => toField(spec, OSCILLATOR_SOURCE_UI[spec.key] ?? { label: spec.key }));

/** The default `extensions.KHR_audio_graph.oscillator` payload for a freshly-authored oscillator source (one key per non-`optional` field, at its default) — mirrors `defaultParamsFor`'s exclusion of `optional` (`periodicWave`) fields. */
export function defaultOscillatorSourceParams(): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const field of OSCILLATOR_SOURCE_FIELDS) {
    if (field.optional) continue;
    params[field.key] = field.default;
  }
  return params;
}

/** UX-618-style visibility helper for `OSCILLATOR_SOURCE_FIELDS` (`periodicWave` only when `type === "custom"`), mirroring `isParamFieldVisible`'s node-side logic one level down for a source's oscillator bag. */
export function isOscillatorSourceFieldVisible(field: AudioParamField, oscillatorParams: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  const controllingField = OSCILLATOR_SOURCE_FIELDS.find((f) => f.key === field.showIf!.key);
  const currentValue = oscillatorParams[field.showIf.key] ?? controllingField?.default;
  return currentValue === field.showIf.equals;
}
