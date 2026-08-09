import { test, expect, type Page } from "@playwright/test";
import { validateGraph, type VGraph } from "@gltfi/verify";
import { FIXTURE_GLB_PATH, FIXTURE_NO_GRAPH_GLB_PATH } from "./global-setup.js";
import { assertRegionRendersContent, assertRegionSpansMultipleLines } from "./visual-assert.js";

/**
 * M5 Script tab (specs/ux-script.md UX-7xx): Monaco emit/edit surface,
 * off-thread parse diagnostics (UX-709), EQUIV/DIVERGED via real
 * @gltfi/verify comparison (UX-710/UX-703), and Apply -> Graph via
 * editor-core's GraphEdit.replaceGraph (UX-711/UX-702, DOC-043).
 *
 * The fixture asset (e2e/global-setup.ts) carries the same small real
 * KHR_interactivity graph e2e/graph-canvas.spec.ts uses, plus a `counter`
 * float variable added specifically for this file: node 0 = event/onStart
 * (unconnected), node 1 = math/add with float literals (also unconnected),
 * `variables[0]` = "counter".
 *
 * `window.__gltfStudioScriptTest` (installed by ScriptPanel alongside its
 * own mount, same pattern as BehaviorGraphPanel.tsx's
 * `window.__gltfStudioGraphTest`) drives the Monaco buffer the way a real
 * keystroke would (Monaco fires the same content-change event for a
 * programmatic `setValue`) — avoiding a flaky raw-keyboard-into-Monaco e2e
 * interaction, same tradeoff `GraphCanvasTestHook.simulateConnect` makes
 * for canvas connections.
 */

type RawInteractivityGraph = {
  declarations: Array<{ op: string }>;
  variables?: Array<{ id?: string; type: number; value: unknown[] }>;
  nodes: Array<{ declaration: number; values?: Record<string, unknown>; flows?: Record<string, unknown> }>;
};

async function importFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
}

async function openScriptTab(page: Page): Promise<void> {
  await page.getByTestId("dock.tab.script").click();
  await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
  await expect(page.getByTestId("script.panel")).toBeVisible();
  // Monaco mounts via a dynamic import + a Worker spin-up (UX-707/UX-709) —
  // wait for the real test hook and real emitted content, not just the
  // container element.
  await expect
    .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15000 })
    .toContain("rt.onStart(");
}

async function getGraphJson(page: Page): Promise<RawInteractivityGraph> {
  const json = await page.evaluate(() => window.__gltfStudioGraphTest!.getDocumentJson());
  return (json as { extensions: { KHR_interactivity: { graphs: RawInteractivityGraph[] } } }).extensions.KHR_interactivity.graphs[0];
}

async function scriptSetValue(page: Page, value: string): Promise<void> {
  await page.evaluate((text) => window.__gltfStudioScriptTest!.setValue(text), value);
}

