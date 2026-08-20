# e2e

Playwright specs against the BUILT app (`vite preview`, not the dev server — see
`playwright.config.ts`'s own comment). `pnpm build` once, then `pnpm e2e`.

## Deflaking convention: readiness, not sleeps

CI's e2e job runs on a GitHub-hosted 4-vCPU runner at `workers: 2`
(`playwright.config.ts`) — real contention between concurrently-running
spec files, each often driving genuine GPU work (WebGL) or a real ELK
layout worker thread, not a synthetic slowdown. A handful of specs flaked
under exactly that contention before a systemic pass (see
`specs/ux-graph-canvas.md`'s task #33 and its later "systemic e2e CI
stability pass" follow-up, and `specs/ux-audio-graph.md`'s matching note)
root-caused and fixed the underlying races. The discipline that pass
established, and that every new canvas-driving spec should follow:

- **Await a readiness signal before any bounding-box-dependent interaction
  — never widen a timeout instead.** A `.click()`/`.boundingBox()` call
  computes its target point from an element's CURRENT geometry. A freshly-
  added (or just-resized, e.g. by a pointer-picker retarget or a badge
  appearing) `GraphView` node starts at ELK's *estimated* size and is
  corrected to its real measured DOM size a tick later by React Flow's own
  `ResizeObserver` — and, separately, `GraphView`'s own `elkPositions`-
  driven recompute effect can reposition/resize EVERY currently-rendered
  node on any graph-shape change, not just a newly-added one. A click
  computed before that settles can silently land on the wrong element
  (a child control that `stopPropagation`s, a neighboring node, or empty
  canvas background) — no exception is thrown, the interaction just
  silently does nothing, and no amount of extra timeout fixes that: the
  target point is wrong, not slow to arrive at. Use
  `waitForNodesSettled(page, hookKey?)` from `e2e/graph-canvas-test-
  helpers.ts` (a debounced poll of the canvas's own
  `nodesDimensionsSettled()` test hook — see
  `packages/graph-canvas/src/graph-view.tsx`'s `GraphCanvasTestHook` doc
  comment) before any such interaction: right after import/fixture-load,
  right after adding a node from the palette, and right after any edit that
  changes a node's rendered content enough to resize its card.
- **Click stable, content-independent anchors, not a node's own testid.**
  Even once geometry has settled, `.click()`'s default target — an
  element's geometric CENTER — can land on a real child control (a literal
  input, a pointer-text/icon row, a target chip) instead of the card's own
  neutral chrome once that content exists. Use `clickNodeHeader(scope,
  nodeIndex)` (same helper file) to click `.gcanvas-op-header` instead — a
  fixed strip every op node has, that's never itself a row-level control.
- **Use the `simulate*` test-hook seams for drag-and-drop, not raw pixel
  drags.** Real `DragEvent`/`DataTransfer` synthesis over Playwright's CDP
  bridge is the flaky part of a drag-drop interaction, not anything the
  app's own code does with it once the drop lands. `simulateConnect`
  (canvas-to-canvas value/flow connections) and `simulateExternalDrop`
  (scene-tree-row / Animations-tab-clip → canvas drops) invoke the exact
  same handling code a real drag-drop does — only the drag GESTURE itself
  is synthesized; every subsequent menu/option click is a real Playwright
  click against real rendered UI. Both are exposed on the same
  `__gltfStudioGraphCanvasTest` / `__gltfStudioAudioGraphCanvasTest` test
  hook `waitForNodesSettled` polls.

Both `waitForNodesSettled` and `clickNodeHeader` are shared across every
spec that drives a `GraphView`-based canvas — import them from
`./graph-canvas-test-helpers.js` rather than re-implementing a local copy
(several specs did exactly that independently before the systemic pass
above; the duplication is what let some of them miss the guard).

## Reproducing a suspected flake

Don't guess from a single CI failure. Reproduce it locally first, under
comparable contention, before changing anything:

```sh
pnpm build
pnpm exec playwright test packages/../preview &   # or just let webServer start it
taskset -c 0-3 npx playwright test e2e/some.spec.ts --repeat-each=30 --workers=2 --retries=0 --reporter=list
```

`taskset -c 0-3` pins the run to 4 cores, matching CI's vCPU budget — the
real signal comes from running MULTIPLE suspect spec files together this
way (cross-file contention is what CI actually has; a single file repeated
in isolation reproduces far fewer real races). Once a failure reproduces,
the trace/`error-context.md` under `test-results/` almost always names the
exact intercepting element — that's the root cause, not a slow assertion.
Fix the readiness gap, then re-run the same `--repeat-each` at 0 failures
to confirm before moving on.
