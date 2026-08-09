import { it } from "vitest";

// Tried once, as the milestone brief asked: does the compiled-engine path's
// `await import(blobUrl)` step (see engine-host.ts's buildCompiledEngine)
// work under plain Node — i.e. vitest's default `environment: "node"`
// (see this package's vitest usage via the repo-root vitest.config.ts)?
//
// No. A standalone probe script (constructing a `blob:` URL via
// `URL.createObjectURL(new Blob([...]))`, exactly what buildCompiledEngine
// does, then `await import(blobUrl)`) throws immediately:
//
//   Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in:
//   file, data, and node are supported by the default ESM loader. Received
//   protocol 'blob:'
//
// This is Node's own dynamic-import() implementation rejecting the `blob:`
// scheme outright (confirmed on Node 22.23.1) — not a bug in this package,
// @gltfi/runtime-lib, or @gltfi/emit-ts, and nothing in this package can
// paper over it (no polyfill exists for the default ESM loader; only a
// custom `--experimental-loader`/`module.register` hook could intercept
// `blob:` specifiers, which is out of scope for this package to add).
//
// The interpreter engine path (see play-controller.test.ts's end-to-end
// suite) needs no such loader and is fully testable in plain Node. The
// compiled engine path is only exercisable in a real browser, or a Vitest
// *browser-mode* project (see packages/engine-three/vitest.config.ts +
// its `@vitest/browser`/Playwright devDependencies for this repo's existing
// precedent). Whoever wires this package into
// packages/contract-tests/src/play-controller.ts's describePlayControllerContract
// for the "compiled" engine kind will need to decide node-vs-browser-mode
// for that specific suite — this package's own tests deliberately do not
// attempt it.
it.todo(
  "compiled engine path (buildCompiledEngine's dynamic import(blob:)) needs a browser or Vitest browser-mode environment — confirmed unsupported in plain Node, see comment above"
);
