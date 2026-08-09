import { test, expect, type Page } from "@playwright/test";
import { validateGraph, type VGraph } from "@gltfi/verify";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

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
  await page.goto("/");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await expect(page.getByTestId("gcanvas.node.0")).toBeVisible();
  await page.evaluate(() => window.__gltfStudioGraphCanvasTest!.setViewport({ x: 60, y: 60, zoom: 1 }));
  await expect
    .poll(() => page.locator(".react-flow__viewport").getAttribute("style"))
    .toContain("translate(60px, 60px) scale(1)");
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
  return graph.nodes.length - 1;
}

test.describe("pointer-picker dialog (UX-900..908)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("opens from a pointer node's blank ✎ icon; tree + property selection assembles the expected path; confirm rewrites the document and is undoable (UX-505/900/903/904/906, DOC-044)", async ({
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

    // (undo is already enabled here from adding the node itself, above —
    // the assertion below is about ONE MORE undo step correctly reverting
    // only the confirm, not the node's whole existence.)
    await page.getByTestId("pointer-picker.confirm").click();
    await expect(dialog).toBeHidden();

    let graph = await getGraphJson(page);
    const node = graph.nodes[nodeIndex]!;
    expect(node.configuration!.pointer.value).toEqual(["/nodes/3/translation"]);
    const typeIndex = node.configuration!.type.value[0] as number;
    expect(graph.types[typeIndex]).toEqual({ signature: "float3" });
    expect(validateGraph(graph as unknown as VGraph).ok).toBe(true);
    await expect(page.getByTestId(`gcanvas.pointer-text.${nodeIndex}`)).toHaveText("/nodes/3/translation");

    // Undoable (UX-906 writes through the normal command mechanism).
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    graph = await getGraphJson(page);
    expect(graph.nodes[nodeIndex]!.configuration ?? {}).toEqual({});
  });

  test("a per-component selection assembles a float component path (UX-903)", async ({ page }) => {
    const nodeIndex = await addBlankPointerSetNode(page);
    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();

    await page.getByTestId("pointer-picker.tree.nodes.2").click(); // Widget_Detail
    await page.getByTestId("pointer-picker.prop.rotation.twisty").click();
    await expect(page.getByTestId("pointer-picker.prop.rotation.1")).toBeVisible();
    await page.getByTestId("pointer-picker.prop.rotation.1").click();

    await expect(page.getByTestId("pointer-picker.path")).toHaveText("/nodes/3/rotation/1");
    await expect(page.getByTestId("pointer-picker.type-chip")).toHaveText("float");

    await page.getByTestId("pointer-picker.confirm").click();
    const graph = await getGraphJson(page);
    const node = graph.nodes[nodeIndex]!;
    expect(node.configuration!.pointer.value).toEqual(["/nodes/3/rotation/1"]);
  });

  test("reopening on an already-configured pointer node preselects its tree item, property, and expanded component (UX-907)", async ({ page }) => {
    const nodeIndex = await addBlankPointerSetNode(page);
    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();
    await page.getByTestId("pointer-picker.tree.nodes.2").click();
    await page.getByTestId("pointer-picker.prop.rotation.twisty").click();
    await page.getByTestId("pointer-picker.prop.rotation.1").click();
    await page.getByTestId("pointer-picker.confirm").click();

    // Reopen — never "blank" for a node with an existing valid path.
    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("/nodes/3/rotation/1");
    await expect(page.getByTestId("pointer-picker.type-chip")).toHaveText("float");
    await expect(page.getByTestId("pointer-picker.confirm")).toBeEnabled();
    await expect(page.getByTestId("pointer-picker.tree.nodes.2")).toHaveClass(/selected/);
    await expect(page.getByTestId("pointer-picker.prop.rotation.1")).toHaveClass(/selected/);
  });

  test("search filters the tree simultaneously across all three sections (UX-902)", async ({ page }) => {
    const nodeIndex = await addBlankPointerSetNode(page);
    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();

    await page.getByTestId("pointer-picker.search").fill("Detail");
    await expect(page.locator('[data-testid^="pointer-picker.tree.nodes."]')).toHaveCount(1);
    await expect(page.getByTestId("pointer-picker.tree.nodes.0")).toContainText("Widget_Detail");
    // "WidgetMaterial"/"Idle" don't match "Detail" — both other sections show no matches.
    await expect(page.locator('[data-testid^="pointer-picker.tree.materials."]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="pointer-picker.tree.animations."]')).toHaveCount(0);
  });

  test("selecting an Animations entry shows an explanatory note instead of a property list, and never enables confirm (UX-905/901)", async ({ page }) => {
    const nodeIndex = await addBlankPointerSetNode(page);
    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();

    await page.getByTestId("pointer-picker.tree.animations.0").click(); // "Idle"
    await expect(page.getByTestId("pointer-picker.props")).toContainText("Idle");
    await expect(page.getByTestId("pointer-picker.props")).toContainText("animation/start");
    await expect(page.locator('[data-testid^="pointer-picker.prop."]')).toHaveCount(0);
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("—");
    await expect(page.getByTestId("pointer-picker.confirm")).toBeDisabled();
  });

  test("Cancel closes without writing any config change (UX-908)", async ({ page }) => {
    const nodeIndex = await addBlankPointerSetNode(page);
    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();
    await page.getByTestId("pointer-picker.tree.nodes.2").click();
    await page.getByTestId("pointer-picker.prop.translation").click();

    await page.getByTestId("pointer-picker.cancel").click();
    await expect(page.getByTestId("pointer-picker.dialog")).toBeHidden();

    const graph = await getGraphJson(page);
    expect(graph.nodes[nodeIndex]!.configuration ?? {}).toEqual({});
  });

  test("clicking the pointer-config TEXT (not the icon) jumps to the Data tab at that path, force-switching the dock and highlighting the property (UX-509/UX-806)", async ({
    page
  }) => {
    const nodeIndex = await addBlankPointerSetNode(page);
    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();
    await page.getByTestId("pointer-picker.tree.nodes.2").click(); // Widget_Detail (translation IS literally authored in its JSON)
    await page.getByTestId("pointer-picker.prop.translation").click();
    await page.getByTestId("pointer-picker.confirm").click();

    await expect(page.getByTestId("dock.tab.data")).not.toHaveClass(/active/);
    await page.getByTestId(`gcanvas.pointer-text.${nodeIndex}`).click();

    await expect(page.getByTestId("dock.tab.data")).toHaveClass(/active/);
    await expect(page.getByTestId("data.panel")).toBeVisible();
    const translationLine = page.getByTestId("data.line.translation");
    await expect(translationLine).toBeVisible();
    await expect(translationLine).toHaveClass(/data-line-highlight/);
  });
});

