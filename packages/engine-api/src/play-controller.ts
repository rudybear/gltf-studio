import type { EngineKind } from "./value-types.js";

export interface PlayStartOptions {
  engine: EngineKind;
}

/**
 * PC-002: `variables` is keyed by each variable's declared `id` from the
 * document's `KHR_interactivity` graph where the graph declares one, and by
 * its numeric index (as a string) otherwise.
 */
export interface PlayInspection {
  time: number;
  variables: Record<string, unknown>;
  sentEvents: unknown[];
}

/** PC-005: `onDiagnostic`'s payload shape. */
export type PlayDiagnosticKind = "unhandled-pointer" | "engine-error";

/** PC-005: raised by the fan-out `SceneAdapter` for an unresolved `applyPointer` call, or by an uncaught engine error during a tick. */
export interface PlayDiagnostic {
  kind: PlayDiagnosticKind;
  message: string;
  pointer?: string;
}

/**
 * PlayController: one fan-out SceneAdapter.applyPointer -> renderHost ‖
 * audioHost per Phase A. Play mode never edits the document directly.
 */
export interface PlayController {
  /**
   * PC-004: resolves once the interpreter or compiled engine has been
   * constructed, bound to the fan-out `SceneAdapter`, and started (play is
   * already ticking by the time the promise resolves); rejects without
   * partially mutating play state if engine construction fails.
   */
  start(options: PlayStartOptions): Promise<void>;
  pause(): void;
  resume(): void;
  tickOnce(): void;

  /**
   * PC-003/PC-006/PC-007: idempotent (a no-op resolved promise if already
   * stopped); restores by calling `RenderHost.loadScene()` with the
   * `EditorDocument.json` captured at `start()` — NOT `RenderHost.snapshot()`.
   */
  stop(): Promise<void>;

  inspect(): PlayInspection;
  onDiagnostic(handler: (diagnostic: PlayDiagnostic) => void): () => void;

  /** PC-008: routes to the active engine's EngineInteractive.fireSelect; no-op while stopped. */
  fireSelect(nodeIndex: number, point: [number, number, number], rayOrigin?: [number, number, number]): void;
  /** PC-008: routes to the active engine's EngineInteractive.fireHoverIn; no-op while stopped. */
  fireHoverIn(nodeIndex: number, point?: [number, number, number]): void;
  /** PC-008: routes to the active engine's EngineInteractive.fireHoverOut; no-op while stopped. */
  fireHoverOut(nodeIndex?: number): void;
}
