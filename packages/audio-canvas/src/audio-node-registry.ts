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
export type AudioParamFieldType = "number" | "integer" | "boolean" | "enum" | "curve";

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
      { key: "pulseWidth", label: "Pulse width", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 }
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
      { key: "duration", label: "Duration (s)", type: "number", default: 0, min: 0, step: 0.05 }
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
      { key: "oversample", label: "Oversample", type: "enum", default: "none", options: ["none", "2x", "4x"] }
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
    params: [{ key: "channelInterpretation", label: "Channel interpretation", type: "enum", default: "discrete", options: ["speakers", "discrete"] }]
  },
  {
    kind: "channelmerger",
    category: "Channel Routing",
    label: "Channel Merger",
    description: "Merges separate single-channel inputs into one multi-channel output.",
    params: [
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

/** The default `params` object a freshly-created node of `kind` gets (one key per registry field, at its `default`). */
export function defaultParamsFor(kind: string): Record<string, unknown> {
  const spec = audioNodeSpec(kind);
  if (!spec) return {};
  const params: Record<string, unknown> = {};
  for (const field of spec.params) {
    params[field.key] = field.default;
  }
  return params;
}
