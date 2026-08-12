import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";
import { assertRegionRendersContent } from "./visual-assert.js";

/**
 * specs/ux-scene-tree.md UX-215/UX-216/UX-217, specs/document-model.md
 * DOC-052/053 (M8 part 2): drag-and-drop reparenting, "Reparent to root",
 * and "Duplicate" — the last structural gaps in scene authoring (add,
 * delete, reparent, duplicate are all real as of this change).
 *
 * Fixture: `e2e/global-setup.ts`'s `simple-scene.glb` — nodes 0 "Root"
 * (children [1,2]), 1 "Widget" (mesh, child [3]), 2 "KeyLight" (a
 * `KHR_lights_punctual` light, no children), 3 "Widget_Detail" (mesh, far
 * offscreen). `scenes[0].nodes` is `[0]` only. DFS scene-tree row order:
 * row 0 = node 0 (Root), row 1 = node 1 (Widget), row 2 = node 3
 * (Widget_Detail, Widget's child), row 3 = node 2 (KeyLight) — the exact same
 * fixture and row layout `e2e/scene-tree-delete.spec.ts` documents.
 */
async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await expect(page.getByTestId("scene-tree.row.3")).toBeVisible();
}

interface SceneJson {
  nodes: Array<{ name?: string; mesh?: number; children?: number[] }>;
  scenes: Array<{ nodes: number[] }>;
}

function documentJson(page: Page): Promise<SceneJson> {
  return page.evaluate(() => window.__gltfStudioDocumentTest?.getJson()) as Promise<SceneJson>;
}

async function waitForReload(page: Page): Promise<void> {
  // Structural patches (reparent AND duplicate) route through a full async
  // RenderHost.loadScene re-parse, same poll every other structural e2e spec
  // (scene-tree-add-menu.spec.ts, scene-tree-delete.spec.ts) already uses.
  await expect.poll(() => page.evaluate(() => window.__gltfStudioTest?.isReady() === true)).toBe(true);
}

test.describe("scene tree drag-and-drop reparenting (specs/ux-scene-tree.md UX-215, DOC-052)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("drag Widget_Detail onto KeyLight: it becomes KeyLight's child (removed from Widget's), tree hierarchy + viewport update, undo restores it", async ({ page }) => {
    const before = await documentJson(page);
    expect(before.nodes[1].children).toEqual([3]); // Widget_Detail starts as Widget's child.
    expect(before.nodes[2].children).toBeUndefined(); // KeyLight starts childless.

    // Widget_Detail = row 2 (node 3), KeyLight = row 3 (node 2).
    await page.getByTestId("scene-tree.row.2").dragTo(page.getByTestId("scene-tree.row.3"));
    await waitForReload(page);

    const after = await documentJson(page);
    expect(after.nodes[1].children).toBeUndefined(); // Widget lost its only child -> property removed, not [].
    expect(after.nodes[2].children).toEqual([3]); // KeyLight gained it.
    expect(after.nodes).toHaveLength(before.nodes.length); // reparenting never changes the node COUNT.
    expect(after.scenes).toEqual(before.scenes); // scene-root membership is untouched (neither end of this move was a scene root).

    // New DFS order: Root(0) -> Widget(1, now childless) -> KeyLight(2) -> Widget_Detail(3, KeyLight's new child).
    await expect(page.getByTestId("scene-tree.row.1")).toContainText("Widget");
    await expect(page.getByTestId("scene-tree.row.1")).not.toContainText("Widget_Detail");
    await expect(page.getByTestId("scene-tree.row.2")).toContainText("KeyLight");
    await expect(page.getByTestId("scene-tree.row.3")).toContainText("Widget_Detail");
    await assertRegionRendersContent(page.getByTestId("viewport.mount"));

    await page.getByTestId("topbar.undo").click();
    await waitForReload(page);
    const undone = await documentJson(page);
    expect(undone).toEqual(before);
    await expect(page.getByTestId("scene-tree.row.2")).toContainText("Widget_Detail");
    await expect(page.getByTestId("scene-tree.row.3")).toContainText("KeyLight");
  });

  test("dropping a row onto its own descendant is rejected with a toast; the tree is completely unchanged", async ({ page }) => {
    const before = await documentJson(page);

    // Root (row 0, node 0) onto Widget_Detail (row 2, node 3) — node 3 is a
    // descendant of node 0 (0 -> 1 -> 3) -> a genuine cycle attempt.
    await page.getByTestId("scene-tree.row.0").dragTo(page.getByTestId("scene-tree.row.2"));
    await expect(page.getByTestId("toast")).toContainText("Can't move a node into itself or one of its own children.");

    const after = await documentJson(page);
    expect(after).toEqual(before); // completely unchanged -- no partial application.
    await expect(page.getByTestId("scene-tree.row.0")).toContainText("Root");
    await expect(page.getByTestId("scene-tree.row.2")).toContainText("Widget_Detail");
  });

  test("dropping a row onto itself is a silent no-op (not a cycle-error toast, not a document change)", async ({ page }) => {
    const before = await documentJson(page);
    await page.getByTestId("scene-tree.row.1").dragTo(page.getByTestId("scene-tree.row.1"));
    await expect(page.getByTestId("toast")).toHaveCount(0);
    const after = await documentJson(page);
    expect(after).toEqual(before);
  });

  test("dropping onto the tree's own empty background reparents to the scene root", async ({ page }) => {
    const before = await documentJson(page);

    // Widget_Detail (row 2, node 3) dropped onto the panel's empty background
    // (below every row) -- "Reparent to root".
    const list = page.getByTestId("scene-tree.list");
    const box = (await list.boundingBox())!;
    await page.getByTestId("scene-tree.row.2").dragTo(list, { targetPosition: { x: box.width / 2, y: box.height - 4 } });
    await waitForReload(page);

    const after = await documentJson(page);
    expect(after.nodes[1].children).toBeUndefined(); // Widget lost its only child.
    expect(after.scenes[0].nodes).toEqual([0, 3]); // Widget_Detail appended as a NEW scene root.
    expect(before.scenes[0].nodes).toEqual([0]); // sanity: it wasn't a root before.
  });
});

