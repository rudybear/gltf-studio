// Drives the EQUIV/DIVERGED badge (specs/ux-audio-script.md UX-1400): the
// UI's own job is only to DISPLAY the result of `@gltf-audiograph/verify`'s
// equivalence-verification tooling, not to reimplement it — mirrors
// @gltf-studio/script-panel's equivalence.ts.
//
// Unlike the interactivity side, this compares the FULL r2 document shape —
// graph wiring AND oscillator-source payloads — via `equivalentAudioDocs`,
// not just `equivalentAudioGraphs`: an edit that changes only an
// oscillator's frequency (say) changes no wiring at all, so a graph-only
// compare would wrongly report EQUIV. `documentModule` is the CURRENT
// document's own imported module (already computed by the emit view) —
// `exportOscillatorSources` re-derives its doc-side oscillator entries in
// the same `{source, entry}` shape `exportAudioGraph` produces for the
// freshly-parsed buffer, so both sides compare apples to apples regardless
// of which pipeline stage (import vs. parse) produced them.
import { exportAudioGraph, exportOscillatorSources, type AudioIRModule } from "@gltf-audiograph/ir";
import { equivalentAudioDocs } from "@gltf-audiograph/verify";

export type AudioEquivalenceResult = { status: "equiv" } | { status: "diverged"; firstDivergence?: string };

export function checkAudioEquivalence(documentGraph: unknown, documentModule: AudioIRModule, parsedModule: AudioIRModule): AudioEquivalenceResult {
  const exported = exportAudioGraph(parsedModule);
  const docSources = exportOscillatorSources(documentModule.sources);
  const result = equivalentAudioDocs({ graph: documentGraph, sources: docSources }, { graph: exported.graph, sources: exported.sources });
  if (result.equivalent) return { status: "equiv" };
  return { status: "diverged", firstDivergence: result.firstDivergence };
}
