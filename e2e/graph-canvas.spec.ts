import { test, expect, type Page } from "@playwright/test";
import { validateGraph, type VGraph } from "@gltfi/verify";
import { FIXTURE_GLB_PATH, FIXTURE_PLAY_GLB_PATH } from "./global-setup.js";
import { assertRegionRendersContent, assertHandleLabelPixelGap } from "./visual-assert.js";

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
  await page.goto("./");
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

/**
 * DOM-geometry half of the socket/label-overlap regression guard (bug-fix
 * note below): reads the REAL, rendered `getBoundingClientRect()` of a port
 * row's Handle (`gcanvas.handle.<nodeIndex>.<portId>`, a React Flow
 * `<Handle>`) and its `.gcanvas-port-name` label, in the row
 * `.closest(".gcanvas-op-row")` resolves to — not ELK's estimated geometry,
 * not a CSS value, the actual composited box a real screen reader/user
 * would see. See `assertHandleLabelPixelGap` (./visual-assert.ts) for the
 * companion pixel-level half of this pattern.
 */
async function handleLabelOverlap(
  page: Page,
  handleTestId: string
): Promise<{ intersects: boolean; text: string | null; handle: DOMRect; label: DOMRect }> {
  return page.evaluate((testid) => {
    const handle = document.querySelector(`[data-testid="${testid}"]`);
    if (!handle) throw new Error(`handle not found: ${testid}`);
    const row = handle.closest(".gcanvas-op-row");
    const label = row?.querySelector(".gcanvas-port-name");
    if (!label) throw new Error(`label not found in row for handle: ${testid}`);
    const hb = handle.getBoundingClientRect();
    const lb = label.getBoundingClientRect();
    const intersects = hb.left < lb.right && hb.right > lb.left && hb.top < lb.bottom && hb.bottom > lb.top;
    return { intersects, text: label.textContent, handle: hb.toJSON(), label: lb.toJSON() };
  }, handleTestId);
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

  test("variable/set card shows the assigned variable's real NAME, not a bare index (card-legibility audit, UX-514)", async ({ page }) => {
    await page.getByTestId("gcanvas.palette.search").fill("variable/set");
    await page.getByTestId("gcanvas.palette.op.variable/set").click();
    await expect(page.getByTestId("gcanvas.node.2")).toBeVisible();

    // Blank (no variable assigned yet): no subtitle row at all — same "no
    // config yet" convention `event/onSelect`'s target-chip test (below)
    // exercises for its OWN blank state, just via a different config shape
    // (variable/set has no config field at all until one is chosen, unlike
    // a handler's always-present, defaulted `nodeIndex`).
    await expect(page.getByTestId("gcanvas.node.2").locator(".gcanvas-op-subtitle")).toHaveCount(0);

    // The fixture graph (e2e/global-setup.ts's EXISTING_GRAPH) already
    // declares a "counter" variable — assign it via the details panel's
    // variable selector (node-details.tsx's `DeclarationSelect`).
    await page.getByTestId("gcanvas.details.config.variable-select.2").selectOption("0");

    await expect(page.getByTestId("gcanvas.node.2")).toContainText("counter");
    await expect(page.getByTestId("gcanvas.node.2")).not.toContainText("var#0");
  });

  test("animation/start card shows the resolved clip NAME, not just a bare ref index (card-legibility audit, UX-514) — previously showed no card indication at all", async ({
    page
  }) => {
    await page.getByTestId("gcanvas.palette.search").fill("animation/start");
    await page.getByTestId("gcanvas.palette.op.animation/start").click();
    await expect(page.getByTestId("gcanvas.node.2")).toBeVisible();

    // No clip assigned yet: no clip row at all (mirrors the variable/set
    // "no config yet" case above).
    await expect(page.getByTestId(`gcanvas.op-animation-row.2`)).toHaveCount(0);

    // The fixture scene (e2e/global-setup.ts's buildBaseSceneJson) declares
    // exactly one real animation, "Idle" — assign it via the details panel's
    // animation-clip selector (node-details.tsx's `AnimationValueEditor`).
    await page.getByTestId("gcanvas.details.config.animation-select.2").selectOption("0");

    const clipRow = page.getByTestId("gcanvas.op-animation-row.2");
    await expect(clipRow).toContainText("Idle");
    await expect(clipRow).toContainText("(#0)");
  });

  test("event/onSelect node's card target chip resolves the real scene-node name, retargets via the details editor, and shows a missing state once its target is deleted (UX-512, UX-513)", async ({
    page
  }) => {
    test.slow();
    // The fixture scene (e2e/global-setup.ts's buildBaseSceneJson) has 4
    // scene nodes: 0 Root, 1 Widget, 2 KeyLight, 3 Widget_Detail — deleting
    // the LAST one (below) shrinks the scene to 3 nodes, so a `nodeIndex: 3`
    // config becomes genuinely, unambiguously out-of-range afterward (not
    // silently reinterpreted as some other node that shifted into its old
    // slot — this fixture's own delete is chosen specifically to sidestep
    // that ambiguity, see DOC-049's own "left dangling, not repaired" note).
    await page.getByTestId("gcanvas.palette.search").fill("event/onSelect");
    await page.getByTestId("gcanvas.palette.op.event/onSelect").click();
    await expect(page.getByTestId("gcanvas.node.2")).toBeVisible();

    const chip = page.getByTestId("gcanvas.target-chip.2");
    // Added blank from the palette: no `configuration.nodeIndex` at all yet — resolves to the registry's own "-1 any node" default.
    await expect(chip).toContainText("any node");
    await expect(chip).toBeDisabled();

    // Retarget to Widget (#1) via the details editor's "Target node" selector.
    await page.getByTestId("gcanvas.details.config.target-select.2").selectOption("1");
    await expect(chip).toContainText("Widget");
    await expect(chip).toContainText("(#1)");
    await expect(chip).toBeEnabled();

    // Chip click selects Widget in the scene tree. Scene-tree rows are
    // indexed by DEPTH-FIRST FLATTEN POSITION, not raw node index
    // (SceneTree.tsx's own doc comment) — this fixture's hierarchy (Root(0)
    // -> [Widget(1) -> [Widget_Detail(3)], KeyLight(2)]) flattens to
    // row.0=Root(0), row.1=Widget(1), row.2=Widget_Detail(3), row.3=KeyLight(2).
    await page.getByTestId("scene-tree.row.3").click(); // select KeyLight (nodeIndex 2) first, so the click below is a genuine reselect
    await expect(page.getByTestId("scene-tree.row.1")).not.toHaveClass(/selected/);
    await chip.click();
    await expect(page.getByTestId("scene-tree.row.1")).toHaveClass(/selected/);

    // Retarget to Widget_Detail (#3, the LAST scene node) then delete it —
    // the card must show the missing state, and validation must flag it.
    await page.getByTestId("gcanvas.details.config.target-select.2").selectOption("3");
    await expect(chip).toContainText("Widget_Detail");
    await page.getByTestId("scene-tree.row.2").click({ button: "right" }); // row.2 = Widget_Detail (nodeIndex 3), per the flatten order noted above
    await expect(page.getByTestId("scene-tree.context-menu.delete")).toBeVisible();
    await page.getByTestId("scene-tree.context-menu.delete").click();

    await expect(chip).toContainText("⚠ missing (#3)");
    await expect(chip).toBeDisabled();
    const badge = page.getByTestId("gcanvas.badge.2");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("title", /GCANVAS-HANDLER-TARGET-MISSING/);

    // Undo the delete: Widget_Detail comes back, and the chip resolves clean again.
    await page.getByTestId("topbar.undo").click();
    await expect(chip).toContainText("Widget_Detail");
    await expect(chip).toContainText("(#3)");
    await expect(page.getByTestId("gcanvas.badge.2")).toHaveCount(0);
  });

  // Real-pixel sanity check (see specs/ux-shell.md's bug-fix note on the Script tab's
  // `.script-tab-wrap` CSS-collapse bug, which prompted auditing every dock tab for the same
  // "hidden-mount measures near-zero" class of bug): confirms the canvas actually renders visible
  // content once opened, not merely that node testids exist in the DOM.
  test("the canvas renders non-trivial visible content once opened, not just DOM nodes (visual sanity check)", async ({ page }) => {
    await assertRegionRendersContent(page.getByTestId("gcanvas.canvas"), { minNonBackgroundFraction: 0.02 });
  });
});

