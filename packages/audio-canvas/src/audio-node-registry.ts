// Static catalog of the KHR_audio_graph node "kinds" a document can legally
// declare (specs/ux-audio-graph.md UX-608's palette), taken straight from
// the ratified extension's own `KHR_audio_graph.node.schema.json` `oneOf`
// list (glTF-audio/AudioGraphJS/spec-repo) — NOT from `audio-graph-js`'s
// runtime `NodeKind` union, which additionally has synthetic/derived kinds
// (`audio-buffer-source`, `emitter`, `stereo-panner`, `convolver`, `panner`)
// this canvas's `map-audio-graph.ts` already projects separately (sources,
// terminal emitters) or that the schema doesn't allow authoring directly at
// all (spatialization/reverb live on `KHR_audio_emitter`/`KHR_audio_environment`
// instead — see glTF-audio/03-gap-analysis-audio-graph.md's layering-
// discipline note). Every param default/range below is copied from that
// schema's own `default`/`minimum`/`maximum` (falling back to the vendored
// AudioGraphJS node constructor's own default where the schema is silent,
// e.g. oscillator `frequency: 440`).
//
// One entry's `kind` string is EXACTLY the value `AudioGraphEdit.addNode`'s
// `kind` argument must carry — this registry is the palette's only source of
// truth for "what nodes can this canvas create" (UX-608) and "what does
// each node's param editor look like" (UX-609/UX-610).
// M7 audio-graph gaps-closed pass (UX-618, "fuller param coverage"): two new
// field types beyond the original number/integer/boolean/enum set.
//  - "curve": a flat `number[]` (waveshaper/gain's `curve`) — edited as a
//    textarea of comma/whitespace-separated numbers, committed as an array.
//  - "periodic-wave": the oscillator's `{ real: number[]; imag: number[] }`
//    Fourier-coefficient pair (gap-analysis G2's payload, now real in the
//    ratified schema) — edited as two "curve"-style textareas, committed
//    together as one nested object.
// Both are `optional: true` (see `AudioParamField.optional` below): unlike
// every other field, `defaultParamsFor` does NOT pre-populate them onto a
// freshly-created node — an empty `curve: []` would violate the ratified
// schema's own `minItems: 2`, and an unedited `periodicWave` has no
// meaningful default shape to force onto every non-"custom" oscillator.
// They only enter `params` once the author actually edits them.
export type AudioParamFieldType = "number" | "integer" | "boolean" | "enum" | "curve" | "periodic-wave";

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
  /** M7 gaps-closed pass: excluded from `defaultParamsFor`'s initial params bag — see this file's header comment on "curve"/"periodic-wave". */
  optional?: boolean;
  /** M7 gaps-closed pass (UX-618): only rendered/editable in `audio-param-panel.tsx` when `params[showIf.key] === showIf.equals` (falling back to that OTHER field's own registry default when the param bag doesn't have `showIf.key` set yet) — e.g. a gain's `curve` only makes sense once `interpolation` is `"custom"`. */
  showIf?: { key: string; equals: unknown };
}

export type AudioNodeCategory = "Generators" | "Filters" | "Dynamics & Shaping" | "Channel Routing";

export interface AudioNodeSpec {
  kind: string;
  category: AudioNodeCategory;
  /** Short display label — the filter kinds' `kind` IS their filter type (there is no separate "biquadFilter" kind + `type` param — see the schema's per-filter-type `oneOf` entries), so this is what tells them apart in the palette. */
  label: string;
  description: string;
  params: AudioParamField[];
}

const FILTER_FREQUENCY: AudioParamField = { key: "frequency", label: "Frequency (Hz)", type: "number", default: 350, min: 0, step: 10 };
const FILTER_Q: AudioParamField = { key: "qualityFactor", label: "Q", type: "number", default: 1.0, min: 0, step: 0.1 };
const FILTER_GAIN_DB: AudioParamField = { key: "gain", label: "Gain (dB)", type: "number", default: 0, step: 1 };

function filterSpec(kind: string, label: string, description: string, extra: AudioParamField[] = []): AudioNodeSpec {
  return { kind, category: "Filters", label, description, params: [FILTER_FREQUENCY, FILTER_Q, ...extra] };
}

