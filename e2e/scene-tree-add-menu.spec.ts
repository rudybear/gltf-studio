import { test, expect, type Page } from "@playwright/test";
import { validateGraph, type VGraph } from "@gltfi/verify";
import { FIXTURE_GLB_PATH } from "./global-setup.js";
import { assertRegionRendersContent } from "./visual-assert.js";

/**
 * specs/ux-scene-tree.md UX-205/UX-206/UX-213: the scene tree's "+ Add"
 * menu. User-reported bug: "the + Add button does nothing." Investigation
 * (see specs/ux-scene-tree.md's M8-lite implementation note) found the menu
 * itself opens fine — every entry's `onClick` just called `pushToast(...)`,
 * a stub per the (now superseded) original `UX-206` wording. This spec
 * covers the fix: each of the five entries now dispatches a real
 * `SceneEdit.add*Node` command (`specs/document-model.md` `DOC-047`).
 *
 * Fixture: `e2e/global-setup.ts`'s `simple-scene.glb` — nodes 0 "Root"
 * (children [1,2]), 1 "Widget" (mesh, child [3]), 2 "KeyLight" (a
 * `KHR_lights_punctual` light, no children), 3 "Widget_Detail" (mesh, far
 * offscreen). `scenes[0].nodes` is `[0]` only (Root is the sole scene-root
 * node) — DFS scene-tree row order is: row 0 = node 0 (Root), row 1 = node
 * 1 (Widget), row 2 = node 3 (Widget_Detail, Widget's child), row 3 = node
 * 2 (KeyLight). A fresh add-menu creation with NO selection appends to
 * `scenes[0].nodes` (a new scene-root sibling of Root), which DFS visits
 * last -> row 4, node index 4.
 */
async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await expect(page.getByTestId("scene-tree.row.3")).toBeVisible();
}

/** Loosely-typed shape of `window.__gltfStudioDocumentTest.getJson()`'s result — only the fields this spec's assertions actually touch. */
interface SceneJson {
  nodes: Array<{
    name?: string;
    mesh?: number;
    camera?: number;
    children?: number[];
    extensions?: {
      KHR_lights_punctual?: { light: number };
      KHR_audio_emitter?: { emitter: number };
    };
  }>;
  scenes: Array<{ nodes: number[] }>;
  cameras?: Array<{ type: string }>;
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; material: number }> }>;
  buffers?: Array<{ byteLength: number; uri: string }>;
  bufferViews?: unknown[];
  extensionsUsed?: string[];
  extensions?: {
    KHR_lights_punctual?: { lights: Array<{ type: string }> };
    KHR_audio_emitter?: {
      audio: Array<{ bufferView: number; mimeType: string }>;
      sources: Array<{ audio: number }>;
      emitters: Array<{ type: string; sources: number[] }>;
    };
    KHR_interactivity?: { graphs: Array<{ nodes: unknown[] }> };
  };
}

function documentJson(page: Page): Promise<SceneJson> {
  return page.evaluate(() => window.__gltfStudioDocumentTest?.getJson()) as Promise<SceneJson>;
}

async function waitForReload(page: Page): Promise<void> {
  // Every add-menu entry is a structural patch (RH-011..RH-014,
  // specs/render-host.md) -> RenderHost.patchScene returns "needs-reload" ->
  // an async RenderHost.loadScene re-parse. isReady() flips back to true
  // once that settles (same poll racer.spec.ts/golden-path.spec.ts use).
  await expect.poll(() => page.evaluate(() => window.__gltfStudioTest?.isReady() === true)).toBe(true);
}