// Regression for the socket/label-overlap bug (specs/ux-graph-canvas.md's bug-fix note): a React
// Flow <Handle> is `position: absolute`, pinned to its row's own edge independent of the row's flex
// layout, so the row's flex `gap` never applied to it — with no compensating padding, the handle's
// near half sat directly under the label's first (west/input row) or last (east/output row)
// character. Fixed via `padding-left`/`padding-right` on `.gcanvas-op-row-west`/`-east`
// (graph-canvas.css) — padding on THIS SAME element the Handle is absolutely positioned against
// shifts only the row's in-flow content, never the Handle's own `left: 0`/`right: 0` anchor (which
// resolves against the row's un-padded padding-box edge), so this cannot move where an edge visually
// terminates (elk-layout.ts's `westPorts`/`eastPorts`/`NODE_METRICS` control ELK's own EXTERNAL
// routing estimate, not a real Handle's on-screen position — React Flow always measures that from
// the Handle's own DOM bounds).
test.describe("behavior-graph canvas — port handle/label overlap regression", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("an input (west) row's handle and its label bounding boxes never intersect, at zoom 1 and zoom 1.5", async ({ page }) => {
    for (const zoom of [1, 1.5]) {
      await page.evaluate((z) => window.__gltfStudioGraphCanvasTest!.setViewport({ x: 60, y: 60, zoom: z }), zoom);
      await page.waitForTimeout(150);

      for (const handleTestId of ["gcanvas.handle.1.value-in:a", "gcanvas.handle.1.value-in:b"]) {
        const { intersects, text } = await handleLabelOverlap(page, handleTestId);
        expect(intersects, `${handleTestId} ("${text}") handle/label overlap at zoom ${zoom}`).toBe(false);
      }
    }
  });

  test("an output (east) row's handle and its label bounding boxes never intersect, including the longest real registry socket name, at zoom 1 and zoom 1.5", async ({
    page
  }) => {
    // event/onSelect (KHR_interactivity registry): its value-out ports include
    // "selectionRayOrigin" (18 chars) — the longest output-socket name in the whole op registry, and
    // "selectedNodeIndex"/"controllerIndex" close behind, giving several real long labels in one node
    // rather than a synthetic string.
    await page.getByTestId("gcanvas.palette.search").fill("event/onSelect");
    await page.getByTestId("gcanvas.palette.op.event/onSelect").click();
    await expect(page.getByTestId("gcanvas.node.2")).toBeVisible();

    for (const zoom of [1, 1.5]) {
      await page.evaluate((z) => window.__gltfStudioGraphCanvasTest!.setViewport({ x: 60, y: 60, zoom: z }), zoom);
      await page.waitForTimeout(150);

      for (const handleTestId of [
        "gcanvas.handle.2.flow-out:out",
        "gcanvas.handle.2.value-out:selectedNode",
        "gcanvas.handle.2.value-out:selectedNodeIndex",
        "gcanvas.handle.2.value-out:controllerIndex",
        "gcanvas.handle.2.value-out:selectionPoint",
        "gcanvas.handle.2.value-out:selectionRayOrigin",
        "gcanvas.handle.2.value-out:event"
      ]) {
        const { intersects, text } = await handleLabelOverlap(page, handleTestId);
        expect(intersects, `${handleTestId} ("${text}") handle/label overlap at zoom ${zoom}`).toBe(false);
      }
    }
  });

  test("a value-in row showing a literal chip (an unconnected non-editable-scalar type, not an <input>) doesn't overlap its handle", async ({
    page
  }) => {
    // simple-scene.glb's own fixture graph only carries editable-scalar (float) literals, which
    // render as an <input>, not the read-only ".gcanvas-port-literal" chip this row kind is about —
    // play-scene.glb's node 6 (pointer/set, e2e/global-setup.ts's PLAY_GRAPH) has a real float3
    // literal (`values.value = [0.5, 0, 0]`) on its unconnected "value" port, which is exactly this
    // case: float3 isn't in op-node.tsx's EDITABLE_SCALAR_TYPES, so it renders "= [0.5,0,0]" as a
    // plain chip beside the port name.
    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_PLAY_GLB_PATH);
    await expect(page.getByTestId("topbar.project-name")).toHaveText("play-scene");
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId("gcanvas.node.6")).toBeVisible();
    await page.evaluate(() => window.__gltfStudioGraphCanvasTest!.setViewport({ x: 60, y: 60, zoom: 1 }));
    await page.waitForTimeout(150);

    const details = page.getByTestId("gcanvas.node.6");
    await expect(details).toContainText("0.5");

    const { intersects, text } = await handleLabelOverlap(page, "gcanvas.handle.6.value-in:value");
    expect(intersects, `literal-chip row ("${text}") handle/label overlap`).toBe(false);
  });

  test("pixel-level sanity: a real screenshot shows a visible background gap between an input and an output handle and their labels, in both themes", async ({
    page
  }) => {
    for (const colorScheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme });
      await importFixture(page);
      await assertHandleLabelPixelGap(page, "gcanvas.handle.1.value-in:a", "west");
      await assertHandleLabelPixelGap(page, "gcanvas.handle.1.value-out:value", "east");
    }
  });
});

