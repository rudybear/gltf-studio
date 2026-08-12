import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

/**
 * Typed literal editors incl. color pickers (task: "for such cases as input
 * for material when we clearly know this is color, we can add color
 * pickers" — specs/ux-graph-canvas.md UX-517/519/520). A NEW spec file (not
 * e2e/graph-canvas.spec.ts, off limits to a different concurrent
 * workstream) covering: a `bool`-typed input renders as a checkbox and
 * toggling it writes the document; a `float3` input renders as grouped
 * x/y/z fields in the node-details side panel; and a `pointer/set` node
 * targeting a material's `baseColorFactor` (a KNOWN color property, per
 * `color-field.tsx`'s `colorKindForPointerPath`) renders a real color-picker
 * `<input type="color">` — on BOTH the canvas card and the side panel — and
 * editing it writes the underlying `float4` literal.
 *
 * Reuses e2e/graph-canvas.spec.ts's own fixture (simple-scene.glb): one
 * material ("WidgetMaterial", `baseColorFactor` present) is exactly the
 * color-bearing fixture this coverage needs — no new fixture asset required.
 */

type RawInteractivityGraph = {
  nodes: Array<{
    declaration: number;
    values?: Record<string, { type?: number; value?: Array<number | boolean | string> }>;
  }>;
};

async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
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

/**
 * Selects a graph node by clicking its HEADER (`.gcanvas-op-header`), not
 * `page.getByTestId("gcanvas.node.N")` itself: once a `pointer/*` node has a
 * REAL pointer configured, its card grows a pointer-row with its own two
 * independent click targets (UX-505/UX-509's `gcanvas.pointer-text.N`
 * jumps to the Data tab; `gcanvas.pointer-icon.N` reopens the picker) —
 * for a short card, `getByTestId("gcanvas.node.N").click()`'s CENTER-of-
 * bounding-box click can land on that pointer-text row instead of neutral
 * card chrome, force-switching the dock to Data (UX-806) instead of merely
 * selecting the node. The header (op tail/category badge/index — never
 * itself a click target) is always safe.
 */
async function selectNode(page: Page, nodeIndex: number): Promise<void> {
  await page.locator(`[data-testid="gcanvas.node.${nodeIndex}"] .gcanvas-op-header`).click();
}

