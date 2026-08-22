// Public API of @gltf-studio/audio-canvas (specs/ux-audio-graph.md UX-6xx).
export { AudioGraphCanvas, type AudioGraphCanvasProps } from "./audio-graph-canvas.js";
export { mapAudioGraph, AUDIO_PORT_TYPE, AUDIO_CATEGORY } from "./map-audio-graph.js";
export { AudioPalettePanel, type AudioPalettePanelProps } from "./audio-palette-panel.js";
export { AudioParamPanel, type AudioParamPanelProps } from "./audio-param-panel.js";
export {
  AUDIO_NODE_REGISTRY,
  AUDIO_NODE_CATEGORIES,
  audioNodeSpec,
  defaultParamsFor,
  OSCILLATOR_SOURCE_FIELDS,
  defaultOscillatorSourceParams,
  isOscillatorSourceFieldVisible,
  type AudioNodeSpec,
  type AudioNodeCategory,
  type AudioParamField,
  type AudioParamFieldType
} from "./audio-node-registry.js";
export { identifyMappedNode, findMappedNode, parseInputSocket, parseOutputSocket, type AudioEntity } from "./audio-entity.js";
export { buildAudioDiagnosticsByNode } from "./audio-diagnostics.js";
