import { test, expect } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";
import { waitForNodesSettled } from "./graph-canvas-test-helpers.js";

/**
 * Regression: at the common 1280x720 laptop size the React Flow pane used to be ~216px wide
 * (palette 234 + details 260 inside a 710px dock), narrower than one node card (221px).
 * Narrow graph canvases start with the palette and details panels as collapsed rails; expanded, they float over the pane.
 */
test.describe("behavior-graph pane width at laptop sizes", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("the graph pane gets >= 600px and the side panels expand/collapse via accessible toggles", async ({ page }) => {
    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
    await expect(page.getByTestId("gcanvas.node.0")).toBeVisible();
    await waitForNodesSettled(page);

    const paneWidth = async (): Promise<number> => (await page.locator(".react-flow").first().boundingBox())!.width;
    expect(await paneWidth()).toBeGreaterThanOrEqual(600);

    const paletteToggle = page.getByTestId("gcanvas.palette.toggle");
    await expect(paletteToggle).toHaveAttribute("aria-expanded", "false");
    const detailsToggle = page.getByTestId("gcanvas.details.toggle");
    await expect(detailsToggle).toHaveAttribute("aria-expanded", "false");

    await paletteToggle.click();
    await expect(paletteToggle).toHaveAttribute("aria-expanded", "true");
    await paletteToggle.click();

    // Narrow mode: panels float over the pane, so opening them never resizes it.
    const before = await paneWidth();
    await paletteToggle.click();
    await expect(page.getByTestId("gcanvas.palette.search")).toBeVisible();
    expect(Math.abs((await paneWidth()) - before)).toBeLessThanOrEqual(2);
    await paletteToggle.click();

    await detailsToggle.click();
    await expect(page.getByTestId("gcanvas.details")).toBeVisible();
    expect(Math.abs((await paneWidth()) - before)).toBeLessThanOrEqual(2);
    await detailsToggle.click();
    await expect(page.getByTestId("gcanvas.details")).toHaveCount(0);

    // Selecting a node opens its details overlay without moving the pane.
    await page.getByTestId("gcanvas.node.1").locator(".gcanvas-op-header").click();
    await expect(page.getByTestId("gcanvas.node.1")).toHaveClass(/gcanvas-op-node-selected/);
    await expect(page.getByTestId("gcanvas.details")).toBeVisible();
    expect(Math.abs((await paneWidth()) - before)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: process.env.PANE_SHOT ?? "test-results/graph-pane-selected.png" });
  });
});
