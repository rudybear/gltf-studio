import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

/**
 * specs/ux-shell.md UX-125: crash recovery. Simulates "a crash before the
 * debounced full save consolidated" by editing and reloading well inside
 * UX-123's 1.5s debounce window (the immediate SP-004 journal append has
 * time to land in real IndexedDB; the debounced checkpoint save does not).
 */
async function importFixtureAndEditWithoutConsolidating(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");

  await page.getByTestId("scene-tree.row.1").click(); // "Widget"
  await page.getByTestId("inspector.transform.position-x").fill("7");
  await expect(page.getByTestId("topbar.save-status")).toHaveText("Unsaved changes");
  // Give the immediate journal write (SP-004) time to land, but reload well
  // before the 1.5s debounced full save (UX-123) would otherwise consolidate
  // it -- the exact condition UX-125's recovery prompt exists for.
  await page.waitForTimeout(400);
  await page.reload();
}

async function currentPositionX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const json = window.__gltfStudioDocumentTest?.getJson() as { nodes?: Array<{ translation?: number[] }> } | null;
    return json?.nodes?.[1]?.translation?.[0] ?? 0;
  });
}

/**
 * Task #36 (SP-004 journal gap, closed in packages/app/src/store/app-store.ts's
 * undo()/redo(): both now append their applied patches to the autosave
 * journal, same as dispatchCommand always has): edits, then UNDOES that
 * edit, reloading well inside the 1.5s debounce window so only the two
 * immediate journal writes (the edit's, then the undo's) have landed --
 * never the debounced full checkpoint. Before the fix, `loadJournal`
 * replay only ever saw the forward edit (undo was invisible to it), so
 * recovering from exactly this crash window silently UNDID THE UNDO --
 * this helper's own name says which state is actually correct afterward.
 */
async function importFixtureEditUndoWithoutConsolidating(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");

  await page.getByTestId("scene-tree.row.1").click(); // "Widget"
  await page.getByTestId("inspector.transform.position-x").fill("7");
  await expect(page.getByTestId("topbar.save-status")).toHaveText("Unsaved changes");
  // Let the edit's own immediate journal write (SP-004) land before undoing.
  await page.waitForTimeout(400);

  await page.getByTestId("topbar.undo").click();
  await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("0");
  // Let undo's own immediate journal write (this task's fix) land too, then
  // reload well before the 1.5s debounced full save (UX-123) would
  // otherwise consolidate this back to a clean, journal-free "Saved" state.
  await page.waitForTimeout(400);
  await page.reload();
}

test.describe("crash recovery (UX-125)", () => {
  test("opens at the last-saved state and offers to recover, naming the project", async ({ page }) => {
    await importFixtureAndEditWithoutConsolidating(page);

    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
    expect(await currentPositionX(page)).toBe(0);

    await expect(page.getByTestId("recovery.dialog")).toBeVisible();
    await expect(page.getByTestId("recovery.message")).toContainText("simple-scene");
  });

  test("Recover replays the journal and marks the project dirty again", async ({ page }) => {
    await importFixtureAndEditWithoutConsolidating(page);

    await page.getByTestId("recovery.recover").click();
    await expect(page.getByTestId("recovery.dialog")).toHaveCount(0);
    expect(await currentPositionX(page)).toBe(7);
    await expect(page.getByTestId("topbar.save-status")).toHaveText("Unsaved changes");
    // UX-123's debounce should still consolidate the recovered state normally.
    await expect(page.getByTestId("topbar.save-status")).toHaveText("Saved", { timeout: 8000 });
  });

  test("Discard keeps the last-saved state and does not re-offer recovery on a later reload (SP-016)", async ({ page }) => {
    await importFixtureAndEditWithoutConsolidating(page);

    await page.getByTestId("recovery.discard").click();
    await expect(page.getByTestId("recovery.dialog")).toHaveCount(0);
    expect(await currentPositionX(page)).toBe(0);

    await page.reload();
    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
    await expect(page.getByTestId("recovery.dialog")).toHaveCount(0);
    expect(await currentPositionX(page)).toBe(0);
  });

  test("recovering from a crash strictly between an undo and the next checkpoint restores the POST-undo state, not the pre-undo edit (UX-128, task #36)", async ({
    page
  }) => {
    await importFixtureEditUndoWithoutConsolidating(page);

    // Reopens at the last-SAVED state (position 0, same as every other
    // crash-recovery test above) -- the journal (edit to 7, then undo back
    // to 0) is what's ahead of it, offered for replay.
    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
    expect(await currentPositionX(page)).toBe(0);
    await expect(page.getByTestId("recovery.dialog")).toBeVisible();

    await page.getByTestId("recovery.recover").click();
    await expect(page.getByTestId("recovery.dialog")).toHaveCount(0);
    // The bug this guards: before task #36's fix, undo's own state change
    // was invisible to the journal, so replaying it landed back on 7 (the
    // edit alone) -- silently undoing the user's own undo. Must be 0.
    expect(await currentPositionX(page)).toBe(0);
    await expect(page.getByTestId("topbar.save-status")).toHaveText("Unsaved changes");
    await expect(page.getByTestId("topbar.save-status")).toHaveText("Saved", { timeout: 8000 });
  });
});
