/**
 * AudioGraphHost: v1 sibling of AudioHost, builds/runs the KHR_audio_graph
 * via AudioGraphJS's buildGraph and exposes lint results (its own lint.ts
 * plus the project's own gap-analysis constraints: DAG-only, no
 * cycles/envelopes/param-modulation) to the audio-graph canvas.
 */

/**
 * AGH-lint-shape-tbd (RESOLVED, M7, `audio-graph`): one entry PER VIOLATION
 * (not per graph or per document) — `graphIndex` identifies which
 * `extensions.KHR_audio_graph.graphs[N]` it came from (`-1` for a
 * document-level problem, e.g. `KHR_audio_graph` present without the
 * sibling `KHR_audio_emitter` extension it requires). `message` is always a
 * complete, human-readable sentence naming the specific nodes involved
 * (specs/ux-audio-graph.md UX-602's "cycle detected (gain → biquadFilter →
 * panner → gain)" example) — never just an abstract code standing alone.
 * `code` is a stable machine id for programmatic filtering/testing
 * (`"cycle"`, `"param-modulation"`, `"missing-emitter-extension"`,
 * `"parse-failed"`, `"build-failed"`, plus whatever raw AudioGraphJS
 * `lintGraph`/`lintLayeredGraph` message the `"upstream"` code wraps
 * verbatim when this package has no more specific classification for it).
 * `nodeIds` is the ordered path of node labels (or `kind` when a node has
 * no `label`) implicated in the violation — e.g. the cycle's node sequence
 * — empty when not applicable (a document-level violation).
 */
export interface AudioGraphLintResult {
  graphIndex: number;
  severity: "error" | "warning";
  code: string;
  message: string;
  nodeIds: string[];
}

export interface AudioGraphHost {
  /**
   * AGH-buildgraph-signature-tbd (RESOLVED, M7, `audio-graph`): mirrors
   * `AudioHost.loadEmitters`'s resolution (see specs/engine-api.md's
   * AH-loademitters-shape-tbd note) — `json` is the full glTF document (or
   * the `{ json, binary }` container shape), not a pre-resolved
   * `KHR_audio_graph` slice, because `KHR_audio_graph` graphs reference
   * `KHR_audio_emitter`'s `sources`/`emitters` arrays by index and cannot be
   * interpreted standalone (AudioGraphJS's own `parseLayeredExtensions`
   * requires the same). Parsing and linting run synchronously and need no
   * `AudioContext`; real Web Audio node construction is deferred to
   * `audition()`, so calling `buildGraph` alone (e.g. just to feed the
   * audio-graph canvas + lint banner) never touches the browser's
   * autoplay-gated audio subsystem. A document with no `KHR_audio_graph`
   * extension is not an error — `lint()` reports no violations and the
   * canvas renders nothing (per this requirement's own "reports empty
   * gracefully" clause).
   */
  buildGraph(json: unknown): void;

  lint(): AudioGraphLintResult[];

  /**
   * AGH-audition-signature-tbd (RESOLVED, M7, `audio-graph`): confirmed as
   * a node id (a `KHRGraphNodeSpec.label`, falling back to `node_{i}` for an
   * unlabeled node — the same id `buildGraph`'s internal `GraphSpec` uses).
   * Lazily builds real Web Audio nodes for the graph containing `nodeId` on
   * first call (see `buildGraph`'s doc comment) and taps that node's output
   * to the destination for a short preview. No-op if `nodeId` is not found
   * in the most recently built graph(s).
   */
  audition(nodeId: string): void;

  /**
   * AGH-trace-shape-tbd (RESOLVED, M7, `audio-graph`): a snapshot accessor,
   * not a subscribe-style API — returns the accumulated
   * AudioGraphJS `TraceLogger` lines (one per node/connection built or
   * bypass-toggled, taken from its own `createMemoryTrace()`) from the most
   * recent `buildGraph`/`audition` call, as a plain `string[]`. Minimal by
   * design (v1 "trace hooks" per the program plan): good enough for a
   * debug console dump, not a live event stream.
   */
  trace(): string[];

  // OPEN(AGH-lifecycle-tbd): unlike AudioHost's explicit
  // suspend/resume/dispose, the plan does not name any lifecycle methods
  // for AudioGraphHost. Left out entirely rather than assumed symmetric
  // with AudioHost — a concrete implementation MAY still expose its own
  // extra, non-interface cleanup method (see `AudioGraphJsHost.close()` in
  // `@gltf-studio/audio-graph`) the same way `WebAudioHost.getDiagnostics()`
  // is an AudioHost-interface-external extra.
}
