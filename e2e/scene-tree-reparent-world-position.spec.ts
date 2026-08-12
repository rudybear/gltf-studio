import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

/**
 * specs/document-model.md DOC-052 (M8 part 2): `SceneEdit.reparentNode`'s
 * WORLD-transform-preservation default — a NUMERIC check, distinct from
 * `e2e/scene-tree-reparent-duplicate.spec.ts`'s own structural (children/
 * scenes[].nodes membership) coverage of the same feature. This file
 * exercises the actual Inspector Position fields (`specs/ux-inspector.md`
 * UX-404, `inspector.transform.position-{x,y,z}`) so a regression that
 * silently reverted to "keep local, not world" (this feature's OWN earlier,
 * superseded draft policy — see `scene-edit.ts`'s `reparentNode` doc
 * comment) would show up as a real, wrong on-screen number, not just a
 * structural membership-array assertion.
 *
 * Fixture: `e2e/global-setup.ts`'s `simple-scene.glb` — node 2 "KeyLight"
 * and node 3 "Widget_Detail" both start with an identity (or, for
 * Widget_Detail, translation-only) local transform, which on its own would
 * make "world position preserved" and "local position preserved" trivially
 * indistinguishable (an identity parent contributes nothing either way).
 * This spec first gives KeyLight (the reparent TARGET) a non-identity
 * position via a real Inspector edit, specifically so the two policies
 * predict DIFFERENT numbers and the assertion below is a genuine check.
 */
async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await expect(page.getByTestId("scene-tree.row.3")).toBeVisible();
}

interface SceneJson {
  nodes: Array<{ name?: string; translation?: number[]; children?: number[] }>;
}

function documentJson(page: Page): Promise<SceneJson> {
  return page.evaluate(() => window.__gltfStudioDocumentTest?.getJson()) as Promise<SceneJson>;
}

async function waitForReload(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__gltfStudioTest?.isReady() === true)).toBe(true);
}

test.describe("reparenting preserves WORLD position numerically (specs/document-model.md DOC-052)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("dragging Widget_Detail onto a KeyLight that has been moved away from the origin keeps Widget_Detail's WORLD position unchanged, by rewriting its LOCAL translation", async ({
    page
  }) => {
    // Widget_Detail (row 2, node 3) starts at local translation [10,10,10]
    // under Widget (node 1, identity transform) -- world position [10,10,10].
    const before = await documentJson(page);
    expect(before.nodes[3].translation).toEqual([10, 10, 10]);
    expect(before.nodes[2].translation ?? [0, 0, 0]).toEqual([0, 0, 0]); // KeyLight starts at the origin.

    // Give KeyLight (row 3, node 2) a real, non-identity position via the
    // Inspector -- so "keep local" and "keep world" (this feature's actual,
    // resolved default) predict two DIFFERENT numbers for what comes next,
    // making this a genuine regression check rather than a no-op either way.
    await page.getByTestId("scene-tree.row.3").click();
    await expect(page.getByTestId("scene-tree.row.3")).toHaveClass(/selected/);
    await page.getByTestId("inspector.transform.position-x").fill("5");
    await page.getByTestId("inspector.transform.position-y").fill("-2");
    await page.getByTestId("inspector.transform.position-z").fill("1");
    await expect.poll(async () => (await documentJson(page)).nodes[2].translation).toEqual([5, -2, 1]);

    // Drag Widget_Detail (still row 2) onto KeyLight (still row 3 -- moving
    // KeyLight's OWN position doesn't reorder the tree).
    await page.getByTestId("scene-tree.row.2").dragTo(page.getByTestId("scene-tree.row.3"));
    await waitForReload(page);

    const after = await documentJson(page);
    expect(after.nodes[2].children).toEqual([3]); // Widget_Detail is now KeyLight's child.

    // Both KeyLight and Widget_Detail carry translation-only transforms (no
    // rotation/scale anywhere in this chain), so world position is a plain
    // vector sum: KeyLight's own translation + Widget_Detail's NEW local
    // translation. This must equal Widget_Detail's ORIGINAL world position,
    // [10,10,10] -- unchanged by the reparent, per DOC-052's default policy.
    const keyLightTranslation = after.nodes[2].translation ?? [0, 0, 0];
    const widgetDetailLocal = after.nodes[3].translation ?? [0, 0, 0];
    const worldPosition = keyLightTranslation.map((v, i) => v + widgetDetailLocal[i]);
    expect(worldPosition[0]).toBeCloseTo(10, 5);
    expect(worldPosition[1]).toBeCloseTo(10, 5);
    expect(worldPosition[2]).toBeCloseTo(10, 5);

    // And the LOCAL translation itself genuinely changed (proving this
    // isn't accidentally passing because nothing moved): [10,10,10] minus
    // KeyLight's [5,-2,1] is [5,12,9].
    expect(widgetDetailLocal[0]).toBeCloseTo(5, 5);
    expect(widgetDetailLocal[1]).toBeCloseTo(12, 5);
    expect(widgetDetailLocal[2]).toBeCloseTo(9, 5);

    // The same numbers are visible in the Inspector's own Position fields
    // (UX-404) for the node that just moved, confirming this isn't only
    // true in the raw JSON the test reads directly.
    await expect(page.getByTestId("scene-tree.row.3")).toContainText("Widget_Detail"); // DFS row shifted (KeyLight's own row is now 2, its new child's is 3)
    await page.getByTestId("scene-tree.row.3").click();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("5");
    await expect(page.getByTestId("inspector.transform.position-y")).toHaveValue("12");
    await expect(page.getByTestId("inspector.transform.position-z")).toHaveValue("9");

    // Undo the reparent (back to identity-KeyLight-child Widget_Detail is
    // NOT restored by this undo alone -- only the reparent command itself
    // is undone; KeyLight's own position edit was a separate command).
    await page.getByTestId("topbar.undo").click();
    await waitForReload(page);
    const undone = await documentJson(page);
    expect(undone.nodes[3].translation).toEqual([10, 10, 10]); // back to its original local (and world) position.
    expect(undone.nodes[1].children).toEqual([3]); // back under Widget.
  });
});
