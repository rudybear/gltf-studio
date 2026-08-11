import { test, expect, type Page } from "@playwright/test";
import { validateGraph, type VGraph } from "@gltfi/verify";
import { FIXTURE_GLB_PATH } from "./global-setup.js";
import { assertRegionRendersContent } from "./visual-assert.js";

/**
 * specs/ux-scene-tree.md UX-214, specs/document-model.md DOC-048: node
 * deletion (M8 part 1). User-reported bug: "I can add mesh, but can't
 * delete it" — `SceneEdit.removeNode` was a throwing M8 stub.
 *
 * Fixture: `e2e/global-setup.ts`'s `simple-scene.glb` — nodes 0 "Root"
 * (children [1,2]), 1 "Widget" (mesh, child [3]), 2 "KeyLight" (a
 * `KHR_lights_punctual` light, no children), 3 "Widget_Detail" (mesh, far
 * offscreen). `scenes[0].nodes` is `[0]` only. DFS scene-tree row order:
 * row 0 = node 0 (Root), row 1 = node 1 (Widget), row 2 = node 3
 * (Widget_Detail, Widget's child), row 3 = node 2 (KeyLight). The fixture
 * also carries a real (inert) `KHR_interactivity` graph and an `Idle`
 * animation whose one channel targets node 1 (Widget)'s rotation.
 */
async function importFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await expect(page.getByTestId("scene-tree.row.3")).toBeVisible();
}

interface SceneJson {
  nodes: Array<{ name?: string; mesh?: number; children?: number[] }>;
  scenes: Array<{ nodes: number[] }>;
  animations?: Array<{ channels?: Array<{ target: { node: number } }> }>;
  extensions?: { KHR_interactivity?: { graphs: Array<{ nodes: unknown[] }> } };
}

function documentJson(page: Page): Promise<SceneJson> {
  return page.evaluate(() => window.__gltfStudioDocumentTest?.getJson()) as Promise<SceneJson>;
}

async function waitForReload(page: Page): Promise<void> {
  // Structural patches (adds AND removes, RH-011..014) route through a full
  // async RenderHost.loadScene re-parse — same poll every other structural
  // e2e spec (scene-tree-add-menu.spec.ts, racer.spec.ts) already uses.
  await expect.poll(() => page.evaluate(() => window.__gltfStudioTest?.isReady() === true)).toBe(true);
}

