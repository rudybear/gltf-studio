// Owns the parse Worker's lifecycle for one mounted AudioScriptPanel — the
// audio sibling of @gltf-studio/script-panel's parse-client.ts, same shape:
// lazy-created on first use, one instance per mount, disposed on unmount,
// with the monotonic-id / staleness-cancellation protocol
// (request-sequencer.ts). No main-thread fallback, same rationale as the
// interactivity side.
import type { AudioIRModule, Diagnostic } from "@gltf-audiograph/ir";
import { RequestSequencer } from "./request-sequencer.js";
import type { AudioParseWorkerRequest, AudioParseWorkerResponse } from "./parse.worker.js";

export type AudioParseClientResult = { module: AudioIRModule; diagnostics: Diagnostic[] };

export type AudioParseClientCallbacks = {
  onResult: (result: AudioParseClientResult) => void;
  onError: (message: string) => void;
};

export class AudioParseClient {
  private worker: Worker | null = null;
  private readonly sequencer = new RequestSequencer();
  private disposed = false;

  constructor(private readonly callbacks: AudioParseClientCallbacks) {
    this.startWorker();
  }

  private startWorker(): void {
    try {
      const worker = new Worker(new URL("./parse.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<AudioParseWorkerResponse>) => this.handleMessage(event.data);
      worker.onerror = (event: ErrorEvent) => this.callbacks.onError(event.message || "audio parse worker runtime error");
      this.worker = worker;
    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  private handleMessage(message: AudioParseWorkerResponse): void {
    if (this.disposed) return;
    if (!this.sequencer.isLatest(message.id)) return; // stale — a newer request has since been sent.
    if (message.ok) {
      this.callbacks.onResult({ module: message.module, diagnostics: message.diagnostics });
    } else {
      this.callbacks.onError(message.error);
    }
  }

  /** Requests a parse of `code`; any still-in-flight older request's eventual response is dropped. */
  request(code: string): void {
    const id = this.sequencer.next();
    this.worker?.postMessage({ id, code } satisfies AudioParseWorkerRequest);
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
  }
}