test.describe("Script tab", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
    await openScriptTab(page);
  });

  test("Emit view shows the fixture graph's real generated code, read-only, EQUIV by default; toolbar is exactly Edit/Apply/badge (UX-700/UX-705/UX-707/UX-708)", async ({ page }) => {
    const code = await page.evaluate(() => window.__gltfStudioScriptTest!.getCode());
    expect(code.startsWith("// Behavior script — generated from graph 0")).toBe(true);
    expect(code).toContain("const V = rt.vars(");
    expect(code).toContain("counter");
    expect(code).toContain("rt.onStart(");
    await expect(page.getByTestId("script.equiv-badge")).toHaveText("EQUIV ✓");
    await expect(page.getByTestId("script.edit-toggle")).toHaveText("Edit");
    await expect(page.getByTestId("script.apply")).toBeDisabled();
    // UX-708: exactly three toolbar controls, no save/export/format-code affordance.
    await expect(page.getByTestId("script.toolbar").locator("button")).toHaveCount(2);
  });

  test("editing the script diverges it from the graph; Apply -> Graph replaces the graph as one undoable command (UX-702/UX-710/UX-711/UX-713, DOC-043)", async ({ page }) => {
    test.slow(); // real off-thread parse round trip(s), same sensitivity note as e2e/graph-canvas.spec.ts's selection/connect tests.

    await page.getByTestId("script.edit-toggle").click();
    await expect(page.getByTestId("script.edit-toggle")).toHaveText("Done");

    const before = await getGraphJson(page);
    expect(before.nodes).toHaveLength(2);

    const code = await page.evaluate(() => window.__gltfStudioScriptTest!.getCode());
    const marker = "rt.onStart(() => {";
    const insertAt = code.indexOf(marker) + marker.length;
    const edited = `${code.slice(0, insertAt)}\n    V.counter = V.counter + 1;${code.slice(insertAt)}`;
    await scriptSetValue(page, edited);

    await expect(page.getByTestId("script.equiv-badge")).toHaveText("DIVERGED ⚠", { timeout: 15000 });
    await expect(page.getByTestId("script.apply")).toBeEnabled();
    // UX-713: divergence is never communicated by the badge text alone — a compareDeclarations-derived summary is always in its tooltip too.
    await expect(page.getByTestId("script.equiv-badge")).toHaveAttribute("title", /Diverged:/);

    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await page.getByTestId("script.apply").click();

    await expect(page.getByTestId("script.equiv-badge")).toHaveText("EQUIV ✓");
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();

    const after = await getGraphJson(page);
    expect(after.nodes.length).toBeGreaterThan(before.nodes.length); // the new `V.counter = ...` assignment lowers to a real graph node.
    expect(after.declarations.some((d) => d.op === "variable/set")).toBe(true);
    expect(validateGraph(after as unknown as VGraph).ok).toBe(true);

    // One history entry: undo restores the exact prior graph, and — since
    // the edit buffer still holds the unapplied edit — re-diverges the
    // badge automatically (UX-710's "re-evaluate EQUIV when the document's
    // graph changes" behavior), with no further script edit needed.
    await page.getByTestId("topbar.undo").click();
    const undone = await getGraphJson(page);
    expect(undone).toEqual(before);
    await expect(page.getByTestId("script.equiv-badge")).toHaveText("DIVERGED ⚠");
  });

  test("a syntax error shows diagnostics and disables Apply (UX-709)", async ({ page }) => {
    await page.getByTestId("script.edit-toggle").click();
    await scriptSetValue(page, "this is not valid TypeScript $$$ {{{");

    await expect(page.getByTestId("script.diagnostics")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("script.apply")).toBeDisabled();
  });

  // Visual (real-pixel) regression for the `.script-tab-wrap` CSS-collapse bug (see
  // specs/ux-shell.md's bug-fix note): `e2e/global-setup.ts`'s golden-path screenshots (and every
  // test above, which reads Monaco's model text via `getCode()`) never observed that the editor's
  // rendered pixels had collapsed to a sliver — a `getBoundingClientRect()`-style check on an
  // ancestor wouldn't have caught it either, since `#bottom-dock`/`.dock-content` themselves always
  // had a correct, non-zero height; only the DESCENDANT `.script-tab-wrap` collapsed. This uses
  // `e2e/visual-assert.ts`'s real-screenshot helper instead, applied at the three points that bug
  // report called out: default dock height, after a real drag on the resize handle (both directions
  // — the bug was independent of dock height, so this must hold at both ends of the resizable
  // range), and after switching to another dock tab and back (the mounted-but-hidden pattern, UX-103,
  // that this bug's fix's `.script-tab-wrap` CSS chain and Monaco's `automaticLayout: true` both have
  // to keep working through).
  test("emitted multi-line code is genuinely VISIBLE (not just present in Monaco's model) at default dock height, after a resize in both directions, and after a tab-switch-away-and-back (UX-700, visual regression)", async ({
    page
  }) => {
    const codeRegion = page.getByTestId("script.code");

    // Default dock height (UX-102: 300px).
    await assertRegionSpansMultipleLines(codeRegion);

    const handle = page.getByTestId("dock.resize-handle");

    // Shrink toward the dock's minimum (UX-102: 140px) — a large downward drag clamps there
    // regardless of the exact starting height, same technique e2e/shell.spec.ts's own resize-clamp
    // test uses for the left panel.
    let box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 500, { steps: 10 });
    await page.mouse.up();
    await assertRegionSpansMultipleLines(codeRegion);

    // Grow back past the default.
    box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 350, { steps: 10 });
    await page.mouse.up();
    await assertRegionSpansMultipleLines(codeRegion);

    // Tab-switch-away-and-back.
    await page.getByTestId("dock.tab.graph").click();
    await page.getByTestId("dock.tab.script").click();
    await assertRegionSpansMultipleLines(codeRegion);
  });
});

// UX-714's no-graph empty state — a separate describe block since it needs a document with no
// `KHR_interactivity` graph at all, unlike every test above (this file's shared `beforeEach`
// imports the real-graph fixture).
test.describe("Script tab - no-graph empty state (UX-714)", () => {
  test('shows an honest "no behavior graph" message, not a live-but-empty editor, when the document has no KHR_interactivity graph', async ({
    page
  }) => {
    await page.goto("/");
    await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_NO_GRAPH_GLB_PATH);
    await expect(page.getByTestId("topbar.project-name")).toBeVisible();
    await page.getByTestId("dock.tab.script").click();

    await expect(page.getByTestId("script.empty-state")).toHaveText(
      "No behavior graph in this asset — add nodes from the graph palette or ask Copilot."
    );
    // Neither the toolbar (Edit/Apply/badge) nor the (necessarily-still-DOM-present-but-hidden,
    // see script-panel.tsx's own comment on why) Monaco container are shown.
    await expect(page.getByTestId("script.toolbar")).toHaveCount(0);
    await expect(page.getByTestId("script.code")).toBeHidden();

    // The real-pixel check: an honest message renders visibly too, not just as inert DOM.
    await assertRegionRendersContent(page.getByTestId("script.panel"));
  });
});