// Regression for the hidden-mount `fitView` bug (specs/ux-graph-canvas.md's bug-fix note): found
// during the same "audit every dock tab for the Script tab's class of bug" pass. `BottomDock.tsx`
// keeps this tab's whole canvas subtree permanently mounted (`display: none`-hidden, never
// unmounted) so React Flow's own pan/zoom state survives a tab switch (UX-103) — but that means a
// document import/re-import that happens while parked on a DIFFERENT dock tab makes React Flow's
// one-time initial `fitView` compute against a 0x0 (hidden) container, permanently mis-scaling and
// mis-positioning the graph even after switching back.
test.describe("behavior-graph canvas — hidden-mount fitView regression", () => {
  test("importing a document while parked on a different dock tab still renders the graph correctly once the Behavior graph tab is opened", async ({
    page
  }) => {
    await page.goto("./");
    await page.getByTestId("dock.tab.data").click();
    await expect(page.getByTestId("dock.tab.data")).toHaveClass(/active/);

    await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");

    await page.getByTestId("dock.tab.graph").click();
    await expect(page.getByTestId("gcanvas.node.0")).toBeVisible();
    // The bug's actual symptom wasn't absence — React Flow still rendered the (mis-scaled,
    // mis-positioned) nodes technically inside the pane — so this real-pixel check, not just a DOM
    // presence check, is the meaningful regression guard: the fitView bug this fix addresses
    // shrinks the graph into a small corner of the pane, well under this fraction of the region.
    await assertRegionRendersContent(page.getByTestId("gcanvas.canvas"), { minNonBackgroundFraction: 0.02 });
  });
});
