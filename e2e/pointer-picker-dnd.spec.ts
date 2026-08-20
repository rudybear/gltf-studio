import { test, expect, type Page } from "@playwright/test";
import { validateGraph, type VGraph } from "@gltfi/verify";
import { FIXTURE_GLB_PATH } from "./global-setup.js";
import { clickNodeHeader, waitForNodesSettled } from "./graph-canvas-test-helpers.js";

/**
 * M4 pointer picker, drag-to-graph, and config editors:
 *   - specs/ux-pointer-picker.md UX-900..908 (the dialog itself)
 *   - specs/ux-graph-canvas.md UX-505/508/509 (the two pointer-node click
 *     targets, the drop-menu, and the Data-tab jump)
 *   - specs/ux-scene-tree.md UX-209 (the scene-tree-row drag source)
 *   - specs/ux-data-tab.md UX-806 (force-switch + highlight on the jump)
 *   - the node-details config-field editor (variable selector + "new
 *     variable…" flow, DOC-044's `GraphEdit.setNodeConfig`)
 *
 * The fixture asset (e2e/global-setup.ts) has 4 scene nodes — 0 Root,
 * 1 Widget (mesh), 2 KeyLight, 3 Widget_Detail (mesh, translation
 * explicitly authored `[10,10,10]` — used where a test needs the Data tab
 * to have an actual JSON line to highlight) — in scene-tree/pointer-picker
 * depth-first order [Root, Widget, Widget_Detail, KeyLight]; one material
 * ("WidgetMaterial"); one animation clip ("Idle"); and a small real
 * KHR_interactivity graph (node 0 event/onStart, node 1 math/add).
 *
 * Tests below are DELIBERATELY consolidated into a handful of longer,
 * sequential scenarios rather than one `test()` per assertion (each
 * `test()` here pays for a fresh page load + a real ELK layout pass, and
 * this suite runs alongside graph-canvas.spec.ts's own ELK/React-Flow-heavy
 * tests under this project's shared 4-worker cap — see
 * playwright.config.ts's own comment on why that cap exists) — fewer,
 * chunkier tests still cover every requirement cited without multiplying
 * that fixed per-test overhead.
 */

type RawInteractivityGraph = {
  types: Array<{ signature: string }>;
  declarations: Array<{ op: string; extension?: string }>;
  variables?: Array<{ id?: string; type: number; value?: unknown[] }>;
  nodes: Array<{
    declaration: number;
    values?: Record<string, { type?: number; value?: unknown[]; node?: number; socket?: string }>;
    flows?: Record<string, unknown>;
    configuration?: Record<string, { value: unknown[] }>;
    extras?: { gltfi?: { x: number; y: number } };
  }>;
};

async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await expect(page.getByTestId("gcanvas.node.0")).toBeVisible();
  await page.evaluate(() => window.__gltfStudioGraphCanvasTest!.setViewport({ x: 60, y: 60, zoom: 1 }));
  await expect
    .poll(() => page.locator(".react-flow__viewport").getAttribute("style"))
    .toContain("translate(60px, 60px) scale(1)");
  // Bug-fix note (deflake, see graph-canvas-test-helpers.ts's own doc
  // comment): reproduced offline under artificial CPU contention as
  // `gcanvas.pointer-icon.N`'s click timing out, `.gcanvas-root` (then a
  // neighboring row on the same card) intercepting the point Playwright
  // computed before the node's real size had settled — the same node-
  // click/resize race e2e/graph-canvas.spec.ts's own `waitForNodesSettled`
  // guards against, just not previously applied in this file.
  await waitForNodesSettled(page);
}

async function getGraphJson(page: Page): Promise<RawInteractivityGraph> {
  const json = await page.evaluate(() => window.__gltfStudioGraphTest!.getDocumentJson());
  return (json as { extensions: { KHR_interactivity: { graphs: RawInteractivityGraph[] } } }).extensions.KHR_interactivity.graphs[0];
}

/** Adds a blank `pointer/set` node via the palette (no path prefilled — unlike drag-drop/Inspector) and returns its graph-node index. */
async function addBlankPointerSetNode(page: Page): Promise<number> {
  await page.getByTestId("gcanvas.palette.search").fill("pointer/set");
  await page.getByTestId("gcanvas.palette.op.pointer/set").click();
  const graph = await getGraphJson(page);
  const nodeIndex = graph.nodes.length - 1;
  await expect(page.getByTestId(`gcanvas.node.${nodeIndex}`)).toBeVisible();
  await waitForNodesSettled(page); // just added — see importFixture's own doc comment above
  return nodeIndex;
}