test.describe("scene tree node deletion (specs/ux-scene-tree.md UX-214, DOC-048)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("add a cube then delete it via the context menu: gone from tree + viewport, undo restores it (UX-206 + UX-214)", async ({ page }) => {
    const before = await documentJson(page);

    // Add (scene-tree-add-menu.spec.ts's own established behavior: lands as
    // scene-root node index 4, DFS row 4).
    await page.getByTestId("scene-tree.add").click();
    await page.getByTestId("scene-tree.add-menu.mesh").click();
    await page.getByTestId("scene-tree.add-menu.mesh.cube").click();
    await waitForReload(page);
    await page.getByTestId("scene-tree.row.4.rename-input").press("Escape");
    await expect(page.getByTestId("scene-tree.row.4")).toContainText("Cube");
    await assertRegionRendersContent(page.getByTestId("viewport.mount"));

    // Delete via the context menu.
    await page.getByTestId("scene-tree.row.4").click({ button: "right" });
    await expect(page.getByTestId("scene-tree.context-menu.delete")).toBeVisible();
    await expect(page.getByTestId("scene-tree.context-menu.delete")).toHaveText("Delete"); // childless -> no count suffix
    await page.getByTestId("scene-tree.context-menu.delete").click();
    await waitForReload(page);

    await expect(page.getByTestId("scene-tree.row.4")).toHaveCount(0);
    const afterDelete = await documentJson(page);
    expect(afterDelete.nodes).toHaveLength(before.nodes.length); // back to the pristine node count

    // Undo restores it.
    await page.getByTestId("topbar.undo").click();
    await waitForReload(page);
    await expect(page.getByTestId("scene-tree.row.4")).toBeVisible();
    await expect(page.getByTestId("scene-tree.row.4")).toContainText("Cube");
  });

  test("Delete/Backspace key deletes the currently-selected node (UX-214)", async ({ page }) => {
    // KeyLight (row 3, node 2): childless, referenced by nothing else.
    await page.getByTestId("scene-tree.row.3").click();
    await expect(page.getByTestId("scene-tree.row.3")).toHaveClass(/selected/);

    await page.keyboard.press("Delete");
    await waitForReload(page);
    await expect(page.getByTestId("scene-tree.row.3")).toHaveCount(0);

    await page.getByTestId("topbar.undo").click();
    await waitForReload(page);
    await expect(page.getByTestId("scene-tree.row.3")).toContainText("KeyLight");

    // Backspace works too.
    await page.getByTestId("scene-tree.row.3").click();
    await page.keyboard.press("Backspace");
    await waitForReload(page);
    await expect(page.getByTestId("scene-tree.row.3")).toHaveCount(0);
  });

  test("the Delete key is ignored while typing in the inline-rename text field (focus guard) — it edits the name, not the node graph", async ({
    page
  }) => {
    await page.getByTestId("scene-tree.row.3").click({ button: "right" }); // KeyLight
    await page.getByTestId("scene-tree.context-menu.rename").click();
    const renameInput = page.getByTestId("scene-tree.row.3.rename-input");
    await renameInput.fill("Lamp");
    // Select-all then Delete/Backspace inside the input must only edit the
    // input's own text — the app-level shortcut must not ALSO fire.
    await renameInput.press("Control+A");
    await renameInput.press("Delete");
    await expect(renameInput).toHaveValue("");
    await renameInput.fill("Lamp");
    await renameInput.press("Enter");

    await expect(page.getByTestId("scene-tree.row.3")).toContainText("Lamp");
    await expect(page.getByTestId("scene-tree.row.3")).toBeVisible(); // never deleted
  });

  test("deleting a node with children deletes the WHOLE subtree as one command, labels the context menu with the subtree count, fixes up the animation channel targeting it, and stays validateGraph-clean (DOC-048)", async ({
    page
  }) => {
    const before = await documentJson(page);
    expect(before.animations?.[0].channels?.[0].target.node).toBe(1); // Idle animation targets Widget (node 1) pre-delete

    await page.getByTestId("scene-tree.row.1").click({ button: "right" }); // Widget (has child Widget_Detail)
    await expect(page.getByTestId("scene-tree.context-menu.delete")).toHaveText("Delete (2 nodes)");
    await page.getByTestId("scene-tree.context-menu.delete").click();
    await waitForReload(page);

    // Both Widget and Widget_Detail are gone; only Root and KeyLight remain
    // (KeyLight is Root's OTHER child, node 2, unrelated to Widget's own
    // subtree — it survives, its index shifting down from 2 to 1).
    const after = await documentJson(page);
    expect(after.nodes).toHaveLength(2);
    expect(after.nodes.map((n) => n.name)).toEqual(["Root", "KeyLight"]);
    expect(after.nodes[0].children).toEqual([1]); // Root's children [1,2]: 1 (Widget) dropped, 2 (KeyLight) shifted to 1

    // The animation channel that targeted the deleted node (1) is DROPPED
    // (DOC-048's resolved policy), not left dangling or retargeted — the
    // Idle animation's `channels` array had exactly one entry, so once it's
    // dropped the whole `channels` PROPERTY is removed (an empty array
    // isn't how this codebase represents "none" — same convention as a
    // childless node's `children` property).
    expect(after.animations?.[0].channels).toBeUndefined();

    // The pre-existing KHR_interactivity graph (unrelated to either deleted
    // node) is untouched and still validateGraph-clean.
    const graph = after.extensions!.KHR_interactivity!.graphs[0];
    expect(graph.nodes).toHaveLength(2);
    expect(validateGraph(graph as unknown as VGraph).ok).toBe(true);

    // Undo restores everything: both nodes, the animation channel, selection lands somewhere viable.
    await page.getByTestId("topbar.undo").click();
    await waitForReload(page);
    const undone = await documentJson(page);
    expect(undone).toEqual(before);
  });

  test("selection moves to the deleted node's parent after delete (UX-214); deleting a scene-root node clears selection", async ({ page }) => {
    // Widget_Detail (row 2, node 3) is a child of Widget (node 1).
    await page.getByTestId("scene-tree.row.2").click({ button: "right" });
    await page.getByTestId("scene-tree.context-menu.delete").click();
    await waitForReload(page);
    // Widget (now the only remaining node that was its parent) is selected.
    await expect(page.getByTestId("scene-tree.row.1")).toHaveClass(/selected/);
    await expect(page.getByTestId("scene-tree.row.1")).toContainText("Widget");

    // Root (row 0, node 0) is a scene-root node — no parent. Its subtree at
    // this point is EVERYTHING left (Root + Widget + KeyLight, Widget_Detail
    // already gone from the step above) — deleting it empties the scene.
    await page.getByTestId("scene-tree.row.0").click({ button: "right" });
    await expect(page.getByTestId("scene-tree.context-menu.delete")).toHaveText("Delete (3 nodes)");
    await page.getByTestId("scene-tree.context-menu.delete").click();
    await waitForReload(page);
    await expect(page.getByTestId("inspector.empty")).toBeVisible(); // nothing selected
  });

  test("deleting is blocked while playing, same as every other edit (DOC-031's existing dispatch guard)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.3").click(); // KeyLight
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");

    await page.keyboard.press("Delete");
    // Nothing happened — still playing, KeyLight still present once stopped.
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");
    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
    await expect(page.getByTestId("scene-tree.row.3")).toContainText("KeyLight");
  });
});
