// PlayController implementation (specs/engine-api.md PC-001..PC-008). See
// packages/engine-api/src/play-controller.ts for the interface contract this
// file implements, and engine-host.ts for how the interpreter/compiled
// engine itself gets built.
import type { AudioHost, PlayController, PlayDiagnostic, PlayInspection, PlayStartOptions, RenderHost } from "@gltf-studio/engine-api";
import { createEngineHost, type EngineHost, type PointerFanOut } from "./engine-host.js";
import { createDefaultScheduler, type FrameScheduler } from "./scheduler.js";

/**
 * `tickOnce()`'s fixed step, and the step used for the very first tick after
 * `start()`/`resume()` (to avoid a huge dt spike from measuring against a
 * stale/absent previous frame timestamp). Exported so a later contract test
 * can assert against this exact constant rather than a magic number.
 */
export const FIXED_TICK_DT = 1 / 60;

export interface PlayControllerDeps {
  renderHost: RenderHost;
  /**
   * Read LAZILY on every `applyPointer` fan-out call, not cached at
   * `start()` time — a concurrent agent may call `registerAudioHost()` (or
   * equivalent) after play has already started.
   */
  getAudioHost?: () => AudioHost | undefined;
  /**
   * Returns the CURRENT `EditorDocument.json`. Called exactly once per
   * `start()`; the returned value is captured and later restored via
   * `renderHost.loadScene()` on `stop()` (PC-007).
   */
  getDocumentJson: () => unknown;
  getBinary?: () => ArrayBuffer | Uint8Array | undefined;
  /** Defaults to `createDefaultScheduler()` (rAF in a browser, a ~60fps setTimeout fallback in Node). */
  scheduler?: FrameScheduler;
}

/** Exported only so `PlayControllerImpl.getPlayState()`'s return type is nameable; not required by the `PlayController` interface. */
export type PlayState = "stopped" | "playing" | "paused";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * PC-002: pure id-vs-index mapping, extracted so it's unit-testable without
 * a real engine/graph — `ids[i]` is the declared KHR_interactivity graph
 * variable's `id` (when the graph declares one for that slot), else the
 * numeric index (as a string) is used as the key.
 */
export function buildVariablesRecord(
  variableCount: number,
  getValue: (index: number) => unknown,
  ids: ReadonlyArray<string | undefined> | undefined
): Record<string, unknown> {
  const variables: Record<string, unknown> = {};
  for (let i = 0; i < variableCount; i++) {
    const id = ids?.[i];
    variables[id ?? String(i)] = getValue(i);
  }
  return variables;
}

/**
 * PlayController: one fan-out `SceneAdapter.applyPointer -> renderHost ‖
 * audioHost` (PC-001). Play mode never edits the document directly — only
 * `stop()`'s `renderHost.loadScene(capturedJson)` restore touches the
 * viewport's document state (PC-003/PC-007).
 *
 * Exported (beyond the minimum public API) so callers that specifically
 * want the non-interface `getPlayState()` getter can reach it, e.g. via
 * `createPlayController(deps) as PlayControllerImpl` — see `getPlayState`'s
 * own doc comment.
 */
export class PlayControllerImpl implements PlayController {
  readonly #deps: PlayControllerDeps;
  readonly #scheduler: FrameScheduler;
  readonly #handlers = new Set<(diagnostic: PlayDiagnostic) => void>();

  #state: PlayState = "stopped";
  #host: EngineHost | null = null;
  #capturedDocumentJson: unknown = undefined;
  #frameHandle: number | null = null;
  #lastFrameTime: number | null = null;

  constructor(deps: PlayControllerDeps) {
    this.#deps = deps;
    this.#scheduler = deps.scheduler ?? createDefaultScheduler();
  }

  /** Non-interface convenience getter for debugging/tests — not part of `PlayController`. */
  getPlayState(): PlayState {
    return this.#state;
  }

  /** PC-001/PC-004/PC-006: rejects (without mutating play state) if already playing/paused. */
  async start(options: PlayStartOptions): Promise<void> {
    if (this.#state !== "stopped") {
      throw new Error("PlayController.start: already playing/paused — call stop() and await it before restarting (PC-006).");
    }

    const documentJson = this.#deps.getDocumentJson();
    const binary = this.#deps.getBinary?.();
    const fanOut: PointerFanOut = (pointer, value) => this.#applyFanOut(pointer, value);

    // PC-004: engine construction failures reject start()'s promise with a
    // descriptive Error and leave #state/#host untouched (still "stopped",
    // still null) — nothing below this try block runs on failure.
    const host = await createEngineHost(options.engine, documentJson, binary, fanOut);
    host.engine.start();

    this.#host = host;
    this.#capturedDocumentJson = documentJson;
    this.#state = "playing";
    this.#lastFrameTime = null;
    this.#scheduleNextFrame();
  }

