import { test, expect, type Page } from "@playwright/test";
import { ACTIVE_CAMERA_FIXTURE_NAME, buildActiveCameraFixtureBytes } from "./active-camera-fixture.js";
import { GRAPH_CANVAS_VIEWPORT, waitForNodesSettled } from "./graph-canvas-test-helpers.js";

/**
 * UX-132 / PC-012: Play on a spec-invalid behavior graph is refused with the validation diagnostics
 * on screen (never a crash, never a silent no-op); fixing the graph lets Play start.
 *
 * The invalid graph is made the way a real author makes one: a `variable/set` node is added from the
 * palette and left unconfigured (its required `variables` config is missing -> the spec's Validation
 * rejects the graph, attributed to that node). Undo is the fix.
 */
test.use({ viewport: GRAPH_CANVAS_VIEWPORT });

const NEW_NODE = 5; // the fixture graph has nodes 0..4

async function importFixtureWithInvalidNode(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', {
    name: ACTIVE_CAMERA_FIXTURE_NAME,
    mimeType: "model/gltf-binary",
    buffer: buildActiveCameraFixtureBytes()
  });
  await expect(page.getByTestId("topbar.project-name")).toHaveText("active-camera-fixture");
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
  await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
  await expect(page.getByTestId("gcanvas.node.4")).toBeVisible();
  await waitForNodesSettled(page);
  await page.getByTestId("gcanvas.palette.op.variable/set").click();
  await expect(page.getByTestId(`gcanvas.node.${NEW_NODE}`)).toBeVisible();
  await waitForNodesSettled(page);
}

for (const engine of ["interpreter", "compiled"] as const) {
  test(`Play on an invalid graph is refused with on-screen diagnostics; fixing it lets Play start (${engine})`, async ({ page }) => {
    await importFixtureWithInvalidNode(page);
    await page.getByTestId("playbar.engine-picker").selectOption(engine);

    await page.getByTestId("playbar.play").click();

    // The panel names the problem and the offending node.
    const panel = page.getByTestId("viewport.play-blocked");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Play blocked");
    await expect(page.getByTestId("viewport.play-blocked.count")).toHaveText(/^\d+ errors?$/);
    const nodeButton = panel.getByRole("button", { name: `node ${NEW_NODE}` });
    await expect(nodeButton).toBeVisible();
    await expect(panel.getByTestId(/viewport\.play-blocked\.diagnostic\.\d+\.code/).first()).toHaveText(/^GV\d+$/);
    // A toast says so too, and nothing started.
    await expect(page.getByTestId("toast").filter({ hasText: "Play blocked" })).toBeVisible();
    await expect(page.getByTestId("viewport.play-overlay")).toHaveCount(0);

    // The Console tab carries the same diagnostics, with the node index.
    await page.getByTestId("dock.tab.console").click();
    const consolePanel = page.getByTestId("console.panel");
    await expect(consolePanel).toContainText("[play/validation] Play refused");
    await expect(consolePanel).toContainText(`(node ${NEW_NODE})`);

    // The jump button opens the Graph tab with that node selected.
    await nodeButton.click();
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId(`gcanvas.node.${NEW_NODE}`).locator("xpath=self::*[contains(@class,'gcanvas-op-node-selected')] | .//*[contains(@class,'gcanvas-op-node-selected')]").first()).toBeVisible();

    // Fix it (undo the unconfigured node) and Play again: the panel goes away and the graph runs.
    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId(`gcanvas.node.${NEW_NODE}`)).toHaveCount(0);
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();
    await expect(panel).toHaveCount(0);
    // On screen proof it really ticks: the camera-copy variable stopped being NaN.
    await expect
      .poll(async () => (await page.getByTestId("viewport.play-overlay.variable.camYfov").locator(".val").textContent()) ?? "NaN")
      .not.toBe("NaN");
    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("viewport.play-overlay")).toHaveCount(0);
  });
}

test("the Play blocked panel can be dismissed, and a document with a valid graph never shows it", async ({ page }) => {
  await importFixtureWithInvalidNode(page);
  await page.getByTestId("playbar.play").click();
  await expect(page.getByTestId("viewport.play-blocked")).toBeVisible();
  await page.getByTestId("viewport.play-blocked.dismiss").click();
  await expect(page.getByTestId("viewport.play-blocked")).toHaveCount(0);
  await page.getByTestId("topbar.undo").click();
  await page.getByTestId("playbar.play").click();
  await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();
  await expect(page.getByTestId("viewport.play-blocked")).toHaveCount(0);
});
