import { type Locator, type Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Shared readiness/interaction helpers for every spec that drives a
 * `GraphView`-based canvas (behavior graph: `e2e/graph-canvas.spec.ts`,
 * `e2e/graph-literal-editors.spec.ts`, `e2e/graph-variables.spec.ts`,
 * `e2e/pointer-picker-dnd.spec.ts`, `e2e/usage-mapping*.spec.ts`,
 * `e2e/racer.spec.ts`; audio graph: `e2e/audio-graph-editing.spec.ts`) — one
 * copy of the node-click/resize race guard `e2e/graph-canvas.spec.ts` first
 * root-caused (task #33/PR #39, see that file's own doc comment and
 * specs/ux-graph-canvas.md's matching follow-up note) instead of each spec
 * file re-implementing its own local copy.
 *
 * Bug-fix note (task: systemic e2e CI stability pass): reproduced offline
 * under artificial CPU contention (a `taskset`-pinned Playwright run sharing
 * 4 cores with a second, unrelated spec file's own real ELK-layout/GPU work
 * — the same cross-file contention `playwright.config.ts`'s own `workers`
 * comment already documents CI hitting) that `e2e/graph-literal-editors.spec.ts`
 * and `e2e/pointer-picker-dnd.spec.ts` — unlike `e2e/graph-canvas.spec.ts`
 * itself — never called anything like `waitForNodesSettled` before a
 * bounding-box-dependent click (a node's own testid, or a specific child
 * control like `gcanvas.pointer-icon.N`/`gcanvas.pointer-text.N`, positioned
 * relative to that same still-resizing node). Real captured failures:
 * `locator.click` timing out because `.gcanvas-root` (the WHOLE canvas
 * background) or a NEIGHBORING control on the same card intercepted the
 * point Playwright computed before the node's real ELK-measured size (or,
 * for `gcanvas.pointer-icon`/`gcanvas.pointer-text`, the size change a
 * `pointer-picker.confirm` retarget triggers by swapping that node's value
 * editor) landed — the exact node-click/resize race class task #33 already
 * named, just at two call sites that predate/postdate that fix without
 * having picked up its guard. No amount of extra timeout fixes this (task
 * #33's own finding): the click's target point is simply wrong, not slow to
 * arrive at.
 */

type GraphCanvasTestHookLike = {
  nodesDimensionsSettled(): boolean;
};

/**
 * Polls the given `GraphView` instance's test-only readiness seam (see
 * `packages/graph-canvas/src/graph-view.tsx`'s `GraphCanvasTestHook` doc
 * comment) until every currently-rendered node has its FINAL, ELK/DOM-
 * measured size — not a fixed wait, an adaptive one that only returns once
 * no node has resized for 300ms. Call this before ANY interaction whose
 * target point Playwright computes from a node's (or one of its children's)
 * current bounding box: right after a fixture import, right after adding a
 * node from the palette, and right after any edit (e.g. a pointer-picker
 * retarget) that changes a node's rendered content enough to resize its
 * card.
 *
 * `hookKey` defaults to the behavior-graph canvas's own long-standing
 * `"__gltfStudioGraphCanvasTest"` key; pass
 * `"__gltfStudioAudioGraphCanvasTest"` for the audio-graph canvas (see
 * `GraphViewProps.testHookKey`'s doc comment for why the two canvases don't
 * share one global key).
 *
 * `timeoutMs` defaults to `expect.poll`'s own built-in default (5000ms) —
 * plenty for every fixture-scale graph in this repo. `e2e/racer.spec.ts`'s
 * real 366-node graph needs a much longer budget (its own `toHaveCount(366,
 * { timeout: 30_000 })` wait for the same layout cascade is the precedent);
 * pass an explicit `timeoutMs` there rather than leaving the default, which
 * would fail this wait long before that graph's cascade is done settling.
 */
export async function waitForNodesSettled(page: Page, hookKey = "__gltfStudioGraphCanvasTest", timeoutMs?: number): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((key) => {
          const hook = (window as unknown as Record<string, GraphCanvasTestHookLike | undefined>)[key];
          return hook ? hook.nodesDimensionsSettled() : false;
        }, hookKey),
      timeoutMs !== undefined ? { timeout: timeoutMs } : undefined
    )
    .toBe(true);
}

/**
 * Selects a graph node by clicking its HEADER (`.gcanvas-op-header`), not
 * the node's own testid: once a node has real, non-trivial content (a
 * `pointer/*` node's pointer-text/icon row, a literal-input row, an
 * audio-param row), `.click()`'s default target — the node's geometric
 * CENTER — can land on one of those child controls instead of the card's
 * own neutral chrome, and several of them `stopPropagation` (see
 * `packages/graph-canvas/src/op-node.tsx`) so React Flow's node-click
 * delegation never fires at all. The header is a fixed, content-independent
 * strip at the top of every op node (`NODE_METRICS.headerHeight`), so a
 * click there can never land on a row-level control. Callers should still
 * `waitForNodesSettled` first — this only fixes the geometry half of the
 * race, not the timing half.
 */
export async function clickNodeHeader(scope: Page | Locator, nodeIndex: number): Promise<void> {
  await scope.locator(`[data-testid="gcanvas.node.${nodeIndex}"] .gcanvas-op-header`).click();
}
