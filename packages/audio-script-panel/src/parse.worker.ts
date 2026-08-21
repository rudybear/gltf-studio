// Web Worker entry: runs `@gltf-audiograph/parse-ts`'s `parseAudioModule` off
// the UI thread (specs/ux-audio-script.md UX-1400) — the audio sibling of
// @gltf-studio/script-panel's parse.worker.ts. This is the ONLY module in
// the package that imports `@gltf-audiograph/parse-ts` — ts-morph (its real
// dependency) is a multi-hundred-KB parser/type-checker that has no
// business in the app's main bundle; Vite's static `new Worker(new
// URL("./parse.worker.js", import.meta.url), { type: "module" })` detection
// (parse-client.ts) is what gives this its own bundled chunk, verified by
// this package's own bundle-chunks.test.ts extension (packages/app).
//
// Message contract: {id, code} -> {id, ok:true, module, diagnostics} |
// {id, ok:false, error}. `id` is the requester's own monotonic-id protocol
// value (request-sequencer.ts) — this worker itself is stateless and simply
// echoes it back; staleness cancellation happens entirely on the client
// side (parse-client.ts).
import { parseAudioModule } from "@gltf-audiograph/parse-ts";
import type { AudioIRModule, Diagnostic } from "@gltf-audiograph/ir";

export type AudioParseWorkerRequest = { id: number; code: string };
export type AudioParseWorkerResponse =
  | { id: number; ok: true; module: AudioIRModule; diagnostics: Diagnostic[] }
  | { id: number; ok: false; error: string };

// Minimal ambient shape for the classic-Worker global scope this module
// worker runs in — copied verbatim from script-panel's parse.worker.ts (same
// reason: avoids pulling in the WebWorker lib, which conflicts with this
// package's DOM lib needed for its React/Monaco side).
declare const self: {
  postMessage(message: AudioParseWorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<AudioParseWorkerRequest>) => void): void;
};

self.addEventListener("message", (event: MessageEvent<AudioParseWorkerRequest>) => {
  const { id, code } = event.data;
  try {
    const { module, diagnostics } = parseAudioModule(code);
    self.postMessage({ id, ok: true, module, diagnostics });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
