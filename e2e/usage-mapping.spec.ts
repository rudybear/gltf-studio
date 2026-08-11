import { PNG } from "pngjs";
import { test, expect, type Page } from "@playwright/test";
import { buildUsageMappingFixtureBytes, USAGE_MAPPING_FIXTURE_NAME, USAGE_FIXTURE_NODE } from "./usage-mapping-fixture.js";

/**
 * specs/ux-usage-mapping.md UX-11xx: the Inspector's "Used in behavior"
 * section (UX-1106..1109), the → Graph / → Script jumps (UX-1107/UX-1108),
 * and the two-tier blue-selection/amber-reference-highlight vocabulary
 * (UX-1110..1112) — end to end, on a dedicated small fixture
 * (e2e/usage-mapping-fixture.ts) built specifically to exercise all three
 * reference families' forward/reverse resolution rather than reusing a
 * fixture pinned by unrelated specs.
 */

const AMBER_REF = { r: 0xd9, g: 0xa4, b: 0x41 }; // RH-029/RH-030's reference-highlight color (0xd9a441)
const BLUE_SELECTION_ISH = { r: 0x4d, g: 0x9d, b: 0xff }; // the hover-outline blue (0x4d9dff) — used here only to confirm the amber count below is NOT that color

function countPixelsNear(buffer: Buffer, target: { r: number; g: number; b: number }, tolerance = 20): number {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    const idx = i << 2;
    if (Math.abs(data[idx] - target.r) <= tolerance && Math.abs(data[idx + 1] - target.g) <= tolerance && Math.abs(data[idx + 2] - target.b) <= tolerance) {
      count++;
    }
  }
  return count;
}

async function importFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.setInputFiles('[data-testid="topbar.import-input"]', {
    name: USAGE_MAPPING_FIXTURE_NAME,
    mimeType: "model/gltf-binary",
    buffer: buildUsageMappingFixtureBytes()
  });
  await expect(page.getByTestId("topbar.project-name")).toHaveText("usage-mapping-fixture");
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
}