test.describe("pointer-picker dialog (UX-900..908)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("blank pointer node's icon opens the dialog; tree/property/component selection assembles the path live; confirm rewrites the document (undoable); reopening preselects it; the config text then jumps to the Data tab (UX-505/900/903/904/906/907/509/806, DOC-044)", async ({
    page
  }) => {
    test.slow();
    const nodeIndex = await addBlankPointerSetNode(page);
    // UX-505: the icon is present even before any pointer is configured.
    await expect(page.getByTestId(`gcanvas.pointer-text.${nodeIndex}`)).toHaveText("(no pointer set)");

    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();
    const dialog = page.getByTestId("pointer-picker.dialog");
    await expect(dialog).toBeVisible();
    // Blank node -> nothing preselected (UX-907's converse).
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("—");
    await expect(page.getByTestId("pointer-picker.confirm")).toBeDisabled();

    // Nodes depth-first order: 0 Root, 1 Widget, 2 Widget_Detail, 3 KeyLight.
    await page.getByTestId("pointer-picker.tree.nodes.2").click(); // Widget_Detail (scene node index 3)
    await expect(page.getByTestId("pointer-picker.prop.translation")).toBeVisible();
    await page.getByTestId("pointer-picker.prop.translation").click();

    // UX-904: selecting a property row LIVE-assembles the footer's path + type — no separate "apply" step.
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("/nodes/3/translation");
    await expect(page.getByTestId("pointer-picker.type-chip")).toHaveText("float3");
    await expect(page.getByTestId("pointer-picker.confirm")).toBeEnabled();

    await page.getByTestId("pointer-picker.confirm").click();
    await expect(dialog).toBeHidden();
    // Bug-fix note (deflake, see graph-canvas-test-helpers.ts's own doc
    // comment): the confirm above just gave this node a real pointer-text
    // row (swapping "(no pointer set)" for a real path), resizing its card
    // — the pointer-icon re-open click further down races that resize
    // without this wait.
    await waitForNodesSettled(page);

    let graph = await getGraphJson(page);
    let node = graph.nodes[nodeIndex]!;
    expect(node.configuration!.pointer.value).toEqual(["/nodes/3/translation"]);
    const typeIndex = node.configuration!.type.value[0] as number;
    expect(graph.types[typeIndex]).toEqual({ signature: "float3" });
    expect(validateGraph(graph as unknown as VGraph).ok).toBe(true);
    await expect(page.getByTestId(`gcanvas.pointer-text.${nodeIndex}`)).toHaveText("/nodes/3/translation");

    // Undoable (UX-906 writes through the normal command mechanism) — reverts ONLY the confirm, not the node's own existence.
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    graph = await getGraphJson(page);
    expect(graph.nodes[nodeIndex]!.configuration ?? {}).toEqual({});

    // Reopen, retarget to a per-component path this time (UX-903), and confirm again.
    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("—"); // still nothing configured after the undo above
    await page.getByTestId("pointer-picker.tree.nodes.2").click();
    await page.getByTestId("pointer-picker.prop.rotation.twisty").click();
    await expect(page.getByTestId("pointer-picker.prop.rotation.1")).toBeVisible();
    await page.getByTestId("pointer-picker.prop.rotation.1").click();
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("/nodes/3/rotation/1");
    await expect(page.getByTestId("pointer-picker.type-chip")).toHaveText("float");
    await page.getByTestId("pointer-picker.confirm").click();
    await waitForNodesSettled(page); // same resize-race rationale as above

    graph = await getGraphJson(page);
    node = graph.nodes[nodeIndex]!;
    expect(node.configuration!.pointer.value).toEqual(["/nodes/3/rotation/1"]);

    // Reopening on this NOW-configured (component) pointer preselects tree item, property, AND its expanded component (UX-907).
    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("/nodes/3/rotation/1");
    await expect(page.getByTestId("pointer-picker.type-chip")).toHaveText("float");
    await expect(page.getByTestId("pointer-picker.confirm")).toBeEnabled();
    await expect(page.getByTestId("pointer-picker.tree.nodes.2")).toHaveClass(/selected/);
    await expect(page.getByTestId("pointer-picker.prop.rotation.1")).toHaveClass(/selected/);

    // Retarget once more to the WHOLE translation vector (a literal JSON key on Widget_Detail) so the Data-tab jump below has a real line to highlight.
    await page.getByTestId("pointer-picker.prop.translation").click();
    await page.getByTestId("pointer-picker.confirm").click();
    await waitForNodesSettled(page); // same resize-race rationale as above

    // UX-509/UX-806: clicking the pointer-config TEXT (not the icon) force-switches the Data tab to that path, with the property highlighted.
    await expect(page.getByTestId("dock.tab.data")).not.toHaveClass(/active/);
    await page.getByTestId(`gcanvas.pointer-text.${nodeIndex}`).click();
    await expect(page.getByTestId("dock.tab.data")).toHaveClass(/active/);
    await expect(page.getByTestId("data.panel")).toBeVisible();
    const translationLine = page.getByTestId("data.line.translation");
    await expect(translationLine).toBeVisible();
    await expect(translationLine).toHaveClass(/data-line-highlight/);
  });

  test("search filters the tree simultaneously across all three sections (UX-902); an Animations entry shows an explanatory note instead of a property list (UX-905/901); Cancel closes without writing (UX-908)", async ({
    page
  }) => {
    const nodeIndex = await addBlankPointerSetNode(page);
    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();

    await page.getByTestId("pointer-picker.search").fill("Detail");
    await expect(page.locator('[data-testid^="pointer-picker.tree.nodes."]')).toHaveCount(1);
    await expect(page.getByTestId("pointer-picker.tree.nodes.0")).toContainText("Widget_Detail");
    // "WidgetMaterial"/"Idle" don't match "Detail" — both other sections show no matches.
    await expect(page.locator('[data-testid^="pointer-picker.tree.materials."]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="pointer-picker.tree.animations."]')).toHaveCount(0);
    await page.getByTestId("pointer-picker.search").fill("");

    await page.getByTestId("pointer-picker.tree.animations.0").click(); // "Idle"
    await expect(page.getByTestId("pointer-picker.props")).toContainText("Idle");
    await expect(page.getByTestId("pointer-picker.props")).toContainText("animation/start");
    await expect(page.locator('[data-testid^="pointer-picker.prop."]')).toHaveCount(0);
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("—");
    await expect(page.getByTestId("pointer-picker.confirm")).toBeDisabled();

    await page.getByTestId("pointer-picker.tree.nodes.2").click();
    await page.getByTestId("pointer-picker.prop.translation").click();
    await page.getByTestId("pointer-picker.cancel").click();
    await expect(page.getByTestId("pointer-picker.dialog")).toBeHidden();

    const graph = await getGraphJson(page);
    expect(graph.nodes[nodeIndex]!.configuration ?? {}).toEqual({});
  });
});