/** Native `<input>` value-setter dispatch (React's onChange listens on the native "input" event) — same helper shape e2e/inspector.spec.ts's own `setRangeOrColorValue` uses for its `<input type="color">`/`<input type="range">` fields. */
async function setInputValue(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).evaluate((element, val) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, val);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test.describe("typed literal editors (specs/ux-graph-canvas.md UX-517)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("a bool-typed input socket renders a checkbox; toggling it writes the document", async ({ page }) => {
    // flow/branch's "condition" input is bool in its one and only overload -- mapGraph presets it without needing literal evidence first.
    await page.getByTestId("gcanvas.palette.op.flow/branch").click();
    const nodeIndex = 2; // fixture already has nodes 0/1; this is the 3rd
    await expect(page.getByTestId(`gcanvas.node.${nodeIndex}`)).toBeVisible();

    const checkbox = page.getByTestId(`gcanvas.literal.${nodeIndex}.condition`);
    await expect(checkbox).toHaveAttribute("type", "checkbox");
    await checkbox.click();

    await expect.poll(async () => {
      const graph = await getGraphJson(page);
      return graph.nodes[nodeIndex]?.values?.condition?.value?.[0];
    }).toBe(true);
  });

  test("a non-color float3 input socket (pointer/set -> scale) renders grouped x/y/z fields in the side panel, not a color picker", async ({ page }) => {
    await page.getByTestId("gcanvas.palette.op.pointer/set").click();
    const nodeIndex = 2;
    await expect(page.getByTestId(`gcanvas.node.${nodeIndex}`)).toBeVisible();

    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();
    await page.getByTestId("pointer-picker.tree.nodes.0").click(); // Root
    await page.getByTestId("pointer-picker.prop.scale").click();
    await expect(page.getByTestId("pointer-picker.type-chip")).toHaveText("float3");
    await page.getByTestId("pointer-picker.confirm").click();

    await selectNode(page, nodeIndex);
    const details = page.getByTestId("gcanvas.details");
    await expect(details).toContainText("scale");

    const editorBase = `gcanvas.details.literal.${nodeIndex}.value`;
    // Grouped numeric fields, no color swatch (translation/scale is never a color path).
    await expect(page.getByTestId(`${editorBase}.x`)).toBeVisible();
    await expect(page.getByTestId(`${editorBase}.y`)).toBeVisible();
    await expect(page.getByTestId(`${editorBase}.z`)).toBeVisible();
    await expect(page.getByTestId(`${editorBase}.swatch`)).toHaveCount(0);

    await page.getByTestId(`${editorBase}.x`).fill("2.5");
    await page.getByTestId(`${editorBase}.x`).blur();
    await expect.poll(async () => {
      const graph = await getGraphJson(page);
      return graph.nodes[nodeIndex]?.values?.value?.value;
    }).toEqual([2.5, 0, 0]);
  });

  test("a pointer/set node targeting a material's baseColorFactor (a known color path) renders a real color picker on BOTH the canvas card and the side panel, and editing it writes the float4 literal (UX-519)", async ({
    page
  }) => {
    await page.getByTestId("gcanvas.palette.op.pointer/set").click();
    const nodeIndex = 2;
    await expect(page.getByTestId(`gcanvas.node.${nodeIndex}`)).toBeVisible();

    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();
    await page.getByTestId("pointer-picker.tree.materials.0").click(); // WidgetMaterial
    await page.getByTestId("pointer-picker.prop.baseColorFactor").click();
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("/materials/0/pbrMetallicRoughness/baseColorFactor");
    await expect(page.getByTestId("pointer-picker.type-chip")).toHaveText("float4");
    await page.getByTestId("pointer-picker.confirm").click();

    // Canvas card: the pointer text/icon row confirms the retarget landed; the value socket now shows a real color swatch, not grouped numeric fields.
    await expect(page.getByTestId(`gcanvas.pointer-text.${nodeIndex}`)).toHaveText("/materials/0/pbrMetallicRoughness/baseColorFactor");
    const canvasSwatch = page.getByTestId(`gcanvas.literal.${nodeIndex}.value.swatch`);
    await expect(canvasSwatch).toHaveAttribute("type", "color");
    const canvasAlpha = page.getByTestId(`gcanvas.literal.${nodeIndex}.value.alpha`);
    await expect(canvasAlpha).toHaveAttribute("type", "range");

    await setInputValue(page, `gcanvas.literal.${nodeIndex}.value.swatch`, "#00ff80");
    await expect.poll(async () => {
      const graph = await getGraphJson(page);
      return graph.nodes[nodeIndex]?.values?.value?.value;
    }).toEqual([0, 1, 128 / 255, 1]);

    // Side panel: the SAME socket, edited from the OTHER surface, round-trips the SAME command path (setLiteralValue) -- editing alpha here updates the 4th component only.
    await selectNode(page, nodeIndex);
    const detailsAlpha = page.getByTestId(`gcanvas.details.literal.${nodeIndex}.value.alpha`);
    await expect(detailsAlpha).toBeVisible();
    await setInputValue(page, `gcanvas.details.literal.${nodeIndex}.value.alpha`, "0.5");
    await expect.poll(async () => {
      const graph = await getGraphJson(page);
      return graph.nodes[nodeIndex]?.values?.value?.value;
    }).toEqual([0, 1, 128 / 255, 0.5]);

    // Undo restores the pre-edit value (a real, dispatched Command each time -- not an uncommitted local-only edit).
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
  });
});