test.describe("drag-drop node creation (UX-508/209)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("dragging a scene-tree row onto the canvas opens a drop-menu; choosing pointer/set creates a node prefilled with that node's translation path", async ({
    page
  }) => {
    // Raw HTML5 DataTransfer synthesis over Playwright's CDP bridge is the
    // flaky part (same rationale as `simulateConnect`) — `simulateExternalDrop`
    // invokes the SAME drop-menu-opening code path a real drag-drop does;
    // only the drag gesture itself is synthesized. The drop-menu OPTION
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

    const graph = await getGraphJson(page);
    const newIndex = graph.nodes.length - 1;
    const node = graph.nodes[newIndex]!;
    expect(graph.declarations[node.declaration]!.op).toBe("pointer/set");
    expect(node.configuration!.pointer.value).toEqual(["/nodes/1/translation"]);
    await expect(page.getByTestId(`gcanvas.node.${newIndex}`)).toBeVisible(); // details card opened (UX-507 via UX-508)
  });

  test("dragging the Animations-tab clip row onto the canvas and choosing animation/start creates a node targeting that clip", async ({ page }) => {
    await page.evaluate(() => window.__gltfStudioGraphCanvasTest!.simulateExternalDrop("anim", 0, { x: 160, y: 50 }));
    const menu = page.getByTestId("gcanvas.drop-menu");
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("gcanvas.drop-menu.animation-start")).toBeVisible();
    await expect(page.getByTestId("gcanvas.drop-menu.animation-stop")).toBeVisible();

    await page.getByTestId("gcanvas.drop-menu.animation-start").click();

    const graph = await getGraphJson(page);
    const newIndex = graph.nodes.length - 1;
    const node = graph.nodes[newIndex]!;
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

  test("variable/set's '+ New variable…' flow declares a variable and assigns it as ONE undoable step (validateGraph clean)", async ({ page }) => {
    test.slow();
    await page.getByTestId("gcanvas.palette.search").fill("variable/set");
    await page.getByTestId("gcanvas.palette.op.variable/set").click();
    let graph = await getGraphJson(page);
    const nodeIndex = graph.nodes.length - 1;

    await page.getByTestId(`gcanvas.node.${nodeIndex}`).click();
    const details = page.getByTestId("gcanvas.details");
    await expect(details).toBeVisible();

    const select = page.getByTestId(`gcanvas.details.config.variable-select.${nodeIndex}`);
    await expect(select).toBeVisible();
    // No variables declared yet — only the "+ New variable…" option exists.
    await select.selectOption({ label: "+ New variable…" });

    await page.getByTestId(`gcanvas.details.config.variable-select.${nodeIndex}.new-id`).fill("speedVar");
    await page.getByTestId(`gcanvas.details.config.variable-select.${nodeIndex}.new-confirm`).click();

    graph = await getGraphJson(page);
    expect(graph.variables).toHaveLength(1);
    expect(graph.variables![0]!.id).toBe("speedVar");
    expect(graph.nodes[nodeIndex]!.configuration!.variables.value).toEqual([0]);
    expect(validateGraph(graph as unknown as VGraph).ok).toBe(true);

    // ONE combined undo step removes BOTH the declaration and the assignment
    // — reverting to the SAME bare, unconfigured `variable/set` node the
    // node was in right after being added from the palette. That bare state
    // is itself flagged invalid by the validator (a `variable/set` with no
    // `variables` config, same GV027 finding e2e/graph-canvas.spec.ts's own
    // "a validation badge appears for an invalid node" test exercises) —
    // "validateGraph clean" is asserted on the CONFIGURED state above, not
    // here; this step only re-confirms undo didn't leave anything ELSE
    // dangling (no stray variable, no stray config field) beyond that
    // already-expected bare-node state.
    await page.getByTestId("topbar.undo").click();
    graph = await getGraphJson(page);
    expect(graph.variables ?? []).toHaveLength(0);
    expect(graph.nodes[nodeIndex]!.configuration ?? {}).toEqual({});
    await expect(page.getByTestId(`gcanvas.badge.${nodeIndex}`)).toBeVisible();
  });

  test("selecting an already-declared variable assigns its index directly (no new declaration)", async ({ page }) => {
    // First declare a variable via the "new…" flow on one node...
    await page.getByTestId("gcanvas.palette.search").fill("variable/set");
    await page.getByTestId("gcanvas.palette.op.variable/set").click();
    let graph = await getGraphJson(page);
    const firstNodeIndex = graph.nodes.length - 1;
    await page.getByTestId(`gcanvas.node.${firstNodeIndex}`).click();
    await page.getByTestId(`gcanvas.details.config.variable-select.${firstNodeIndex}`).selectOption({ label: "+ New variable…" });
    await page.getByTestId(`gcanvas.details.config.variable-select.${firstNodeIndex}.new-id`).fill("v0");
    await page.getByTestId(`gcanvas.details.config.variable-select.${firstNodeIndex}.new-confirm`).click();

    // ...then a SECOND variable/set node selects that SAME existing variable via the dropdown.
    await page.getByTestId("gcanvas.palette.op.variable/set").click();
    graph = await getGraphJson(page);
    const secondNodeIndex = graph.nodes.length - 1;
    await page.getByTestId(`gcanvas.node.${secondNodeIndex}`).click();
    await page.getByTestId(`gcanvas.details.config.variable-select.${secondNodeIndex}`).selectOption({ label: "v0" });

    graph = await getGraphJson(page);
    expect(graph.variables).toHaveLength(1); // still just the one declaration
    expect(graph.nodes[secondNodeIndex]!.configuration!.variables.value).toEqual([0]);
  });
});
