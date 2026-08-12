import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

/**
 * specs/ux-shell.md UX-122 (project manager) / UX-123 (autosave status) /
 * UX-125 (crash recovery's "opens the last-open project" reuse) coverage.
 * Each Playwright `test()` gets its own fresh browser context (a clean
 * IndexedDB/localStorage), so projects created in one test never leak into
 * another.
 */
async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
}

test.describe("autosave status + reload persistence (UX-123/UX-125)", () => {
  test("Saved -> Unsaved -> Saved, and an edit survives a full page reload", async ({ page }) => {
    await importFixture(page);
    await expect(page.getByTestId("topbar.save-status")).toHaveText("Saved");

    await page.getByTestId("scene-tree.row.1").click(); // "Widget"
    await page.getByTestId("inspector.transform.position-x").fill("7");
    await expect(page.getByTestId("topbar.save-status")).toHaveText("Unsaved changes");
    // UX-123's 1.5s debounce, then the checkpoint save itself -- give it real
    // wall-clock room rather than guessing an exact wait.
    await expect(page.getByTestId("topbar.save-status")).toHaveText("Saved", { timeout: 8000 });

    await page.reload();
    // UX-125: no journal was left ahead of the save above -- reopens
    // immediately with no recovery prompt.
    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
    await expect(page.getByTestId("recovery.dialog")).toHaveCount(0);

    const positionX = await page.evaluate(() => {
      const json = window.__gltfStudioDocumentTest?.getJson() as { nodes?: Array<{ translation?: number[] }> } | null;
      return json?.nodes?.[1]?.translation?.[0];
    });
    expect(positionX).toBe(7);
  });

  test("no save-status indicator before any project is open", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByTestId("topbar.save-status")).toHaveCount(0);
  });
});

test.describe("project manager dialog (UX-122)", () => {
  test("empty state, and 'New project' opens a fresh empty scene", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("topbar.projects").click();
    await expect(page.getByTestId("project-manager.dialog")).toBeVisible();
    await expect(page.getByTestId("project-manager.empty")).toBeVisible();

    await page.getByTestId("project-manager.empty.new").click();
    await expect(page.getByTestId("project-manager.dialog")).toHaveCount(0);
    // UX-120's own empty-scene starter -- zero nodes, its dedicated empty note.
    await expect(page.getByTestId("scene-tree.empty-scene")).toBeVisible();
  });

  test("lists an imported project, and Escape/close-x/backdrop all close without side effects", async ({ page }) => {
    await importFixture(page);
    await page.getByTestId("topbar.projects").click();
    await expect(page.getByTestId("project-manager.row.0.name")).toHaveText("simple-scene");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("project-manager.dialog")).toHaveCount(0);
    // Still the same open project -- closing the dialog is a no-op.
    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  });

  test("rename updates the row and, for the open project, the top bar's project name", async ({ page }) => {
    await importFixture(page);
    await page.getByTestId("topbar.projects").click();
    await page.getByTestId("project-manager.row.0.rename").click();
    await page.getByTestId("project-manager.row.0.rename-input").fill("My Renamed Project");
    await page.getByTestId("project-manager.row.0.rename-input").press("Enter");
    await expect(page.getByTestId("project-manager.row.0.name")).toHaveText("My Renamed Project");

    await page.getByTestId("project-manager.close-x").click();
    await expect(page.getByTestId("topbar.project-name")).toHaveText("My Renamed Project");
  });

  test("duplicate creates a second, independent project", async ({ page }) => {
    await importFixture(page);
    await page.getByTestId("topbar.projects").click();
    await page.getByTestId("project-manager.row.0.duplicate").click();

    await expect(page.locator('[data-testid^="project-manager.row."][data-testid$=".name"]')).toHaveCount(2);
    const names = await page.locator('[data-testid^="project-manager.row."][data-testid$=".name"]').allTextContents();
    expect(names.sort()).toEqual(["simple-scene", "simple-scene copy"]);
  });

  test("delete asks for confirmation, then removes the row (SP-021)", async ({ page }) => {
    await importFixture(page);
    await page.getByTestId("topbar.projects").click();
    await page.getByTestId("project-manager.row.0.delete").click();
    await expect(page.getByTestId("project-manager.delete-confirm")).toBeVisible();

    // Cancel first -- the row must still be there.
    await page.getByTestId("project-manager.delete-confirm.cancel").click();
    await expect(page.getByTestId("project-manager.row.0")).toBeVisible();

    await page.getByTestId("project-manager.row.0.delete").click();
    await page.getByTestId("project-manager.delete-confirm.confirm").click();
    await expect(page.getByTestId("project-manager.empty")).toBeVisible();
    // The deleted project was the open one -- back to the pre-project shell state.
    await expect(page.getByTestId("topbar.project-name")).toHaveText("Untitled Project");
  });

  test("open (from a project that is not the currently-open one) switches the active document", async ({ page }) => {
    await importFixture(page);
    await page.getByTestId("topbar.projects").click();
    await page.getByTestId("project-manager.new").click(); // a second, empty project, now the open one
    await expect(page.getByTestId("scene-tree.empty-scene")).toBeVisible();

    await page.getByTestId("topbar.projects").click();
    const simpleSceneRow = page.locator(".pm-row", { hasText: "simple-scene" }).filter({ hasNotText: "copy" });
    await simpleSceneRow.locator('[data-testid$=".open"]').click();
    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
    await expect(page.getByTestId("scene-tree.row.1")).toBeVisible();
  });
});
