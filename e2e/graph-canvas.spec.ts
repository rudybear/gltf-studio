import { test, expect, type Page } from "@playwright/test";
import { validateGraph, type VGraph } from "@gltfi/verify";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

/**
 * M4 behavior-graph canvas (specs/ux-graph-canvas.md UX-5xx): the lifted
 * mapGraph/ELK-layout viewer plus full editing via editor-core's GraphEdit —
 * palette (UX-500..502), node/port rendering (UX-503/504), validation
 * badges (UX-506), node details (UX-507), position persistence (UX-510),
 * and this task's own connect/disconnect/delete/drag/literal-edit bullets.
 *
 * The fixture asset (e2e/global-setup.ts) carries a small real
 * KHR_interactivity graph: node 0 = event/onStart (unconnected), node 1 =
 * math/add with float literals `a`/`b` (also unconnected).
 *
 * `window.__gltfStudioGraphTest` (installed by BehaviorGraphPanel.tsx
 * alongside its own mount) is the only way to read `document.json` from the
 * test — the Data tab's breadcrumb navigation is scoped to DOC-038's
 * canonical splice roots, not a general-purpose pointer inspector.
 */

type RawInteractivityGraph = {
  types: Array<{ signature: string }>;
  declarations: Array<{ op: string }>;
  nodes: Array<{ declaration: number; values?: Record<string, unknown>; flows?: Record<string, unknown>; extras?: { gltfi?: { x: number; y: number } } }>;
};

async function importFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
  // GraphView's ELK layout pass (real elkjs, off-thread via the worker) must
  // resolve before any node testid exists.
  await expect(page.getByTestId("gcanvas.node.0")).toBeVisible();
  // `fitView`'s auto-computed zoom for a tiny graph varies with the dock's
  // current pixel height, which makes raw-pixel mouse drags onto 8px port
  // handles nondeterministic. Pin a known zoom/pan via GraphView's own
  // test-only `window.__gltfStudioGraphCanvasTest` seam (same pattern as
  // Viewport.tsx's `window.__gltfStudioTest`) before any test computes
  // bounding boxes to drag between.
  await page.evaluate(() => window.__gltfStudioGraphCanvasTest!.setViewport({ x: 60, y: 60, zoom: 1 }));
  await expect
    .poll(() => page.locator(".react-flow__viewport").getAttribute("style"))
    .toContain("translate(60px, 60px) scale(1)");
}

async function getGraphJson(page: Page): Promise<RawInteractivityGraph> {
  const json = await page.evaluate(() => window.__gltfStudioGraphTest!.getDocumentJson());
  return (json as { extensions: { KHR_interactivity: { graphs: RawInteractivityGraph[] } } }).extensions.KHR_interactivity.graphs[0];
}

