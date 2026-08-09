// Web Worker entry: runs ELK layout off the UI thread. Built by Vite as a
// standard module worker (see layout-engine.ts's `new Worker(new URL(...),
// { type: "module" })` — no VS Code CSP/blob workaround needed here, this is
// a plain browser Worker loaded from same-origin Vite-built asset).
//
// This is the ONLY module that imports elkjs's bundled, worker-free solver
// build (`elk.bundled.js` runs the layout algorithm synchronously in
// whatever JS context loads it, so no nested Worker/workerFactory is needed
// here). elk-layout.ts (imported for its pure, elkjs-free
// buildElkGraph/extractPositions helpers) is shared with the main bundle and
// vitest tests, but this file — and only this file — pulls in the actual
// solver for the worker-thread path (elk-fallback.ts pulls in the same
// solver for the main-thread fallback path).
//
// Message contract: {graphIndex, elkGraph} -> {positions}.

import ElkConstructor from "elkjs/lib/elk.bundled.js";
import { extractPositions, type ElkGraph, type LayoutPositions } from "./elk-layout.js";

type LayoutRequest = { graphIndex: number; elkGraph: ElkGraph };
type LayoutResponse = { graphIndex: number; positions: LayoutPositions } | { graphIndex: number; error: string };

// Minimal ambient shape for the classic-Worker global scope this module
// worker runs in.
declare const self: {
  postMessage(message: LayoutResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<LayoutRequest>) => void): void;
};

// Workaround (ported from the source VS Code extension, where it was found
// regression-testing against a REAL headless-browser Worker — not VS-Code
// specific): elkjs's internal lib/elk-worker.js self-registers as its OWN
// standalone Worker's message handler whenever `typeof document ===
// "undefined" && typeof self !== "undefined"` — exactly the environment a
// real dedicated Worker global scope has (this module IS one). elk.bundled.js
// lazily `require()`s that same file the first time `new ElkConstructor()`
// runs, to get a synchronous same-thread "FakeWorker" class — but inside a
// real Worker, elk-worker.js's self-registration branch wins by mistake,
// making `new ElkConstructor()` throw "... is not a constructor" instead. A
// dummy `document` global — elk-worker.js's ONLY signal for "am I a
// standalone worker script" — makes it take the correct (FakeWorker) branch
// instead, matching what a plain Node `require()` (no `self`) already does
// implicitly.
(self as unknown as { document?: unknown }).document ??= {};

const elk = new ElkConstructor();

self.addEventListener("message", (event: MessageEvent<LayoutRequest>) => {
  const { graphIndex, elkGraph } = event.data;
  elk
    .layout(elkGraph)
    .then((result) => {
      self.postMessage({ graphIndex, positions: extractPositions(result) });
    })
    .catch((err: unknown) => {
      self.postMessage({ graphIndex, error: err instanceof Error ? err.message : String(err) });
    });
});
