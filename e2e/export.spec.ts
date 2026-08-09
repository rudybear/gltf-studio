import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { parseContainer } from "@gltfi/gltf";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

/**
 * M3: real export — editor-core's byte-preserving `save()` -> a browser
 * download (topbar.export). `storage.capabilities.fileHandles` is `false`
 * for the app's current `IndexedDBStorage`, so this always exercises the
 * `<a download>` blob-URL path (never a real native `showSaveFilePicker`
 * dialog, which would hang a headless run) — see lib/export.ts's header.
 */
async function importFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
}

test.describe("export", () => {
  test("untouched-document export is byte-identical to the imported .glb (UX-112, DOC-026/DOC-034-style invariant)", async ({ page }) => {
    await importFixture(page);
    const originalBytes = readFileSync(FIXTURE_GLB_PATH);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("topbar.export").click()]);
    expect(download.suggestedFilename()).toBe("simple-scene.glb");
    const downloadPath = await download.path();
    const exportedBytes = readFileSync(downloadPath!);

    expect(exportedBytes.equals(originalBytes)).toBe(true);
    await expect(page.getByTestId("toast")).toContainText("Export complete");
  });

  test("after an edit: export bytes differ from the import, and reparsing them deep-equals the in-memory document (DOC-024/DOC-034)", async ({
    page
  }) => {
    await importFixture(page);
    const originalBytes = readFileSync(FIXTURE_GLB_PATH);

    await page.getByTestId("scene-tree.row.1").click(); // "Widget"
    await page.getByTestId("inspector.transform.position-x").fill("7");
    const jsonAfterEdit = await page.evaluate(() => window.__gltfStudioDocumentTest?.getJson());

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("topbar.export").click()]);
    const downloadPath = await download.path();
    const exportedBytes = readFileSync(downloadPath!);

    expect(exportedBytes.equals(originalBytes)).toBe(false);

    const reparsed = parseContainer(new Uint8Array(exportedBytes));
    expect(reparsed.json).toEqual(jsonAfterEdit);

    await expect(page.getByTestId("toast")).toContainText("Export complete");
  });

  test("export is disabled with no document imported yet (UX-112)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("topbar.export")).toBeDisabled();
  });
});