test.describe("scene tree + Add menu (specs/ux-scene-tree.md UX-205/UX-206/UX-213)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("the menu opens (pre-fix behavior: it always did) and Mesh expands its own Cube/Sphere/Plane submenu (UX-205)", async ({ page }) => {
    await expect(page.getByTestId("scene-tree.add-menu.light")).not.toBeVisible();
    await page.getByTestId("scene-tree.add").click();
    await expect(page.getByTestId("scene-tree.add-menu.light")).toBeVisible();
    await expect(page.getByTestId("scene-tree.add-menu.mesh")).toBeVisible();
    await expect(page.getByTestId("scene-tree.add-menu.camera")).toBeVisible();
    await expect(page.getByTestId("scene-tree.add-menu.audio-emitter")).toBeVisible();
    await expect(page.getByTestId("scene-tree.add-menu.group")).toBeVisible();

    await expect(page.getByTestId("scene-tree.add-menu.mesh.cube")).not.toBeVisible();
    await page.getByTestId("scene-tree.add-menu.mesh").click();
    await expect(page.getByTestId("scene-tree.add-menu.mesh.cube")).toBeVisible();
    await expect(page.getByTestId("scene-tree.add-menu.mesh.sphere")).toBeVisible();
    await expect(page.getByTestId("scene-tree.add-menu.mesh.plane")).toBeVisible();
  });

  test("Empty Group: adds a plain node at scene root, auto-selected with its name immediately editable, undo removes it cleanly (UX-206/UX-213)", async ({
    page
  }) => {
    const before = await documentJson(page);
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();

    await page.getByTestId("scene-tree.add").click();
    await page.getByTestId("scene-tree.add-menu.group").click();

    // Auto-selected + inline rename open, reusing UX-207's rename affordance.
    await expect(page.getByTestId("scene-tree.row.4.rename-input")).toBeVisible();
    await expect(page.getByTestId("scene-tree.row.4.rename-input")).toHaveValue("Empty Group");
    await expect(page.getByTestId("scene-tree.row.4")).toHaveClass(/selected/);
    // The add-menu closed itself after creating.
    await expect(page.getByTestId("scene-tree.add-menu.group")).not.toBeVisible();

    await page.getByTestId("scene-tree.row.4.rename-input").fill("My Group");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("scene-tree.row.4")).toContainText("My Group");

    const after = await documentJson(page);
    expect(after.nodes).toHaveLength(before.nodes.length + 1);
    expect(after.nodes[4]).toMatchObject({ name: "My Group" });
    expect(after.nodes[4].mesh).toBeUndefined();
    expect(after.nodes[4].camera).toBeUndefined();
    expect(after.nodes[4].extensions).toBeUndefined();
    expect(after.scenes[0].nodes).toEqual([0, 4]); // appended as a new scene-root sibling of Root

    // Rename was a SECOND undo step (create, then rename) — undo twice restores the pristine document exactly.
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    const undone = await documentJson(page);
    expect(undone).toEqual(before);
    await expect(page.getByTestId("scene-tree.row.4")).toHaveCount(0);
  });

  test("Light: adds a real KHR_lights_punctual point light node (UX-206)", async ({ page }) => {
    await page.getByTestId("scene-tree.add").click();
    await page.getByTestId("scene-tree.add-menu.light").click();
    await waitForReload(page);
    await expect(page.getByTestId("scene-tree.row.4.rename-input")).toHaveValue("Point Light");
    await page.getByTestId("scene-tree.row.4.rename-input").press("Escape");

    const json = await documentJson(page);
    const node = json.nodes[4];
    expect(node.name).toBe("Point Light");
    const lightIndex = node.extensions!.KHR_lights_punctual!.light;
    expect(json.extensions!.KHR_lights_punctual!.lights[lightIndex].type).toBe("point");
    expect(json.extensionsUsed).toContain("KHR_lights_punctual");
    // The fixture already carries one light (KeyLight) — this is a genuinely new second entry, not a dedupe artifact.
    expect(json.extensions!.KHR_lights_punctual!.lights.length).toBeGreaterThanOrEqual(2);
  });

  test("Camera: adds a real perspective camera node, scaffolding json.cameras from scratch (UX-206)", async ({ page }) => {
    const before = await documentJson(page);
    expect(before.cameras).toBeUndefined();

    await page.getByTestId("scene-tree.add").click();
    await page.getByTestId("scene-tree.add-menu.camera").click();
    await waitForReload(page);
    await page.getByTestId("scene-tree.row.4.rename-input").press("Escape");

    const json = await documentJson(page);
    const node = json.nodes[4];
    expect(node.name).toBe("Camera");
    expect(json.cameras![node.camera!].type).toBe("perspective");
  });

  test("Audio Emitter: builds a full, immediately-auditionable KHR_audio_emitter chain with a generated silent clip (UX-206)", async ({ page }) => {
    await page.getByTestId("scene-tree.add").click();
    await page.getByTestId("scene-tree.add-menu.audio-emitter").click();
    await waitForReload(page);
    await page.getByTestId("scene-tree.row.4.rename-input").press("Escape");

    const json = await documentJson(page);
    const node = json.nodes[4];
    expect(node.name).toBe("Audio Emitter");
    const emitterIndex = node.extensions!.KHR_audio_emitter!.emitter;
    const emitter = json.extensions!.KHR_audio_emitter!.emitters[emitterIndex];
    expect(emitter.type).toBe("positional");
    const sourceIndex = emitter.sources[0];
    const source = json.extensions!.KHR_audio_emitter!.sources[sourceIndex];
    const audio = json.extensions!.KHR_audio_emitter!.audio[source.audio];
    expect(audio.mimeType).toBe("audio/wav");
    expect(json.bufferViews![audio.bufferView]).toBeDefined();
    // Inspector's Audio section (specs/ux-inspector.md UX-406) can audition it: a source exists, not an empty emitter.
    await expect(page.getByTestId("inspector.audio.section")).toBeVisible();
  });

  for (const kind of ["cube", "sphere", "plane"] as const) {
    test(`Mesh > ${kind}: adds a generated primitive mesh node and the viewport renders it after the structural reload (UX-206)`, async ({ page }) => {
      const before = await documentJson(page);

      await page.getByTestId("scene-tree.add").click();
      await page.getByTestId("scene-tree.add-menu.mesh").click();
      await page.getByTestId(`scene-tree.add-menu.mesh.${kind}`).click();
      await waitForReload(page);
      await page.getByTestId("scene-tree.row.4.rename-input").press("Escape");

      const json = await documentJson(page);
      const node = json.nodes[4];
      expect(node.mesh).toBeDefined();
      const primitive = json.meshes[node.mesh!].primitives[0];
      expect(typeof primitive.attributes.POSITION).toBe("number");
      expect(typeof primitive.attributes.NORMAL).toBe("number");
      expect(typeof primitive.material).toBe("number");
      expect(json.buffers.length).toBe((before.buffers?.length ?? 0) + 1);

      // The viewport re-frames on every loadScene (RH-007/RH-008) and still shows real content, not a blank canvas.
      await assertRegionRendersContent(page.getByTestId("viewport.mount"));
    });
  }

  test("creating under the selected node parents it as that node's LAST child instead of the scene root (UX-213)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.3").click(); // KeyLight (node index 2), currently childless
    let json = await documentJson(page);
    expect(json.nodes[2].name).toBe("KeyLight");
    expect(json.nodes[2].children).toBeUndefined();

    await page.getByTestId("scene-tree.add").click();
    await page.getByTestId("scene-tree.add-menu.group").click();

    json = await documentJson(page);
    expect(json.nodes[2].children).toEqual([4]);
    // NOT also added as a second scene-root entry.
    expect(json.scenes[0].nodes).toEqual([0]);
  });

  test("regression: the fixture's pre-existing KHR_interactivity graph is untouched and still validateGraph-clean after add-menu edits", async ({
    page
  }) => {
    await page.getByTestId("scene-tree.add").click();
    await page.getByTestId("scene-tree.add-menu.light").click();
    await waitForReload(page);
    await page.getByTestId("scene-tree.row.4.rename-input").press("Escape");

    const json = await documentJson(page);
    const graph = json.extensions!.KHR_interactivity!.graphs[0];
    expect(graph.nodes).toHaveLength(2); // unchanged from the fixture (event/onStart, math/add)
    expect(validateGraph(graph as unknown as VGraph).ok).toBe(true);
  });
});
