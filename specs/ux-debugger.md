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
- D1 deliberately ships no gutter breakpoints inside this app's own Script tab UI, no graph-canvas
  "paused here" badge, and no "Break here" authoring affordance — see `docs/adr/0006`'s Consequences
  for the full list of what D2/D3 still owns. Audio-script (`specs/ux-audio-script.md`) construction
  debugging is likewise out of scope for D1 in its entirety.
