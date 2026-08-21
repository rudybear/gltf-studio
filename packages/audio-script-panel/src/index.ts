// Public API of @gltf-studio/audio-script-panel (specs/ux-audio-script.md UX-1400).
export { AudioScriptPanel, type AudioScriptPanelProps, type GltfStudioAudioScriptTestHook } from "./audio-script-panel.js";
export { buildAudioEmitView, namesForAudioModule, provenanceComment, type AudioEmitView } from "./emit-view.js";
export { checkAudioEquivalence, type AudioEquivalenceResult } from "./equivalence.js";
export { findHighlightForAudioNode, findHighlightForAudioSource, offsetToLineColumn, type AudioHighlightMatch } from "./audio-cross-highlight.js";
