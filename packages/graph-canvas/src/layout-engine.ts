// Owns the ELK layout worker's lifecycle for one mounted GraphView.
//
// Simplified from the source VS Code extension's version (which had to fetch
// the worker script and wrap it in a same-origin Blob to dodge a webview-only
// cross-origin Worker restriction): here the worker is loaded the standard
// Vite way, `new Worker(new URL("./layout.worker.js", import.meta.url), {
// type: "module" })` — Vite statically detects this pattern (in both dev and
// a production build) and emits/serves the worker as its own bundled chunk,
// no blob/CSP dance required.
//
// Fallback path unchanged in spirit: if the worker can't be constructed at
// all, or throws at runtime, fall back to elk-fallback.ts's synchronous
// main-thread ELK solver so the graph never renders permanently blank.
//
// One LayoutEngine per mounted GraphView; disposed on unmount/re-mount.

import type { ElkGraph, LayoutPositions } from "./elk-layout.js";

export type LayoutEngineMode = "elk" | "fallback";

type LayoutResponse = { graphIndex: number; positions: LayoutPositions } | { graphIndex: number; error: string };

export type LayoutEngineCallbacks = {
  onResult: (graphIndex: number, positions: LayoutPositions) => void;
  onError: (graphIndex: number, message: string) => void;
  /** Fired once, the moment the engine downgrades from "elk" (worker) to "fallback" (main thread). */
  onModeChange?: (mode: LayoutEngineMode) => void;
};

export class LayoutEngine {
  private mode: LayoutEngineMode = "elk";
  private worker: Worker | null = null;
  private disposed = false;
  private lastRequest: { graphIndex: number; elkGraph: ElkGraph } | null = null;

  constructor(private readonly callbacks: LayoutEngineCallbacks) {
    this.startWorker();
  }

  private startWorker(): void {
    try {
      const worker = new Worker(new URL("./layout.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<LayoutResponse>) => this.handleWorkerMessage(event.data);
      worker.onerror = (event: ErrorEvent) => this.downgradeToFallback(event.message || "layout worker runtime error");
      this.worker = worker;
    } catch (err) {
      this.downgradeToFallback(err instanceof Error ? err.message : String(err));
    }
  }

  private handleWorkerMessage(message: LayoutResponse): void {
    if (this.disposed) return;
    if ("error" in message) {
      this.callbacks.onError(message.graphIndex, message.error);
      return;
    }
    this.callbacks.onResult(message.graphIndex, message.positions);
  }

  private downgradeToFallback(reason: string): void {
    if (this.disposed || this.mode === "fallback") return;
    console.warn(`gltf-studio graph-canvas: ELK layout worker unavailable (${reason}); falling back to main-thread layout.`);
    this.mode = "fallback";
    this.worker?.terminate();
    this.worker = null;
    this.callbacks.onModeChange?.("fallback");
    if (this.lastRequest) {
      const { graphIndex, elkGraph } = this.lastRequest;
      void this.runFallback(graphIndex, elkGraph);
    }
  }

  private async runFallback(graphIndex: number, elkGraph: ElkGraph): Promise<void> {
    try {
      // Dynamic import so elkjs's solver only ever lands in a loaded chunk
      // when the worker path has actually failed — see elk-fallback.ts.
      const { layoutOnMainThread } = await import("./elk-fallback.js");
      const positions = await layoutOnMainThread(elkGraph);
      if (this.disposed) return;
      this.callbacks.onResult(graphIndex, positions);
    } catch (err) {
      if (this.disposed) return;
      this.callbacks.onError(graphIndex, err instanceof Error ? err.message : String(err));
    }
  }

  /** Requests layout for one graph. Safe to call before the worker has finished starting. */
  requestLayout(graphIndex: number, elkGraph: ElkGraph): void {
    this.lastRequest = { graphIndex, elkGraph };
    if (this.mode === "fallback") {
      void this.runFallback(graphIndex, elkGraph);
      return;
    }
    if (this.worker) {
      this.worker.postMessage({ graphIndex, elkGraph });
      return;
    }
    // Worker construction is synchronous in the constructor above (it either
    // succeeds or downgrades to fallback immediately) — by the time
    // requestLayout can be called, `this.worker` is set unless we already
    // downgraded, so there is no async "still starting" state to await here.
  }

  getMode(): LayoutEngineMode {
    return this.mode;
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
  }
}