test.describe("drag-drop node creation (UX-508/209)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("dragging a scene-tree row opens a drop-menu whose pointer/set option creates a prefilled node; dragging the Animations-tab clip row opens one whose animation/start option targets that clip", async ({
    page
  }) => {
    // Raw HTML5 DataTransfer synthesis over Playwright's CDP bridge is the
    // flaky part (same rationale as `simulateConnect`) — `simulateExternalDrop`
    // invokes the SAME drop-menu-opening code path a real drag-drop does;
    // only the drag gesture itself is synthesized. Every drop-menu OPTION
    // CLICK below is a real Playwright click against the real rendered menu.
    // A small flow position (near the canvas pane's own top-left) — the
    // bottom dock occupies only the page's bottom ~300px, so a larger flow
    // y would translate to a screen position clipped below the 720px test
    // viewport (this menu is `position: fixed`, so no scroll can reach it).
    await page.evaluate(() => window.__gltfStudioGraphCanvasTest!.simulateExternalDrop("node", 1, { x: 150, y: 40 }));
    const menu = page.getByTestId("gcanvas.drop-menu");
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("gcanvas.drop-menu.pointer-get")).toBeVisible();
    await expect(page.getByTestId("gcanvas.drop-menu.pointer-set")).toBeVisible();
    await expect(page.getByTestId("gcanvas.drop-menu.pointer-interpolate")).toBeVisible();
    await expect(page.getByTestId("gcanvas.drop-menu.event-onselect")).toBeVisible();

    await page.getByTestId("gcanvas.drop-menu.pointer-set").click();
    await expect(menu).toBeHidden();

    let graph = await getGraphJson(page);
    const pointerNodeIndex = graph.nodes.length - 1;
    let node = graph.nodes[pointerNodeIndex]!;
    expect(graph.declarations[node.declaration]!.op).toBe("pointer/set");
    expect(node.configuration!.pointer.value).toEqual(["/nodes/1/translation"]);
    await expect(page.getByTestId(`gcanvas.node.${pointerNodeIndex}`)).toBeVisible(); // details card opened (UX-507 via UX-508)

    await page.evaluate(() => window.__gltfStudioGraphCanvasTest!.simulateExternalDrop("anim", 0, { x: 160, y: 50 }));
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("gcanvas.drop-menu.animation-start")).toBeVisible();
    await expect(page.getByTestId("gcanvas.drop-menu.animation-stop")).toBeVisible();
    await page.getByTestId("gcanvas.drop-menu.animation-start").click();

    graph = await getGraphJson(page);
    const animNodeIndex = graph.nodes.length - 1;
    node = graph.nodes[animNodeIndex]!;
    expect(graph.declarations[node.declaration]!.op).toBe("animation/start");
    expect(node.values!.animation!.value).toEqual([0]);
    const refTypeIndex = node.values!.animation!.type as number;
    expect(graph.types[refTypeIndex]).toEqual({ signature: "ref" });
    expect(validateGraph(graph as unknown as VGraph).ok).toBe(true);
  });
});

