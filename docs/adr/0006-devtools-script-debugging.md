# 6. Real DevTools debugging of compiled play, via a source-mapped flavor-TS build

Status: active

## Context

`packages/play`'s compiled engine path (`engine-host.ts`'s `buildCompiledEngine`) already turns a
`KHR_interactivity` graph into runnable JavaScript: `importGraph` (`@gltfi/ir`) -> `checkModule` ->
`emitModule(module, { flavor: "js" })` (`@gltfi/emit-ts`) -> a `blob:` module URL -> dynamic
`import()` -> the module's default-exported `EngineFactory`. That JS is real, but it is minified-
shape, un-mapped, and disposable — a `blob:` URL with no name a human would recognize, and no way
back to the graph that produced it. A creator who wants to understand *why* their compiled play
session is behaving unexpectedly today has exactly one tool: the interpreter engine's own
diagnostics (`PlayController.onDiagnostic`) and `inspect()`'s live variable dump — neither shows
control flow, neither lets you pause mid-tick, and neither exists at all for the compiled engine's
own execution.

Separately, `packages/script-panel`'s Script tab (`specs/ux-script.md`) already renders a *different*
emission of the same graph — `emitModule(module, { flavor: "ts" })`, real, readable "GIscript"
source text with named accessors (`V.counter`, `rt.onTick(...)`) — for editing, not for running. The
Script tab's flavor-TS text and the compiled engine's flavor-JS text come from the same `IRModule`
but are, today, two independently-emitted artifacts with no guaranteed correspondence beyond "both
describe the same graph."

The goal of this decision (program-plan phase D1, "script debugging spine") is: while playing with
the compiled engine, a creator can open the browser's own DevTools, find their Script-tab text under
Sources, set a real breakpoint, and step through it — the actual TypeScript debugger, not a
bespoke one this project would have to build and maintain.

## Decision

**Debug builds of the compiled engine emit flavor-TS (byte-identical to what the Script tab
displays) and transform it in-browser via `esbuild-wasm`, producing real JavaScript plus a real
inline source map, loaded under a stable virtual `sourceURL` so DevTools' Sources panel shows the
user's own script.**

Concretely:

