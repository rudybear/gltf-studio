// Owns the parse Worker's lifecycle for one mounted ScriptPanel — same
// shape as graph-canvas's layout-engine.ts (LayoutEngine over
// layout.worker.ts): lazy-created on first use, one instance per mount,
// disposed on unmount. Adds the monotonic-id / staleness-cancellation
// protocol (specs/ux-script.md UX-709) via request-sequencer.ts: a response
// to a request superseded by a newer one (the user kept typing) is dropped
// rather than clobbering a fresher, still-in-flight result.
//
// No main-thread fallback (unlike LayoutEngine's elk-fallback.ts): parsing
// is edit-time-only diagnostic feedback, not something the page needs to
// keep working without — if the worker can't be constructed at all, or
// crashes, this just reports an error once via `onError` and stays broken
// for that mount rather than falling back to running ts-morph (a large,
// synchronous, main-thread-blocking parse) on the UI thread.
import type { Diagnostic, IRModule } from "@gltfi/ir";
import { RequestSequencer } from "./request-sequencer.js";
import type { ParseWorkerRequest, ParseWorkerResponse } from "./parse.worker.js";

export type ParseClientResult = { module: IRModule; diagnostics: Diagnostic[] };

export type ParseClientCallbacks = {
  onResult: (result: ParseClientResult) => void;
  onError: (message: string) => void;
};

export class ParseClient {
  private worker: Worker | null = null;
  private readonly sequencer = new RequestSequencer();
  private disposed = false;

  constructor(private readonly callbacks: ParseClientCallbacks) {
    this.startWorker();
  }

  private startWorker(): void {
    try {
      const worker = new Worker(new URL("./parse.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => this.handleMessage(event.data);
      worker.onerror = (event: ErrorEvent) => this.callbacks.onError(event.message || "parse worker runtime error");
      this.worker = worker;
    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  private handleMessage(message: ParseWorkerResponse): void {
    if (this.disposed) return;
    if (!this.sequencer.isLatest(message.id)) return; // stale — a newer request has since been sent.
    if (message.ok) {
      this.callbacks.onResult({ module: message.module, diagnostics: message.diagnostics });
    } else {
      this.callbacks.onError(message.error);
    }
  }

  /** Requests a parse of `code`; any still-in-flight older request's eventual response is dropped (UX-709). */
  request(code: string): void {
    const id = this.sequencer.next();
    this.worker?.postMessage({ id, code } satisfies ParseWorkerRequest);
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
  }
}