export const AUDIO_NODE_REGISTRY: AudioNodeSpec[] = [
  // --- Generators ---
  {
    kind: "oscillator",
    category: "Generators",
    label: "Oscillator",
    description: "A periodic waveform source (sine/square/triangle/sawtooth).",
    params: [
      { key: "type", label: "Waveform", type: "enum", default: "sine", options: ["sine", "square", "triangle", "sawtooth", "custom"] },
      { key: "frequency", label: "Frequency (Hz)", type: "number", default: 440, min: 0, step: 1 },
      { key: "detune", label: "Detune (cents)", type: "number", default: 0, step: 1 },
      { key: "pulseWidth", label: "Pulse width", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 },
      // UX-618 / gap-analysis G2 (resolved in the ratified schema — see
      // validators.ts's header comment for the runtime-side caveat):
      // required by the schema when type is "custom", so only shown then.
      {
        key: "periodicWave",
        label: "Custom waveform (Fourier coefficients)",
        type: "periodic-wave",
        default: { real: [0, 1], imag: [0, 0] },
        optional: true,
        showIf: { key: "type", equals: "custom" }
      }
    ]
  },

  // --- Dynamics & Shaping ---
  {
    kind: "gain",
    category: "Dynamics & Shaping",
    label: "Gain",
    description: "Multiplies the signal by a linear gain factor.",
    params: [
      { key: "gain", label: "Gain", type: "number", default: 1.0, min: 0, step: 0.05 },
      { key: "interpolation", label: "Interpolation", type: "enum", default: "linear", options: ["linear", "custom"] },
      { key: "duration", label: "Duration (s)", type: "number", default: 0, min: 0, step: 0.05 },
      // UX-618 / gap-analysis G2 (resolved in the ratified schema): only
      // meaningful once interpolation is "custom" — see validators.ts's
      // "gain-curve-runtime-unimplemented" for this runtime's caveat once
      // it's authored (approximated, not sampled).
      {
        key: "curve",
        label: "Custom curve (gain factors 0-1, sampled over duration)",
        type: "curve",
        default: [0, 1],
        min: 0,
        max: 1,
        optional: true,
        showIf: { key: "interpolation", equals: "custom" }
      }
    ]
  },
  {
    kind: "delay",
    category: "Dynamics & Shaping",
    label: "Delay",
    description: "Delays the signal by a fixed time.",
    params: [
      { key: "delayTime", label: "Delay time (s)", type: "number", default: 0, min: 0, step: 0.01 },
      { key: "maxDelayTime", label: "Max delay time (s)", type: "number", default: 1.0, min: 0, step: 0.1 }
    ]
  },
  {
    kind: "waveshaper",
    category: "Dynamics & Shaping",
    label: "Wave Shaper",
    description: "Nonlinear distortion/shaping curve.",
    params: [
      { key: "amount", label: "Amount", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: "oversample", label: "Oversample", type: "enum", default: "none", options: ["none", "2x", "4x"] },
      // UX-618: unlike gain's "curve" (approximated at runtime) or
      // oscillator's "periodicWave" (unread at runtime), the vendored
      // AudioGraphJS runtime DOES apply this one directly
      // (`nodes/waveShaper.js` uses `params.curve` verbatim when present,
      // falling back to an `amount`-derived tanh curve only when absent) —
      // a genuinely fully-supported param, not just schema-legal.
      { key: "curve", label: "Explicit shaping curve (-1 to 1, overrides Amount)", type: "curve", default: [-1, 0, 1], min: -1, max: 1, optional: true }
    ]
  },
  // UX-619 (Track 2, gap-analysis G1): `compressor` is a REAL kind in the
  // ratified schema (`KHR_audio_graph.compressor.schema.json`, added by
  // PR #2572's review-fixes refresh, alongside oscillator `periodicWave`
  // and gain `curve` above) — the gap analysis's "no DynamicsCompressorNode"
  // finding predates that refresh and no longer holds at the SCHEMA level.
  // It stays authorable here (schema-conformant), but this project's
  // vendored `audio-graph-js@0.1.0` runtime has no `'compressor'` case in
  // its node builder yet (`validators.ts`'s own header comment,
  // "compressor-runtime-unimplemented") — a genuine implementation gap, not
  // a spec gap; `AudioGraphJsHost.audition()` degrades gracefully rather
  // than throwing when a document reaches one.
  {
    kind: "compressor",
    category: "Dynamics & Shaping",
    label: "Compressor",
    description: "Dynamics compressor (schema-valid; not yet built by this project's vendored runtime — see the lint warning).",
    params: [
      { key: "threshold", label: "Threshold (dB)", type: "number", default: -24.0, min: -100, max: 0, step: 1 },
      { key: "knee", label: "Knee (dB)", type: "number", default: 30.0, min: 0, max: 40, step: 1 },
      { key: "ratio", label: "Ratio", type: "number", default: 12.0, min: 1, max: 20, step: 0.5 },
      { key: "attack", label: "Attack (s)", type: "number", default: 0.003, min: 0, max: 1, step: 0.001 },
      { key: "release", label: "Release (s)", type: "number", default: 0.25, min: 0, max: 1, step: 0.01 }
    ]
  },

  // --- Filters (KHR_audio_graph.node.schema.json's 8 biquad kinds — the KIND is the filter type) ---
  filterSpec("lowpass", "Lowpass Filter", "Attenuates frequencies above the cutoff."),
  filterSpec("highpass", "Highpass Filter", "Attenuates frequencies below the cutoff."),
  filterSpec("bandpass", "Bandpass Filter", "Passes a band around the center frequency."),
  filterSpec("notch", "Notch Filter", "Attenuates a narrow band around the center frequency."),
  filterSpec("allpass", "Allpass Filter", "Passes all frequencies, shifting phase."),
  filterSpec("lowshelf", "Lowshelf Filter", "Boosts/cuts frequencies below the corner frequency.", [FILTER_GAIN_DB]),
  filterSpec("highshelf", "Highshelf Filter", "Boosts/cuts frequencies above the corner frequency.", [FILTER_GAIN_DB]),
  filterSpec("peaking", "Peaking Filter", "Boosts/cuts a band around the center frequency.", [FILTER_GAIN_DB]),

  // --- Channel Routing ---
  {
    kind: "splitter",
    category: "Channel Routing",
    label: "Channel Splitter",
    description: "Splits a multi-channel signal into separate single-channel outputs.",
    params: [
      // UX-615 (Track 1 gap closure): NOT part of the ratified
      // `KHR_audio_graph.splitter.schema.json` (it declares no explicit
      // channel-count param — see validators.ts's header comment) but the
      // vendored runtime's `createChannelSplitter` reads it
      // (`numberOfOutputs ?? 6`), and `channelmerger`'s symmetric
      // `numberOfInputs` was already an accepted params key before this PR.
      // `map-audio-graph.ts`'s `defaultPortSlots` reads this to seed that
      // many rendered output ports EVEN BEFORE any connection uses them —
      // the fix for "splitter fan-out only reachable at slot 0".
      { key: "numberOfOutputs", label: "Number of outputs", type: "integer", default: 2, min: 1, max: 32, step: 1 },
      { key: "channelInterpretation", label: "Channel interpretation", type: "enum", default: "discrete", options: ["speakers", "discrete"] }
    ]
  },
  {
    kind: "channelmerger",
    category: "Channel Routing",
    label: "Channel Merger",
    description: "Merges separate single-channel inputs into one multi-channel output.",
    params: [
      // UX-615: `map-audio-graph.ts`'s `defaultPortSlots` reads this
      // existing param (already accepted pre-M7 — see `splitter`'s new
      // `numberOfOutputs` field comment above) to seed that many rendered
      // input ports even before any connection uses them.
      { key: "numberOfInputs", label: "Number of inputs", type: "integer", default: 2, min: 1, max: 32, step: 1 },
      { key: "channelInterpretation", label: "Channel interpretation", type: "enum", default: "discrete", options: ["speakers", "discrete"] }
    ]
  },
  {
    kind: "channelmixer",
    category: "Channel Routing",
    label: "Channel Mixer",
    description: "Remixes to a target channel count.",
    params: [
      { key: "outputChannels", label: "Output channels", type: "integer", default: 2, min: 1, max: 32, step: 1 },
      { key: "channelInterpretation", label: "Channel interpretation", type: "enum", default: "speakers", options: ["speakers", "discrete"] }
    ]
  },
  {
    kind: "audiomixer",
    category: "Channel Routing",
    label: "Audio Mixer",
    description: "Sums multiple inputs into one output (a plain summing junction).",
    params: [{ key: "channelInterpretation", label: "Channel interpretation", type: "enum", default: "speakers", options: ["speakers", "discrete"] }]
  }
];

export const AUDIO_NODE_CATEGORIES: AudioNodeCategory[] = ["Generators", "Filters", "Dynamics & Shaping", "Channel Routing"];

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