  /** PC-005: fan-out target for both `RenderHost.applyPointer` and (lazily-read) `AudioHost.applyPointer`; renderHost first, then audioHost. */
  #applyFanOut(pointer: string, value: number[] | boolean[] | number | boolean): void {
    try {
      this.#deps.renderHost.applyPointer(pointer, value);
    } catch (err) {
      this.#emitDiagnostic({ kind: "unhandled-pointer", message: toMessage(err), pointer });
    }

    const audioHost = this.#deps.getAudioHost?.();
    if (audioHost) {
      try {
        audioHost.applyPointer(pointer, value);
      } catch (err) {
        this.#emitDiagnostic({ kind: "unhandled-pointer", message: toMessage(err), pointer });
      }
    }
  }

  #scheduleNextFrame(): void {
    this.#frameHandle = this.#scheduler.requestFrame((now) => this.#onFrame(now));
  }

  #onFrame(now: number): void {
    // First frame after start()/resume() (#lastFrameTime === null): use
    // FIXED_TICK_DT rather than a huge dt spike measured against a stale or
    // absent previous timestamp.
    const dt = this.#lastFrameTime === null ? FIXED_TICK_DT : (now - this.#lastFrameTime) / 1000;
    this.#lastFrameTime = now;
    this.#tickEngine(dt);
    if (this.#state === "playing") {
      this.#scheduleNextFrame();
    }
  }

  #tickEngine(dtSeconds: number): void {
    if (!this.#host) return;
    try {
      this.#host.engine.advance(dtSeconds);
    } catch (err) {
      this.#emitDiagnostic({ kind: "engine-error", message: toMessage(err) });
    }
  }

  pause(): void {
    if (this.#state !== "playing") return;
    if (this.#frameHandle !== null) {
      this.#scheduler.cancelFrame(this.#frameHandle);
      this.#frameHandle = null;
    }
    this.#state = "paused";
  }

  resume(): void {
    if (this.#state !== "paused") return;
    this.#state = "playing";
    // Treat resume as a fresh "first frame" for dt-spike purposes — the
    // paused duration itself must not count as elapsed dt.
    this.#lastFrameTime = null;
    this.#scheduleNextFrame();
  }

  /** Only meaningful while paused: "playing" already auto-ticks, "stopped" has no engine. */
  tickOnce(): void {
    if (this.#state !== "paused") return;
    this.#tickEngine(FIXED_TICK_DT);
  }

  /** PC-003/PC-006/PC-007: idempotent; state moves to "stopped" before the restore is awaited. */
  async stop(): Promise<void> {
    if (this.#state === "stopped") return;

    if (this.#frameHandle !== null) {
      this.#scheduler.cancelFrame(this.#frameHandle);
      this.#frameHandle = null;
    }
    const documentJson = this.#capturedDocumentJson;
    this.#host = null;
    this.#state = "stopped";

    // Restores via the JSON captured at start() (PC-007) — NOT
    // renderHost.snapshot(). If loadScene rejects, this promise rejects too;
    // state has already moved to "stopped" regardless.
    await this.#deps.renderHost.loadScene(documentJson);
  }

  inspect(): PlayInspection {
    if (this.#state === "stopped" || !this.#host) {
      return { time: 0, variables: {}, sentEvents: [] };
    }
    const { engine, graph } = this.#host;
    const ids = graph.variables?.map((variable) => variable.id);
    return {
      time: engine.time,
      variables: buildVariablesRecord(engine.variableCount, (i) => engine.getVariableByIndex(i), ids),
      sentEvents: [...engine.sentEvents]
    };
  }

  onDiagnostic(handler: (diagnostic: PlayDiagnostic) => void): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  #emitDiagnostic(diagnostic: PlayDiagnostic): void {
    for (const handler of this.#handlers) {
      handler(diagnostic);
    }
  }

  /** PC-008: no-op while stopped; otherwise delegates straight to the active engine — both engine kinds share this exact surface. */
  fireSelect(nodeIndex: number, point: [number, number, number], rayOrigin?: [number, number, number]): void {
    if (this.#state === "stopped" || !this.#host) return;
    this.#host.engine.fireSelect(nodeIndex, point, rayOrigin);
  }

  fireHoverIn(nodeIndex: number, point?: [number, number, number]): void {
    if (this.#state === "stopped" || !this.#host) return;
    this.#host.engine.fireHoverIn(nodeIndex, point);
  }

  fireHoverOut(nodeIndex?: number): void {
    if (this.#state === "stopped" || !this.#host) return;
    this.#host.engine.fireHoverOut(nodeIndex);
  }
}

export function createPlayController(deps: PlayControllerDeps): PlayController {
  return new PlayControllerImpl(deps);
}
