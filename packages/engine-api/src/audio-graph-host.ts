/**
 * AudioGraphHost: v1 sibling of AudioHost, builds/runs the KHR_audio_graph
 * via AudioGraphJS's buildGraph and exposes lint results (its own lint.ts
 * plus the project's own gap-analysis constraints: DAG-only, no
 * cycles/envelopes/param-modulation) to the audio-graph canvas.
 */

// OPEN(AGH-lint-shape-tbd): plan references "lint results" without
// enumerating fields; left as an open record rather than guessed.
export type AudioGraphLintResult = Record<string, unknown>;

export interface AudioGraphHost {
  // OPEN(AGH-buildgraph-signature-tbd): plan does not specify buildGraph's
  // input shape (raw KHR_audio_graph extension JSON vs a pre-resolved
  // slice).
  buildGraph(json: unknown): void;

  lint(): AudioGraphLintResult[];

  // OPEN(AGH-audition-signature-tbd): plan says "audition ... hooks"
  // without a parameter list; a node id is the minimal reasonable reading
  // for auditioning a single audio-graph node.
  audition(nodeId: string): void;

  // OPEN(AGH-trace-shape-tbd): plan says "trace hooks" without specifying
  // return shape or whether trace is a subscribe-style API instead.
  trace(): unknown;

  // OPEN(AGH-lifecycle-tbd): unlike AudioHost's explicit
  // suspend/resume/dispose, the plan does not name any lifecycle methods
  // for AudioGraphHost. Left out entirely rather than assumed symmetric
  // with AudioHost.
}
