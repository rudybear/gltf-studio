// Builds the Audio Script tab's Emit view (specs/ux-audio-script.md
// UX-1400): `extensions.KHR_audio_graph.graphs[graphIndex]` (plus the
// sibling `extensions.KHR_audio_emitter` block, needed so r2 oscillator
// sources resolve — see @gltf-audiograph/ir's `importAudioGraph` header) ->
// `@gltf-audiograph/ir`'s `importAudioGraph` -> `@gltf-audiograph/emit-ts`'s
// `emitAudioModule` -> real audio-script source text, with a leading
// provenance comment. Mirrors @gltf-studio/script-panel's emit-view.ts
// exactly, one transpiler over.
import { importAudioGraph, type AudioIRModule, type Diagnostic, type EmitterBlockLike } from "@gltf-audiograph/ir";
import { emitAudioModule } from "@gltf-audiograph/emit-ts";

export type AudioEmitView = {
  code: string;
  names: Record<number, string>;
  sourceNames: Record<number, string>;
  module: AudioIRModule;
  /** Diagnostics from `importAudioGraph` itself (a malformed graph, or — per r2's reconciliation with this app's canvas — an oscillator authored as a NODE kind, which r2 no longer allows: see specs/ux-audio-script.md's Implementation notes). Distinct from parse-side diagnostics, which only apply to hand-edited code. */
  diagnostics: Diagnostic[];
};

/** UX-1400: the emitted code opens with a leading comment naming which graph it was generated from — mirrors script-panel's `provenanceComment` (its own doc comment explains why an index, not a name: KHR_audio_graph carries no per-graph name field either). */
export function provenanceComment(graphIndex: number): string {
  return `// Audio script — generated from audio graph ${graphIndex}\n`;
}

/**
 * r2/canvas-reconciliation tolerance (specs/ux-audio-script.md's
 * Implementation notes): unlike @gltfi/ir's `importGraph` (defensive enough
 * that a malformed graph's `emitModule` call never throws), a structurally
 * invalid `AudioIRModule` — e.g. one `importAudioGraph` flagged with an
 * `oscillator-node-kind` error (a legacy oscillator-as-NODE-kind graph,
 * exactly the shape this app's own `audio-canvas` node registry still
 * authors — see this package's own top-of-tree reconciliation note) or a
 * dangling node/source reference — can make `emitAudioModule` itself throw.
 * Rather than let that surface as an unhandled panel crash, an ERROR-
 * severity `importAudioGraph` diagnostic short-circuits emission entirely:
 * the Emit view falls back to a diagnostics-only placeholder, same "honest,
 * bounded-effort" posture as everywhere else UX-1400 documents a fidelity
 * gap. A WARNING-only diagnostic set still emits normally (e.g. r2's
 * `arity-param-ignored` for an authored `numberOfOutputs`/`numberOfInputs`
 * — see audio-node-registry's own reconciliation note).
 */
export function buildAudioEmitView(graph: unknown, graphIndex: number, emitter?: EmitterBlockLike): AudioEmitView {
  const { module, diagnostics } = importAudioGraph(graph, emitter ? { emitter } : undefined);
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    return { code: `${provenanceComment(graphIndex)}// Cannot generate a script — the audio graph has structural errors below.\n`, names: {}, sourceNames: {}, module, diagnostics };
  }
  const { code, names, sourceNames } = emitAudioModule(module);
  return { code: provenanceComment(graphIndex) + code, names, sourceNames, module, diagnostics };
}

/**
 * Re-derives just `names`/`sourceNames` (for UX-1400's cross-highlight) for
 * a module that came from a hand-edited buffer via `parseAudioModule` rather
 * than from `importAudioGraph` — mirrors script-panel's `namesForModule`.
 * Unlike the interactivity side, `@gltf-audiograph/emit-ts`'s `names`/
 * `sourceNames` are already keyed directly by node/source index (no
 * `sourceNodeIds` indirection needed) — see `audio-cross-highlight.ts`.
 */
export function namesForAudioModule(module: AudioIRModule): { names: Record<number, string>; sourceNames: Record<number, string> } {
  const { names, sourceNames } = emitAudioModule(module);
  return { names, sourceNames };
}
