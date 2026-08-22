# ux-debugger

`docs/adr/0006-devtools-script-debugging.md`'s D1 "script debugging spine": source-mapped compiled
play, so the browser's real DevTools debugger shows and can pause/step the user's own Script-tab
TypeScript. This file owns the `UX-1500` block — the play-bar entry point itself
(`playbar.debug-toggle`) is `specs/ux-shell.md` `UX-130`'s to own, per that file's own
"entry point here, content in the owning file" split.

Owns: no dedicated `specs/ownership.json` glob yet (same "governed indirectly via `packages/app/**`'s
catch-all, and `packages/play/**`'s own `specs/engine-api.md` mapping" position `specs/ux-viewport.md`
documents for itself — this surface spans both).

Prefix: `UX`. This file owns the `UX-15xx` block.

## Requirements

### Toggle enablement and scope

- [UX-1500] (active) The Debug toggle (`specs/ux-shell.md` `UX-130`'s `playbar.debug-toggle`) is meaningful only for the compiled engine: with `playbar.engine-picker` set to `"interpreter"`, the toggle is disabled and its tooltip reads "Debugging needs the compiled engine — switch engine to enable." regardless of the toggle's own last-set checked value; switching the engine picker back to `"compiled"` re-enables it at whatever checked state it last held (the checked state itself is never cleared by an engine switch, only its enablement).
- [UX-1501] (active) Enabling the toggle costs nothing until Play actually starts with it checked: no `esbuild-wasm` module, worker, or `.wasm` fetch is created merely by checking the toggle — the debug transform pipeline (`packages/play`'s `esbuith.worker.ts` equivalent Worker chunk) is constructed lazily, the first time `PlayController.start({ engine: "compiled", debug: true })` (`PC-009`) actually runs, exactly once per play session, and torn down when that transform completes (a fresh Worker per debug `start()` call — no idle Worker lingers between play sessions).

### Virtual file naming and DevTools visibility

- [UX-1502] (active) A debug compiled-play session's script is addressable in DevTools' Sources panel under the stable name `gltf-studio:///behavior/graph0.ts` (`PlayController` only ever resolves `graphs[0]`, `engine-host.ts`'s `resolveGraphOrThrow` — so today this is always graph index 0; the `graph{N}.ts` naming scheme is index-parameterized in the implementation for whenever a document-level "which graph plays" choice exists) — never the raw, one-time `blob:...` URL the underlying `import()` call resolves against. This holds regardless of which project or graph is playing: the name is stable across play sessions of the SAME graph index (re-Playing shows the same Sources entry, not a new one each time), so a creator can leave DevTools' Sources panel open, set a breakpoint once, Stop, edit, and Play again without re-finding/re-setting it.
- [UX-1503] (active) The debug session's source, as DevTools shows it (i.e. the source map's own `sourcesContent[0]`, not the transformed JS `Debugger.getScriptSource` returns for the running script) is byte-identical to what the Script tab (`specs/ux-script.md`) displays for that same graph at that same moment — including `emit-view.ts`'s leading provenance comment (`UX-705`). This is a mechanical guarantee (`docs/adr/0006`'s "text identity is a mechanism, not a promise" — both surfaces call the same `buildEmitView`), not a best-effort approximation: if the Script tab and the debug session's shown source ever diverge for the same graph, that is a bug in this guarantee, not an acceptable approximation.

### Play overlay hint

- [UX-1504] (active) While play is `playing` or `paused` with the current session started in debug mode (`PC-009`'s `debug: true`, compiled engine only), the viewport's play overlay (`specs/ux-viewport.md`'s `viewport.play-overlay`) shows an additional hint row (`viewport.play-overlay.debug-hint`) reading "Debuggable — open DevTools → Sources → gltf-studio://" — present for the debug session's entire playing/paused lifetime, gone the instant `playState` returns to `"stopped"` (same visibility rule the rest of the overlay already follows) and absent entirely for a non-debug or interpreter-engine play session (checking the toggle after Play has already started has no effect on an in-progress session — `UX-1500`/`PC-009` are both read only at `start()`).

### Gutter breakpoints (D2)

- [UX-1505] (active) The Script tab's Monaco buffer (`specs/ux-script.md`) gains a clickable glyph margin: clicking it toggles a session-only breakpoint (a red dot) at that line, for the CURRENTLY SHOWN `graphIndex`. Breakpoints are stored per graph index (`app-store.ts`'s `scriptBreakpoints`), never persisted across a reload, and are honored only at the NEXT debug compiled-play `start()` (`PC-010`) — toggling one while a session is already `playing`/`paused` has no effect on that running session, only on the next one. The mechanism is **injection, not a live CDP `setBreakpointByUrl` call**: `packages/play`'s `injectBreakpoints` inserts a literal `debugger;` statement immediately before each requested line in the flavor-TS text, BEFORE it is handed to `esbuild-wasm` (so the transform's own inline source map — and therefore `UX-1503`'s text-identity guarantee — accounts for the injected lines honestly, not as a hidden side channel). **Honesty note**: the virtual file DevTools' Sources panel shows for a session with breakpoints set VISIBLY contains these injected `debugger;` lines — this is the actual running/authored text, not a lie a source map papers over; a creator who diffs the Script tab's plain (un-injected) display against a debug session with breakpoints set will see the difference, and that difference is real, not a bug. Multiple breakpoints inject correctly regardless of order (`injectBreakpoints` processes descending-line-first so earlier insertions never shift a later, still-to-process line out from under it).

### Graph-canvas breakpoint badges (D2)

- [UX-1506] (active) `specs/ux-graph-canvas.md`'s graph-node card additionally renders a small red corner badge (distinct corner from the validation `!` badge, `UX-506`; both can show at once) when that node's resolved emitted-script line currently holds a session breakpoint. Resolution reuses the SAME node → line lookup `UX-712`/`UX-1108`'s cross-highlight already performs (`@gltf-studio/script-panel`'s `findHighlightForNode`) — a node with no resolvable line (a `temp`-kind construct, or an unresolved/templated pointer path, per that lookup's own documented fidelity gap) simply shows no badge; this is the same honest gap, not a new one. The badge's tooltip reads "Breakpoint (debug play)".

### "Break here" (D2)

- [UX-1507] (active) The graph-node details card (`specs/ux-graph-canvas.md` `UX-507`) gains a "Break here" button: clicking it resolves the selected node's emitted-script line (the SAME `UX-1506` lookup) and sets a breakpoint there (an idempotent ADD — distinct from the gutter's toggle) — the gutter dot and the `UX-1506` badge both appear immediately. When the selected node has no resolvable line, the button is disabled with a tooltip explaining why (mirrors `specs/ux-usage-mapping.md` `UX-1114`'s disabled-state precedent for an unmappable → Script jump target) rather than silently doing nothing on click.

### Debug-affordance discoverability (D2)

- [UX-1508] (active) Clicking Play while `scriptBreakpoints[0]` (the ONLY graph index a play session can ever run, `PC-009`'s `graphs[0]` scope) is non-empty, but the session about to start would never hit any of them, shows a one-time toast at that Play click (not a persistent banner): under the compiled engine with Debug unchecked, "N breakpoint(s) set — enable Debug to hit them"; under the interpreter engine (which has no compile step, and therefore nothing to inject a breakpoint into, regardless of the Debug toggle's own checked state), "N breakpoint(s) set — switch to the compiled engine with Debug enabled to hit them." No toast fires when the about-to-start session WOULD honor them (compiled + Debug checked), nor when no breakpoints are set on graph 0. While a debug session with `N > 0` breakpoints is `playing`/`paused`, the `UX-1504` play-overlay additionally shows a second row, `viewport.play-overlay.debug-hint.breakpoints` ("N breakpoint(s) set for this session") — a SEPARATE row from `UX-1504`'s own hint (whose exact text an existing e2e assertion checks verbatim), reflecting the count actually captured at THAT session's `start()` (`PC-010`), not a live view of `scriptBreakpoints` (which may keep changing while the session runs, per `UX-1505`'s "next start only" rule).

### Audio-script "Debug audition" (D3)

- [UX-1509] (active) Audio scripts do **not** execute at Play time — the audio graph a play session actually runs comes straight from the document's `KHR_audio_graph` JSON (`AudioGraphHost`/AudioGraphJS's `buildGraph`), never from calling the authored `(a: AudioScript) => void` module function. D1/D2's whole compiled-play debug pipeline therefore has no "play" of the audio script to attach to. Investigated for this decision: the vendored `@gltf-audiograph/runtime-lib` DOES ship a real, executable `AudioScript` implementation — `createAudioScriptRecorder()` — whose methods (`a.gain()`, `a.source()`, ...) synchronously record themselves and whose `toGraph()` reconstructs the `KHR_audio_graph` shape from what was recorded; this is a genuine "builder that runs the module function to construct a graph," not a static analysis. The Audio Script tab therefore gains its own gutter breakpoints (mirrors `UX-1505`, a separate `audioScriptBreakpoints` store slot — Audio Script tab breakpoints and interactivity Script tab breakpoints are independent address spaces) and a "Debug audition" toolbar action (`audio-script.debug-audition`): it takes the tab's CURRENT buffer text, runs it through the identical `injectBreakpoints` → `esbuild-wasm transform` → stable virtual `//# sourceURL=` pipeline `packages/play` already built for D1/D2 (`buildDebugModuleSource`, reused verbatim, under the sibling virtual name `gltf-studio:///audio/graph{N}.ts`), and executes the resulting module function against a real `createAudioScriptRecorder()`. A `debugger;` statement (an audio-script gutter breakpoint) or a real DevTools breakpoint set against that virtual name genuinely pauses INSIDE the running module-function body, at real construction time — audio graphs have no tick loop to pause mid-frame, so this is a one-shot "run construction now" action (`onClick`), not a persistent play session. Failure (a script bug, a transform error) surfaces as a toast + console-log error, exactly like every other action in this dock layer, rather than a silent no-op. This is the honest scope this investigation actually supports — no fake "Play" affordance was added for audio scripts, and none is implied by this action's own name or placement.

## Implementation notes

- `packages/play/src/debug-source.ts`'s `debugVirtualSourceUrl(graphIndex)` is the ONE place the
  `gltf-studio:///behavior/graph{N}.ts` naming scheme is spelled out — `engine-host.ts` (the
  `//# sourceURL=`/source-map `sources[0]` value) and `packages/app`'s `PlayOverlay.tsx` (the
  `UX-1504` hint's own copy) both import it rather than restating the literal string, so the two
  can never drift out of sync with each other.
- `esbuild-wasm`'s `.wasm` binary and its Worker wrapper (`packages/play/src/esbuild.worker.ts`) are
  asset-resolved through Vite's `?url` suffix (same base-path-correctness requirement, and the same
  fix history, as `packages/app/index.html`'s `@gltfi/runtime-lib` import-map entry — see that file's
  own comment) so the wasm binary loads correctly whether the app is served at `/app/` (local dev/
  preview) or `/<repo>/app/` (the deployed Pages site).
- D1 deliberately shipped no gutter breakpoints inside this app's own Script tab UI, no graph-canvas
  "paused here" badge, and no "Break here" authoring affordance — see `docs/adr/0006`'s Consequences
  for the original full list. **D2 (`UX-1505`..`UX-1508`) and D3 (`UX-1509`) now ship all of it**:
  `docs/adr/0006`'s own text is left as the historical record of what D1 alone shipped, not amended
  in place — this file (the living spec) is where the CURRENT, post-D2/D3 contract lives. The one gap
  `docs/adr/0006` listed that stays a gap even after D3: audio-script debugging is construction-time
  only (`UX-1509`) — there is still no "paused here" AUDIO-canvas badge or "Break here" action on audio
  graph nodes (only interactivity graph nodes get `UX-1506`/`UX-1507`), since D3's own scope was
  "investigate + ship if honest," not a full port of D2's canvas-integration bullets to the audio side.
- `packages/play/src/debug-breakpoints.ts`'s `injectBreakpoints(tsText, lines)` is the ONE place the
  `debugger;`-injection mechanism (`UX-1505`) is implemented — `engine-host.ts`'s `buildDebugModule`
  (via the shared `debug-compose.ts`'s `buildDebugModuleSource`) and `packages/app`'s
  `audio-debug-audition.ts` (`UX-1509`) both call through it rather than re-implementing "insert a
  line before a 1-based line number" independently.
- `packages/app/src/lib/script-breakpoints.ts` is the ONE place `UX-1506`'s graph-node → breakpoint-
  line resolution is implemented — `BehaviorGraphPanel.tsx`'s canvas-badge wiring and its "Break here"
  (`UX-1507`, via `app-store.ts`'s `breakHereOnNode`) both call through it, reusing
  `@gltf-studio/script-panel`'s `./emit-view`/`./cross-highlight` narrow subpaths (the SAME "reach one
  lightweight function without pulling in monaco-editor/React" precedent `docs/adr/0006` established
  for `packages/play`'s identical dependency edge — `BehaviorGraphPanel.tsx` is eagerly mounted, unlike
  the Script tab's own `React.lazy`, so this bundle-weight discipline matters here too).
