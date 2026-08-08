import type { EngineKind } from "./value-types.js";

export interface PlayStartOptions {
  engine: EngineKind;
}

// OPEN(PC-inspect-shape-tbd): the plan says inspect() surfaces
// "time/variables/sentEvents via asEngineLike" without giving the literal
// return shape; this is a reasonable direct reading of that phrase but the
// exact field names/types are not pinned down by the plan.
export interface PlayInspection {
  time: number;
  variables: Record<string, unknown>;
  sentEvents: unknown[];
}

// OPEN(PC-diagnostic-shape-tbd): the plan's reuse table names a
// `DiagnosticsRecorder` but the onDiagnostic payload shape isn't specified
// here; left as an open record rather than guessed fields.
export type PlayDiagnostic = Record<string, unknown>;

/**
 * PlayController: one fan-out SceneAdapter.applyPointer -> renderHost ‖
 * audioHost per Phase A. Play mode never edits the document directly.
 */
export interface PlayController {
  // OPEN(PC-start-return-tbd): plan does not specify whether start()
  // resolves synchronously or is async; modeled as async since it very
  // likely spins up an interpreter/compiled pipeline.
  start(options: PlayStartOptions): Promise<void>;
  pause(): void;
  resume(): void;
  tickOnce(): void;

  /**
   * PC-003: stop() contractually reloads the scene snapshot — the
   * guaranteed-correct v1 restore for the known dispose gap (see the
   * program plan's "Greenfield gaps" list: "dispose/hot-reload lifecycle").
   */
  stop(): void;

  inspect(): PlayInspection;
  onDiagnostic(handler: (diagnostic: PlayDiagnostic) => void): () => void;
}