- **Text identity is a mechanism, not a promise.** `packages/play` does not re-derive or
  re-implement "graph -> TS text" — it calls the exact same function `packages/script-panel`'s
  Script tab already calls (`buildEmitView`, now reachable via a new `@gltf-studio/script-panel/
  emit-view` subpath export, mirroring the precedent `@gltfi/parse-ts`'s own `./runtime-lib-dts`
  subpath already set for exactly this "let another package reach one lightweight function without
  pulling in the whole package" reason). Given the same graph, `buildEmitView(graph, 0).code` is a
  pure function of that graph's contents — called from either package, it produces the same string.
  This is what makes the debug source map *truthful*: the text a breakpoint is set against is
  provably the text the Script tab shows, not a lookalike.
- **`esbuild-wasm`, not a hand-rolled TS-to-JS stripper.** The flavor-TS text is real TypeScript (it
  carries type annotations the flavor-JS emission doesn't); something has to turn it into JS the
  browser can execute. `esbuild-wasm`'s `transform()` does exactly this, in one call, with
  `sourcemap: "inline"` producing a real, standards-shaped source map (`sources`, `sourcesContent`,
  VLQ `mappings`) with no extra plumbing.
- **Lazy-loaded, off-thread, same weight discipline as this app's other heavy tools.** `esbuild-wasm`
  ships a multi-hundred-KB `.wasm` binary — no business in the main app bundle for a mode most play
  sessions never use. It is loaded only inside a new `esbuild.worker.ts` Worker chunk, constructed
  lazily (only when `start({ debug: true })` is actually called), mirroring `packages/script-panel`'s
  own `parse.worker.ts` (ts-morph) and `monaco-setup.ts` (Monaco) lazy-chunk precedent — and verified
  the same way that precedent is: a bundle-chunk assertion against the *built* app
  (`packages/app/src/bundle-chunks.test.ts`), not a guess about source structure.
- **A stable virtual `sourceURL`, not the `blob:` URL DevTools would otherwise show.** The compiled
  module (JS + inline source map) is loaded from a `blob:` URL exactly as the non-debug path already
  does — but its text ends with `//# sourceURL=gltf-studio:///behavior/graph0.ts`, a literal string
  identical to the source map's own `sources[0]` entry. This does two things at once: it gives the
  *running, compiled* script itself a stable, human-legible name DevTools reports in
  `Debugger.scriptParsed.url` (instead of an opaque one-time `blob:...` URL that changes every play
  session), and — because it matches the sourcemap's own `sources[0]` — it is also the name DevTools'
  Sources panel groups the pretty, source-mapped TypeScript under. `gltf-studio:///behavior/graph{N}.ts`
  is deliberately styled as an absolute URL (a fake but syntactically valid origin) rather than a bare
  relative path, so DevTools treats it as its own tree entry rather than trying to resolve it against
  the page's real origin.
- **Readable emission is what makes DevTools scopes worth looking at.** This decision adds no new
  emission mode — it reuses flavor-TS's already-readable identifier scheme (`V.*` variable
  accessors, real `rt.on*`/`m.*` proc names, per `specs/ux-script.md`'s emit-view contract) precisely
  *because* that's what makes a DevTools scope/watch panel legible for this code, not a wall of `_0`/
  `_1` temporaries a minifier would produce.
- **A play-bar toggle, not a third engine.** `PlayStartOptions` gains an optional `debug` flag
  (`specs/engine-api.md` `PC-009`); it is only meaningful when `engine === "compiled"` and is a
  no-op (never throws, never silently activates) otherwise. The interpreter engine is completely
  unaffected by this decision — it has no compile step to debug in the first place, and no code path
  introduced here executes when `engine === "interpreter"`.
- **DevTools-based pause/step/inspect, not a custom stepper.** This is the deliberate v1 scope line:
  D1 ships the plumbing that makes the REAL debugger usable (source, source map, stable naming) and
  nothing else — no gutter breakpoints inside this app's own UI, no "paused on this graph node"
  highlight, no Break-here affordance. Those (D2/D3 in the program plan) are additive UI sitting on
  top of this same pipeline, not a different pipeline.

## Alternatives rejected

- **A custom, in-app stepper for the compiled/interpreted graph.** Rebuilding pause/step/scope-
  inspection/call-stack UI from scratch inside this app would be a large, ongoing maintenance
  surface duplicating what the browser already ships, tests, and ships security/perf fixes for —
  for a strictly worse result (a bespoke debugger nobody already knows how to use, versus the actual
  DevTools every web developer already has muscle memory for).
- **CDP self-debugging (the page attaching a debugger to itself).** The Chrome DevTools Protocol's
  `Debugger` domain is inspector-side, not exposed to page JavaScript — there is no in-page API for
  "pause my own execution and let me inspect it," short of literal `debugger;` statements (which this
  project's e2e suite in fact uses, via a real *external* CDP session, exactly because the page
  cannot do this to itself). A real debugging experience has to be the browser's own external
  DevTools attaching to the page, which is what this decision's whole pipeline is built to make
  possible and legible.
- **Interpreter instrumentation (step/pause hooks inside `@gltfi/runtime`'s `InteractivityRuntime`).**
  This would produce a graph-node-level stepper, not a *script* debugger — useful for a future
  graph-visual "paused here" affordance (D2/D3's own territory), but not what this task asked for:
  the user's actual TypeScript, in the actual TypeScript debugger. It also does nothing for the
  compiled engine, which has no interpreter loop to instrument in the first place.

## Consequences

- **The text-identity guarantee is exactly as strong as "these two call sites call the same
  function"** — verified by a unit test that feeds a real graph through `buildEmitView` and asserts
  the debug pipeline's decoded `sourcesContent[0]` matches that output byte-for-byte, and by the
  CDP e2e test decoding the *actual served* script's inline source map at runtime and comparing it
  against the Script tab's own rendered text. If `buildEmitView`'s emission ever changes shape, both
  call sites change together automatically (there is only one implementation), so there is no
  future PR that can accidentally let them drift.
- **`packages/play` now depends on `@gltf-studio/script-panel`.** This is a new, deliberately narrow
  dependency edge (one subpath, `./emit-view`, carrying no `monaco-editor`/React/`ts-morph` weight)
  from an engine-execution package onto a UI-editing package's shared emit logic — the "shared code,
  not shared UI" version of the dependency, not a circular one (script-panel does not, and per this
  decision must not, depend on play).
- **Debug play still restores `PlayController.stop()`'s exact non-debug guarantees** (`PC-003`/
  `PC-007`) — the debug flag changes only how the compiled module's *code* is produced, never the
  fan-out, tick loop, or stop/restore behavior any other test already covers.
- **Honest gaps, explicitly deferred, not silently dropped:**
  - No gutter breakpoints inside this app's own Script tab UI (D2) — a creator sets breakpoints in
    real DevTools today, not by clicking a line number in this app.
  - No "paused here" graph-canvas badge (D2/D3) — pausing in DevTools does not (yet) highlight
    anything in this app's own graph canvas.
  - No "Break here" authoring affordance (D3).
  - Audio-script construction (`specs/ux-audio-script.md`, `@gltf-audiograph/*`) is out of scope for
    D1 entirely — this decision covers the interactivity Script tab's compiled play only; audio-graph
    playback has no compiled-engine debug path at all yet.
  - `esbuild-wasm`'s Node-side entry point (used only by this repo's own unit tests, never shipped)
    and its browser entry point are different code paths inside `esbuild-wasm` itself (Node spawns a
    child process; the browser build takes a `wasmURL` + runs in-page/in-worker) — this decision's
    own transform logic is factored so both call the identical `transform()`/`initialize()` options
    contract, but it is `esbuild-wasm` upstream, not this repo, that guarantees those two entry
    points behave identically for a given input.
