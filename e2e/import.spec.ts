import { test, expect } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

test.describe("import a .glb", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
    // Project name updates once import + the initial StorageProvider save resolve.
    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  });

  test("scene tree shows the real hierarchy from the imported document (UX-200/UX-201)", async ({ page }) => {
    const rows = page.getByTestId("scene-tree.list").locator(".tree-row");
    await expect(rows).toHaveCount(4);
    await expect(page.getByTestId("scene-tree.row.0")).toContainText("Root");
    await expect(page.getByTestId("scene-tree.row.1")).toContainText("Widget");
    await expect(page.getByTestId("scene-tree.row.2")).toContainText("Widget_Detail");
    await expect(page.getByTestId("scene-tree.row.3")).toContainText("KeyLight");

    // UX-201: collapsing Widget (row 1, which has one child) hides Widget_Detail (row 2).
    await page.getByTestId("scene-tree.row.1.twisty").click();
    await expect(page.getByTestId("scene-tree.row.2")).toBeHidden();
    await page.getByTestId("scene-tree.row.1.twisty").click();
    await expect(page.getByTestId("scene-tree.row.2")).toBeVisible();
  });

  test("show-indices toggle appends #N to every row label, session-only (UX-203/UX-204)", async ({ page }) => {
    await expect(page.getByTestId("scene-tree.row.0")).not.toContainText("#0");
    await page.getByTestId("scene-tree.toggle-indices").click();
    await expect(page.getByTestId("scene-tree.row.0")).toContainText("#0");
    await expect(page.getByTestId("scene-tree.row.1")).toContainText("#1");
  });

  test("selecting a node passively updates the Data tab without switching the dock tab (UX-202/UX-805)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.1").click();
    // Still on the default "Behavior graph" tab — selection never force-switches (UX-805).
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);

    await page.getByTestId("dock.tab.data").click();
    await expect(page.getByTestId("data.breadcrumb")).toContainText("nodes");
    await expect(page.getByTestId("data.breadcrumb")).toContainText("1");
    await expect(page.getByTestId("data.line.name")).toContainText("Widget");
  });

  test("Data tab breadcrumb + cross-reference links navigate between containers (UX-800/UX-802/UX-806)", async ({ page }) => {
    // Clicking an asset-browser row is a deliberate "inspect this" action: it force-switches to Data (UX-211/UX-806).
    await page.getByTestId("asset-browser.tab.meshes").click();
    await page.getByTestId("asset-browser.meshes.0").click();
    await expect(page.getByTestId("dock.tab.data")).toHaveClass(/active/);
    await expect(page.getByTestId("data.breadcrumb")).toContainText("meshes");

    // Expand primitives -> [0] -> material, then follow the cross-reference link to /materials/0.
    await page.getByTestId("data.line.primitives").locator(".data-twisty").click();
    await page.locator(".data-children .data-twisty").first().click();
    await page.locator(".data-link").filter({ hasText: "0" }).first().click();
    await expect(page.getByTestId("data.breadcrumb")).toContainText("materials");
    await expect(page.getByTestId("data.line.name")).toContainText("WidgetMaterial");
  });

  test("undo/redo stay disabled after import (import creates the document; it does not push a Command)", async ({ page }) => {
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await expect(page.getByTestId("topbar.redo")).toBeDisabled();
  });
});