test.describe("behavior-graph canvas", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("renders the fixture's real nodes (UX-503) and edges from the imported document", async ({ page }) => {
    await expect(page.getByTestId("gcanvas.root")).toBeVisible();
    await expect(page.locator('[data-testid^="gcanvas.node."]')).toHaveCount(2);
    await expect(page.getByTestId("gcanvas.node.0")).toContainText("onStart");
    await expect(page.getByTestId("gcanvas.node.1")).toContainText("add");
    // The fixture's two nodes are unconnected — no edges yet.
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  });

  test("clicking a node opens its details card, selected on the canvas (UX-507); editing an unconnected literal input updates the document (UX-504)", async ({
    page
  }) => {
    // This test's store round trip (click -> onSelectNode -> zustand ->
    // BehaviorGraphPanel -> GraphCanvas -> GraphView prop -> re-render) was
    // measurably slower than this file's other, more locally-contained
    // assertions under heavy Playwright worker parallelism (many concurrent
    // headless Chromium instances, several with real WebGL rendering) —
    // `test.slow()` triples this test's timeout budget accordingly.
    //
    // M8-copilot follow-up: this test's own 60000ms explicit assertion
    // timeout (independent of test.slow()'s test-level multiplier) started
    // failing on CI's 2-worker budget once e2e/copilot.spec.ts added more
    // concurrently-running spec files with real WebGL/interpreter work,
    // same "past its margin" pattern this file's CI-worker-cap comment
    // (playwright.config.ts) already documents from M7's audio.spec.ts.
    // Raised both the explicit assertion timeout and the overall test
    // timeout accordingly rather than trimming concurrency further.
    test.slow();
    test.setTimeout(180_000);
    await page.getByTestId("gcanvas.node.1").click();

    await expect(page.getByTestId("gcanvas.node.1")).toHaveClass(/gcanvas-op-node-selected/, { timeout: 120000 });
    const details = page.getByTestId("gcanvas.details");
    await expect(details).toContainText("math/add");
    await expect(details).toContainText("math");
    await expect(details.getByTestId("gcanvas.details.port.value-in:a")).toContainText("literal: 1");
    await expect(details.getByTestId("gcanvas.details.port.value-in:b")).toContainText("literal: 2");

    const literalA = page.getByTestId("gcanvas.literal.1.a");
    await literalA.fill("5");
    await literalA.blur();

    await expect
      .poll(async () => {
        const graph = await getGraphJson(page);
        return graph.nodes[1]!.values!.a;
      })
      .toEqual({ type: 0, value: [5] });
  });

  test("palette search filters live by op-id/category substring (UX-500, UX-501)", async ({ page }) => {
    await expect(page.getByTestId("gcanvas.palette.category.math")).toBeVisible();
    await expect(page.getByTestId("gcanvas.palette.category.debug")).toBeVisible();

    await page.getByTestId("gcanvas.palette.search").fill("math/add");

    await expect(page.getByTestId("gcanvas.palette.category.math")).toBeVisible();
    await expect(page.getByTestId("gcanvas.palette.category.debug")).toBeHidden();
    await expect(page.getByTestId("gcanvas.palette.op.math/add")).toBeVisible();
  });

  test("add math/add node from the palette updates the document and is undoable (DOC-007..010)", async ({ page }) => {
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();

    await page.getByTestId("gcanvas.palette.op.math/add").click();

    await expect(page.getByTestId("gcanvas.node.2")).toBeVisible();
    let graph = await getGraphJson(page);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.declarations[graph.nodes[2]!.declaration]!.op).toBe("math/add");

    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();

    await expect(page.getByTestId("gcanvas.node.2")).toHaveCount(0);
    graph = await getGraphJson(page);
    expect(graph.nodes).toHaveLength(2);
  });

  test("connecting a compatible value output to a value input adds a document edge; an invalid connect is rejected with a toast and no document change", async ({
    page
  }) => {
    // See the `test.slow()` note on the selection test above — this test's
    // toast/document assertions round-trip through the app store the same
    // way and showed the same sensitivity under heavy worker parallelism.
    test.slow();
    // React Flow's own connection-drag hit-testing (which handle is
    // "closest enough" to the cursor to complete a connection) turned out
    // to depend on its internal zoom/viewport state in ways that made a
    // real pixel-perfect handle-to-handle Playwright drag measurably flaky
    // in this compact dock panel, even after pinning a fixed viewport
    // (see graph-view.tsx's `GraphCanvasTestHook.simulateConnect` doc
    // comment). `simulateConnect` invokes the exact same `onConnect`
    // handler a real drag would — every bit of real application logic
    // downstream of a connect gesture (validateConnection,
    // GraphEdit.connectValue/connectFlow, dispatchCommand) still runs;
    // only the physical pointer input is synthesized (same tradeoff
    // e2e/viewport.spec.ts's `simulateGizmoDrag` already makes for the
    // 3D gizmo, for the same reason).

    // --- invalid: flow-out -> value-in (mismatched port class) ---
    await page.evaluate(() =>
      window.__gltfStudioGraphCanvasTest!.simulateConnect({
        source: "0",
        sourceHandle: "flow-out:out",
        target: "1",
        targetHandle: "value-in:a"
      })
    );

    await expect(page.getByTestId("toast")).toContainText("Connection rejected", { timeout: 60000 });
    let graph = await getGraphJson(page);
    expect(graph.nodes[1]!.values).toEqual({ a: { type: 0, value: [1] }, b: { type: 0, value: [2] } });
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);

    // --- valid: add a second math/add node, connect its value output into node 1's "a" input ---
    await page.getByTestId("gcanvas.palette.op.math/add").click();
    await expect(page.getByTestId("gcanvas.node.2")).toBeVisible();

    await page.evaluate(() =>
      window.__gltfStudioGraphCanvasTest!.simulateConnect({
        source: "2",
        sourceHandle: "value-out:value",
        target: "1",
        targetHandle: "value-in:a"
      })
    );

    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
    graph = await getGraphJson(page);
    expect(graph.nodes[1]!.values!.a).toEqual({ node: 2, socket: "value" });
  });

  test("dragging a node persists its position to extras.gltfi (DOC-027) and survives a dock tab switch", async ({ page }) => {
    const node0 = page.getByTestId("gcanvas.node.0");
    const before = await node0.boundingBox();
    if (!before) throw new Error("node 0 not visible");

    await page.mouse.move(before.x + before.width / 2, before.y + 10);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 120, before.y + 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const graph = await getGraphJson(page);
    const extras = graph.nodes[0]!.extras?.gltfi;
    expect(extras).toBeDefined();
    expect(Number.isFinite(extras!.x)).toBe(true);
    expect(Number.isFinite(extras!.y)).toBe(true);

    // Switch away (unmounts BehaviorGraphPanel, UX-510: position must not
    // live in an ephemeral, editor-only store) and back.
    await page.getByTestId("dock.tab.data").click();
    await page.getByTestId("dock.tab.graph").click();
    await expect(page.getByTestId("gcanvas.node.0")).toBeVisible();

    const after = await getGraphJson(page);
    expect(after.nodes[0]!.extras?.gltfi).toEqual(extras);
  });

  test("deleting a node removes it and undo restores it, with the surviving node's indices/fixups intact (validateGraph clean)", async ({
    page
  }) => {
    await page.getByTestId("gcanvas.palette.op.math/add").click();
    await expect(page.getByTestId("gcanvas.node.2")).toBeVisible();

    await page.getByTestId("gcanvas.node.2").click();
    await page.keyboard.press("Delete");

    await expect(page.getByTestId("gcanvas.node.2")).toHaveCount(0);
    let graph = await getGraphJson(page);
    expect(graph.nodes).toHaveLength(2);

    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("gcanvas.node.2")).toBeVisible();
    graph = await getGraphJson(page);
    expect(graph.nodes).toHaveLength(3);
    expect(validateGraph(graph as unknown as VGraph).ok).toBe(true);
  });

  test("a validation badge appears for an invalid node (variable/set with no variable) and clears once the invalid node is undone away", async ({
    page
  }) => {
    await page.getByTestId("gcanvas.palette.search").fill("variable/set");
    await page.getByTestId("gcanvas.palette.op.variable/set").click();
    await expect(page.getByTestId("gcanvas.node.2")).toBeVisible();

    const badge = page.getByTestId("gcanvas.badge.2");
    await expect(badge).toBeVisible({ timeout: 2000 });
    await expect(badge).toHaveAttribute("title", /GV027/);

    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("gcanvas.node.2")).toHaveCount(0);
    await expect(page.getByTestId("gcanvas.badge.2")).toHaveCount(0);
  });
});
