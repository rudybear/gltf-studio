// Client for esbuild.worker.ts (see that file for the "why a Worker" note):
// one-shot request/response over postMessage. A fresh Worker per call —
// unlike packages/script-panel/src/parse-client.ts's persistent
// per-ScriptPanel-mount worker (parsing happens on every keystroke), debug
// compiled-play starts at most once per play session, so a persistent
// worker + request-sequencer is unneeded lifecycle management; the worker
// is terminated the instant its single response arrives (specs/ux-debugger.md
// UX-1501).
import type { EsbuildWorkerRequest, EsbuildWorkerResponse } from "./esbuild.worker.js";

let nextId = 1;

/** Rejects if the worker itself fails to construct/run, or if the transform throws (e.g. a genuine TS syntax error in the emitted flavor-TS text). */
export function transformForDebug(code: string, sourcefile: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./esbuild.worker.js", import.meta.url), { type: "module" });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const id = nextId++;
    worker.onmessage = (event: MessageEvent<EsbuildWorkerResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      worker.terminate();
      if (message.ok) resolvePromise(message.code);
      else reject(new Error(message.error));
    };
    worker.onerror = (event: ErrorEvent) => {
      worker.terminate();
      reject(new Error(event.message || "esbuild worker runtime error"));
    };
    worker.postMessage({ id, code, sourcefile } satisfies EsbuildWorkerRequest);
  });
}