test.describe("config-field editor: variable selector (node-details.tsx)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("variable/set's '+ New variable…' flow declares a variable and assigns it as ONE undoable step (validateGraph clean); a SECOND node then selects that same declared variable directly", async ({
    page
  }) => {
    test.slow();
    await page.getByTestId("gcanvas.palette.search").fill("variable/set");
    await page.getByTestId("gcanvas.palette.op.variable/set").click();
    let graph = await getGraphJson(page);
    const firstNodeIndex = graph.nodes.length - 1;
    await expect(page.getByTestId(`gcanvas.node.${firstNodeIndex}`)).toBeVisible();
    // Bug-fix note (deflake, see graph-canvas-test-helpers.ts's own doc
    // comment): node just added, size not settled yet — same node-click/
    // resize race as this file's importFixture/addBlankPointerSetNode.
    // Clicking the header (not the node's own testid, whose geometric
    // CENTER can land on a config row once real size settles) closes the
    // geometry half of the race the wait alone doesn't.
    await waitForNodesSettled(page);
    await clickNodeHeader(page, firstNodeIndex);
    const details = page.getByTestId("gcanvas.details");
    await expect(details).toBeVisible();

    const select = page.getByTestId(`gcanvas.details.config.variable-select.${firstNodeIndex}`);
    await expect(select).toBeVisible();
    // The fixture already declares one variable ("counter", e2e/global-setup.ts,
    // for e2e/script.spec.ts's Script-tab coverage) — this flow adds a SECOND,
    // via "+ New variable…", rather than starting from zero declared variables.
    const before = await getGraphJson(page);
    expect(before.variables).toHaveLength(1);
    await select.selectOption({ label: "+ New variable…" });
    await page.getByTestId(`gcanvas.details.config.variable-select.${firstNodeIndex}.new-id`).fill("speedVar");
    await page.getByTestId(`gcanvas.details.config.variable-select.${firstNodeIndex}.new-confirm`).click();

    graph = await getGraphJson(page);
    expect(graph.variables).toHaveLength(2);
    expect(graph.variables![1]!.id).toBe("speedVar");
    expect(graph.nodes[firstNodeIndex]!.configuration!.variables.value).toEqual([1]);
    expect(validateGraph(graph as unknown as VGraph).ok).toBe(true);

    // ONE combined undo step removes BOTH the declaration and the assignment
    // — reverting to the SAME bare, unconfigured `variable/set` node the
    // node was in right after being added from the palette. That bare state
    // is itself flagged invalid by the validator (a `variable/set` with no
    // `variables` config, same GV027 finding e2e/graph-canvas.spec.ts's own
    // "a validation badge appears for an invalid node" test exercises) —
    // "validateGraph clean" is asserted on the CONFIGURED state above, not
    // here; this step only re-confirms undo didn't leave anything ELSE
    // dangling (no stray variable beyond the fixture's own "counter", no
    // stray config field) beyond that already-expected bare-node state.
    await page.getByTestId("topbar.undo").click();
    graph = await getGraphJson(page);
    expect(graph.variables).toHaveLength(1);
    expect(graph.variables![0]!.id).toBe("counter");
    expect(graph.nodes[firstNodeIndex]!.configuration ?? {}).toEqual({});
    await expect(page.getByTestId(`gcanvas.badge.${firstNodeIndex}`)).toBeVisible();
    // Redo to get the "speedVar" declaration back for the second node below.
    await page.getByTestId("topbar.redo").click();
    graph = await getGraphJson(page);
    expect(graph.variables).toHaveLength(2);

    // A SECOND variable/set node selects that SAME existing variable via the dropdown (no new declaration).
    await page.getByTestId("gcanvas.palette.op.variable/set").click();
    graph = await getGraphJson(page);
    const secondNodeIndex = graph.nodes.length - 1;
    await expect(page.getByTestId(`gcanvas.node.${secondNodeIndex}`)).toBeVisible();
    await waitForNodesSettled(page); // same resize-race rationale as above
    await clickNodeHeader(page, secondNodeIndex);
    await page.getByTestId(`gcanvas.details.config.variable-select.${secondNodeIndex}`).selectOption({ label: "speedVar" });

    graph = await getGraphJson(page);
    expect(graph.variables).toHaveLength(2); // still just the two declarations (counter, speedVar)
    expect(graph.nodes[secondNodeIndex]!.configuration!.variables.value).toEqual([1]);
  });
});