test.describe("usage mapping (specs/ux-usage-mapping.md UX-11xx)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("Used in behavior section: correct row anatomy for a pointer-referenced node (UX-1100/UX-1106/UX-1107)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
    const row = page.getByTestId("inspector.usage.row.0");
    await expect(row).toContainText("pointer/set");
    await expect(row).toContainText("/nodes/0/translation");
    await expect(row).toContainText("Graph 0");
  });

  test("→ Graph jump switches the dock to Behavior graph, selects the referencing node, and opens its details card (UX-1107)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await page.getByTestId("inspector.usage.row.0.to-graph").click();

    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId("gcanvas.node.1")).toHaveClass(/gcanvas-op-node-selected/);
    await expect(page.getByTestId("gcanvas.details")).toContainText("pointer/set");
    await expect(page.getByTestId("gcanvas.details")).toContainText("/nodes/0/translation");
  });

  test("→ Graph jump's details card offers Reveal in viewport for a node with a scene reference (UX-1111)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await page.getByTestId("inspector.usage.row.0.to-graph").click();
    const reveal = page.getByTestId("gcanvas.details.reveal");
    await expect(reveal).toBeVisible();
    await reveal.click();
    await expect(page.getByTestId("toast")).toContainText("Framed");
  });

  test("→ Script jump selects the referencing node and cross-highlights its emitted identifier (UX-1108/UX-712)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
    await page.getByTestId("inspector.usage.row.0.to-script").click();

    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    await expect(page.getByTestId("script.panel")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15_000 })
      .toContain("rt.onSelect(");
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getSelectedText() ?? null))
      .toBe("onSelect");
  });

  test("REPRO: → Script jump on a pointer/set row (cold, script tab never opened) selects a real range in the emitted code", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
    await page.getByTestId("inspector.usage.row.0.to-script").click();

    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    await expect(page.getByTestId("script.panel")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15_000 })
      .toContain("/nodes/0/translation");
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getSelectedText() ?? null), { timeout: 15_000 })
      .toContain("/nodes/0/translation");
  });

  test("→ Script jump on a pointer/set row still works once the Script tab was already opened once (warm path, UX-1108)", async ({ page }) => {
    // Open the Script tab manually FIRST — Monaco mounts/loads on this open,
    // not on the jump below — before ever touching the usage row, so this
    // exercises the durable focus-request effect's already-ready branch
    // rather than its cold-mount queuing branch (which the REPRO/cold test
    // above covers).
    await page.getByTestId("dock.tab.script").click();
    await expect(page.getByTestId("script.panel")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15_000 })
      .not.toBe("");

    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
    await page.getByTestId("inspector.usage.row.0.to-script").click();

    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getSelectedText() ?? null), { timeout: 15_000 })
      .toContain("/nodes/0/translation");
  });

  test("→ Script is disabled with a tooltip for a pointer/set row whose graph node is unreachable from any event handler (UX-1114)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_04}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
    const row = page.getByTestId("inspector.usage.row.0");
    await expect(row).toContainText("pointer/set");
    const toScript = page.getByTestId("inspector.usage.row.0.to-script");
    await expect(toScript).toBeDisabled();
    await expect(toScript).toHaveAttribute("title", /isn't reachable/i);
    // → Graph is unaffected by this — the graph canvas doesn't need an
    // identifier, only the node's existence, so it stays enabled and usable
    // for an orphaned node exactly as it is for any other.
    await expect(page.getByTestId("inspector.usage.row.0.to-graph")).toBeEnabled();
  });

  test("zero-reference node shows the Attach-behavior stub; Ask Copilot opens with context; Phase-2 entries toast (UX-1109)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_03}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Not referenced in behavior");
    await expect(page.getByTestId("inspector.usage.section")).not.toContainText("Used in behavior (");

    await page.getByTestId("inspector.usage.attach").click();
    await expect(page.getByTestId("inspector.usage.attach-menu")).toHaveClass(/open/);

    // A Phase-2 stub entry: real, clickable, toasts rather than mutating.
    await page.getByTestId("inspector.usage.attach-menu.add-pointer-set").click();
    await expect(page.getByTestId("toast")).toContainText("coming in a later phase");

    await page.getByTestId("inspector.usage.attach").click();
    await page.getByTestId("inspector.usage.attach-menu.ask-copilot").click();
    await expect(page.getByTestId("right-panel.tab.copilot")).toHaveClass(/active/);
    await expect(page.getByTestId("copilot.context")).toContainText("Node #2");
  });

  test("reverse reference highlight: selecting a referencing graph node highlights the referenced scene node in the tree and viewport — amber, distinct from blue, coexisting with a different node's own selection, and clearing on deselect (UX-1110/UX-1112)", async ({
    page
  }) => {
    // Prop_01 gets the ordinary (blue) selection highlight...
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`)).toHaveClass(/selected/);

    const baselineBuffer = await page.getByTestId("viewport.mount").screenshot();
    const baselineAmber = countPixelsNear(baselineBuffer, AMBER_REF);

    // ...then selecting the event/onSelect graph node (references Prop_02,
    // nodeIndex: 1) drives Prop_02's amber reference highlight — a
    // DIFFERENT node than the one still holding the blue selection above,
    // demonstrating the two tiers coexist across different nodes at once.
    await page.getByTestId("dock.tab.graph").click();
    await page.getByTestId("gcanvas.node.0").click();

    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`)).toHaveClass(/ref-highlighted/);
    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`)).toHaveClass(/selected/); // unaffected

    const highlightedBuffer = await page.getByTestId("viewport.mount").screenshot();
    const highlightedAmber = countPixelsNear(highlightedBuffer, AMBER_REF);
    const highlightedBlueish = countPixelsNear(highlightedBuffer, BLUE_SELECTION_ISH);
    expect(highlightedAmber, "expected new amber-colored pixels once the reference highlight is active").toBeGreaterThan(baselineAmber + 20);
    // The amber outline and the pre-existing hover-blue tone are clearly
    // different colors — confirms this isn't a false-positive match from
    // some unrelated always-on blue UI chrome bleeding into the canvas.
    expect(highlightedAmber).toBeGreaterThan(highlightedBlueish);

    // Selecting Prop_02 in the tree TOO (now both selected AND reference-
    // highlighted on the SAME row) keeps both classes present — the
    // approved mockup's own coexistence rule for a shared row (CSS then
    // shows the blue treatment, but the amber condition still applies).
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`).click();
    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`)).toHaveClass(/selected/);
    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`)).toHaveClass(/ref-highlighted/);

    // Clearing: deselecting the graph node (clicking the empty canvas pane)
    // clears the reference highlight with no separate "close" gesture.
    // Clicked in the pane's bottom-right corner, well clear of both graph
    // nodes (laid out near the top-left at extras.gltfi {20,20}/{320,20}).
    await page.getByTestId("dock.tab.graph").click();
    const paneBox = (await page.locator(".react-flow__pane").boundingBox())!;
    await page.mouse.click(paneBox.x + paneBox.width - 20, paneBox.y + paneBox.height - 20);
    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`)).not.toHaveClass(/ref-highlighted/);

    await expect
      .poll(async () => countPixelsNear(await page.getByTestId("viewport.mount").screenshot(), AMBER_REF))
      .toBeLessThan(highlightedAmber);
  });
});
