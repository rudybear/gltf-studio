// Web Worker entry: runs esbuild-wasm's browser build off the main thread
// (docs/adr/0006-devtools-script-debugging.md's "lazy-loaded, off-thread,
// same weight discipline as this app's other heavy tools" — esbuild-wasm's
// multi-hundred-KB `.wasm` binary has no business in the main app bundle for
// a debug mode most play sessions never use). Vite's static `new
// Worker(new URL("./esbuild.worker.js", import.meta.url), { type: "module"
// })` detection (debug-transform.ts) is what gives this its own bundled
// chunk — same pattern packages/script-panel/src/parse.worker.ts already
// documents for ts-morph.
//
// Message contract: {id, code, sourcefile} -> {id, ok:true, code} |
// {id, ok:false, error}. Stateless and one-shot by design: debug-transform.ts
// constructs a fresh Worker per debug `start()` call and terminates it the
// instant its single response arrives (specs/ux-debugger.md UX-1501 — no
// idle Worker, and no esbuild-wasm instance, lingers between play sessions).
import { transformTsToDebugJs } from "./esbuild-transform.js";
// Vite's `?url` suffix resolves to the actual built asset URL (hashed,
// base-path-correct under /app/ in both dev and the built app — same
// base-path fix history as packages/app/index.html's `@gltfi/runtime-lib`
// import-map entry, see that file's own comment) rather than inlining the
// multi-hundred-KB wasm binary as a data: URI into this worker's own chunk.
import esbuildWasmUrl from "esbuild-wasm/esbuild.wasm?url";

export type EsbuildWorkerRequest = { id: number; code: string; sourcefile: string };
export type EsbuildWorkerResponse = { id: number; ok: true; code: string } | { id: number; ok: false; error: string };

// Minimal ambient shape for the classic-Worker global scope this module
// worker runs in (same minimal-declare approach as parse.worker.ts's own
// `self`, to avoid pulling in the WebWorker lib — which conflicts with this
// package's DOM lib).
declare const self: {
  postMessage(message: EsbuildWorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<EsbuildWorkerRequest>) => void): void;
};

self.addEventListener("message", (event: MessageEvent<EsbuildWorkerRequest>) => {
  const { id, code, sourcefile } = event.data;
  // worker:false — this whole module ALREADY runs inside its own dedicated
  // Worker (constructed by debug-transform.ts), so esbuild-wasm does not
  // need to spin up ANOTHER internal worker just to keep some other thread
  // responsive; running the wasm module directly on this already-isolated
  // thread is the simplest correct setup.
  transformTsToDebugJs(code, sourcefile, { wasmURL: esbuildWasmUrl, worker: false })
    .then((transformed) => self.postMessage({ id, ok: true, code: transformed }))
    .catch((err: unknown) => self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }));
});
