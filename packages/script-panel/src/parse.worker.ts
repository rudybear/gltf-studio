// Web Worker entry: runs `@gltfi/parse-ts`'s `parseModule` off the UI thread
// (specs/ux-script.md UX-709). This is the ONLY module in the package that
// imports `@gltfi/parse-ts` — ts-morph (parse-ts's real dependency) is a
// multi-hundred-KB parser/type-checker that has no business in the app's
// main bundle; Vite's static `new Worker(new URL("./parse.worker.js",
// import.meta.url), { type: "module" })` detection (parse-client.ts) is
// what gives this its own bundled chunk, exactly like graph-canvas's
// layout.worker.ts already does for elkjs — see that file's header comment
// for the pattern this mirrors.
//
// Message contract: {id, code} -> {id, ok:true, module, diagnostics} |
// {id, ok:false, error}. `id` is the requester's own monotonic-id protocol
// value (request-sequencer.ts) — this worker itself is stateless and simply
// echoes it back; staleness cancellation happens entirely on the client
// side (parse-client.ts), since a response for an outdated `id` might still
// be usefully cheap to compute here but must never be ACTED on there.
import { parseModule } from "@gltfi/parse-ts";
import type { Diagnostic, IRModule } from "@gltfi/ir";

export type ParseWorkerRequest = { id: number; code: string };
export type ParseWorkerResponse =
  | { id: number; ok: true; module: IRModule; diagnostics: Diagnostic[] }
  | { id: number; ok: false; error: string };

// Minimal ambient shape for the classic-Worker global scope this module
// worker runs in (same minimal-declare approach as graph-canvas's
// layout.worker.ts, to avoid pulling in the WebWorker lib — which conflicts
// with this package's DOM lib, needed for its React/Monaco side).
declare const self: {
  postMessage(message: ParseWorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ParseWorkerRequest>) => void): void;
};

self.addEventListener("message", (event: MessageEvent<ParseWorkerRequest>) => {
  const { id, code } = event.data;
  try {
    const { module, diagnostics } = parseModule(code);
    self.postMessage({ id, ok: true, module, diagnostics });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