test.describe("scene tree context-menu Duplicate / Reparent to root (specs/ux-scene-tree.md UX-216/UX-217, DOC-053/DOC-052)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("context menu: Reparent to root moves a nested node out from under its parent, as one undoable command", async ({ page }) => {
    const before = await documentJson(page);
    // Widget_Detail (row 2, node 3) is Widget's (node 1) only child.
    await page.getByTestId("scene-tree.row.2").click({ button: "right" });
    await expect(page.getByTestId("scene-tree.context-menu.reparent-root")).toHaveText("Reparent to root");
    await page.getByTestId("scene-tree.context-menu.reparent-root").click();
    await waitForReload(page);

    const after = await documentJson(page);
    expect(after.nodes[1].children).toBeUndefined();
    expect(after.scenes[0].nodes).toEqual([0, 3]);

    await page.getByTestId("topbar.undo").click();
    await waitForReload(page);
    expect(await documentJson(page)).toEqual(before);
  });

  test("context menu: Duplicate copies a node+subtree, sharing the mesh reference; editing the copy's transform never moves the original; undo removes only the duplicate", async ({ page }) => {
    // Add a cube (lands as scene-root node 4, DFS row 4 -- the same
    // established behavior scene-tree-add-menu.spec.ts/scene-tree-delete.spec.ts use).
    await page.getByTestId("scene-tree.add").click();
    await page.getByTestId("scene-tree.add-menu.mesh").click();
    await page.getByTestId("scene-tree.add-menu.mesh.cube").click();
    await waitForReload(page);
    await page.getByTestId("scene-tree.row.4.rename-input").press("Escape");
    await expect(page.getByTestId("scene-tree.row.4")).toContainText("Cube");
    const beforeDuplicate = await documentJson(page);

    await page.getByTestId("scene-tree.row.4").click({ button: "right" });
    await page.getByTestId("scene-tree.context-menu.duplicate").click();
    await waitForReload(page);

    // New copy lands as row 5 (sibling right after the original), auto-selected.
    await expect(page.getByTestId("scene-tree.row.5")).toContainText("Cube copy");
    await expect(page.getByTestId("scene-tree.row.5")).toHaveClass(/selected/);

    const afterDuplicate = await documentJson(page);
    expect(afterDuplicate.nodes).toHaveLength(beforeDuplicate.nodes.length + 1);
    expect(afterDuplicate.scenes[0].nodes).toEqual([0, 4, 5]); // sibling right after the original.
    expect(afterDuplicate.nodes[5].mesh).toBe(afterDuplicate.nodes[4].mesh); // shared mesh reference -- no geometry copy.

    // Edit the ORIGINAL's transform -- the duplicate must not move.
    await page.getByTestId("scene-tree.row.4").click();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("0");
    await page.getByTestId("inspector.transform.position-x").fill("3");
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("3");

    await page.getByTestId("scene-tree.row.5").click();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("0"); // the duplicate's own node/transform is independent.

    // Undo the transform edit, then undo the duplicate itself -- back to the pristine one-cube state.
    await page.getByTestId("topbar.undo").click();
    await waitForReload(page);
    await page.getByTestId("scene-tree.row.4").click();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("0");

    await page.getByTestId("topbar.undo").click();
    await waitForReload(page);
    await expect(page.getByTestId("scene-tree.row.5")).toHaveCount(0);
    expect(await documentJson(page)).toEqual(beforeDuplicate);
  });

  test("Ctrl/Cmd+D duplicates the focused row's node when the scene tree (not some other panel) has focus", async ({ page }) => {
    // KeyLight (row 3, node 2): childless, simplest case.
    await page.getByTestId("scene-tree.row.3").click();
    await expect(page.getByTestId("scene-tree.row.3")).toHaveClass(/selected/);
    await page.keyboard.press("Control+d");
    await waitForReload(page);

    // KeyLight (node 2) is Root's (node 0) SECOND child -- its duplicate
    // (new node 4) lands right after it in Root's OWN children array, not
    // the scene root (Root itself is the only scene-root node here). DFS
    // row 4 (after Root -> Widget -> Widget_Detail -> KeyLight).
    await expect(page.getByTestId("scene-tree.row.4")).toContainText("KeyLight copy");
    await expect(page.getByTestId("scene-tree.row.4")).toHaveClass(/selected/);

    const after = await documentJson(page);
    expect(after.nodes[0].children).toEqual([1, 2, 4]); // spliced in as a sibling right after KeyLight (2), within Root's children.
    expect(after.scenes[0].nodes).toEqual([0]); // scene-root membership itself is untouched.

    await page.getByTestId("topbar.undo").click();
    await waitForReload(page);
    await expect(page.getByTestId("scene-tree.row.4")).toHaveCount(0);
  });

  test("both duplicate and reparent are blocked while playing, same as every other edit (DOC-031's existing dispatch guard)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.3").click(); // KeyLight
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");

    await page.keyboard.press("Control+d");
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");

    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
    await expect(page.getByTestId("scene-tree.row.4")).toHaveCount(0); // nothing was duplicated while playing
  });
});
