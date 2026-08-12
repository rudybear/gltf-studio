import { test, expect, type Page } from "@playwright/test";
import { buildInspectorFixtureBytes, INSPECTOR_FIXTURE_NAME } from "./inspector-fixture.js";

/**
 * specs/ux-inspector.md UX-4xx: identity strip, Transform/Mesh & Primitives/
 * Material/Audio Emitter sections, the `◈` pointer-shortcut menu, and the
 * empty/deferred states. Uses e2e/inspector-fixture.ts's own richer fixture
 * (not the shared global-setup.ts one — see that file's header) so material
 * links, a shared mesh, a light, a camera, and an audio emitter are all
 * exercisable without disturbing the node indices other specs pin.
 */
async function importInspectorFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', {
    name: INSPECTOR_FIXTURE_NAME,
    mimeType: "model/gltf-binary",
    buffer: buildInspectorFixtureBytes()
  });
  await expect(page.getByTestId("topbar.project-name")).toHaveText("inspector-fixture");
}

function documentJson(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__gltfStudioDocumentTest?.getJson());
}

/**
 * Playwright's `locator.fill()` refuses `range`/`color` inputs ("cannot be
 * filled" — it's a text-entry primitive, not a generic value setter). Sets
 * the value through the native property setter (so React's own tracked
 * "previous value" doesn't see a no-op and swallow the synthetic event) and
 * dispatches `input` — exactly what a real drag/native color-picker commit
 * does from this component's point of view.
 */
async function setRangeOrColorValue(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).evaluate((element, val) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, val);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test.describe("inspector (specs/ux-inspector.md UX-4xx)", () => {
  test.beforeEach(async ({ page }) => {
    await importInspectorFixture(page);
  });

  test("empty state: nothing selected shows exactly one message, no section content (UX-413)", async ({ page }) => {
    await expect(page.getByTestId("inspector.empty")).toHaveText("Nothing selected.");
    await expect(page.getByTestId("inspector.transform.section")).toHaveCount(0);
  });

  test("identity strip: Node #N + pointer path, chips only for facts the node actually carries, copy confirms via toast (UX-400/UX-401/UX-402)", async ({
    page
  }) => {
    // Node 0 "Widget": has a mesh, no children, no extensions.
    await page.getByTestId("scene-tree.row.0").click();
    await expect(page.getByTestId("inspector.identity")).toContainText("Node #0");
    await expect(page.getByTestId("inspector.identity")).toContainText("/nodes/0");
    await expect(page.getByTestId("inspector.identity.ref.mesh")).toBeVisible();
    await expect(page.getByTestId("inspector.identity.ref.children")).toHaveCount(0);
    await expect(page.getByTestId("inspector.identity.ref.extensions")).toHaveCount(0);

    await page.getByTestId("inspector.identity.copy").click();
    await expect(page.getByTestId("toast")).toContainText("/nodes/0");
  });

  test("mesh identity chip scrolls to and flashes the Mesh section; extensions chip does the same for the Audio Emitter section (UX-403)", async ({
    page
  }) => {
    await page.getByTestId("scene-tree.row.0").click(); // Widget: has a mesh chip
    await page.getByTestId("inspector.identity.ref.mesh").click();
    await expect(page.locator('[data-testid="inspector.mesh.section"]').locator("xpath=..")).toHaveClass(/flash-highlight/);

    await page.getByTestId("scene-tree.row.4").click(); // Speaker: has an extensions chip (KHR_audio_emitter)
    await expect(page.getByTestId("inspector.identity.ref.extensions")).toContainText("KHR_audio_emitter");
    await page.getByTestId("inspector.identity.ref.extensions").click();
    await expect(page.locator('[data-testid="inspector.audio.section"]').locator("xpath=..")).toHaveClass(/flash-highlight/);
  });

  test("Transform section edits write ONE coalesced undoable command per field, reflected in the document (UX-404)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.0").click();
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();

    await page.getByTestId("inspector.transform.position-x").fill("3");
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();

    const json = (await documentJson(page)) as { nodes: Array<{ translation?: number[] }> };
    expect(json.nodes[0].translation?.[0]).toBe(3);

    // Exactly one history entry for this single completed edit.
    await page.getByTestId("topbar.history-toggle").click();
    await expect(page.getByTestId("topbar.history-dropdown").locator("li")).toHaveCount(1);
    await page.getByTestId("topbar.history-toggle").click();

    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("0");
  });

  test("Rotation row round-trips Euler degrees through the document's quaternion truth", async ({ page }) => {
    await page.getByTestId("scene-tree.row.0").click();
    await page.getByTestId("inspector.transform.rotation-y").fill("90");

    const json = (await documentJson(page)) as { nodes: Array<{ rotation?: number[] }> };
    const rotation = json.nodes[0].rotation!;
    // 90deg about Y as a quaternion: [0, sin(45deg), 0, cos(45deg)].
    expect(rotation[1]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(rotation[3]).toBeCloseTo(Math.SQRT1_2, 4);
    // ...and decomposes back to ~90 for display.
    await expect(page.getByTestId("inspector.transform.rotation-y")).toHaveValue("90");
  });

  test("Mesh & Primitives section: header, per-primitive material link + mode + indices/tri count, attribute table, and the shared-mesh note (UX-407/408/410)", async ({
    page
  }) => {
    await page.getByTestId("scene-tree.row.0").click(); // Widget
    await expect(page.getByTestId("inspector.mesh.section")).toContainText("Mesh #0");
    await expect(page.getByTestId("inspector.mesh.section")).toContainText("2 primitives");

    await expect(page.getByTestId("inspector.mesh.primitive.0")).toContainText("material #0 Mat_Red");
    await expect(page.getByTestId("inspector.mesh.primitive.0")).toContainText("TRIANGLES");
    await expect(page.getByTestId("inspector.mesh.primitive.0")).toContainText("1 tris");
    await expect(page.getByTestId("inspector.mesh.primitive.1")).toContainText("material #1 Mat_Blue");
    await expect(page.getByTestId("inspector.mesh.primitive.1")).toContainText("none (non-indexed)");

    // Expand primitive 0 to see its attribute table.
    await page.getByTestId("inspector.mesh.primitive.0").locator("summary").click();
    // Scoped to primitive 0 specifically — both primitives share a POSITION
    // attribute, so an unscoped `getByTestId` would match two elements (a
    // native `<details>`'s collapsed children are still present in the DOM,
    // just visually hidden, regardless of which one was expanded above).
    const primitive0Attrs = page.getByTestId("inspector.mesh.primitive.0").getByTestId("inspector.mesh.attr.POSITION");
    await expect(primitive0Attrs).toContainText("accessor #0");
    await expect(primitive0Attrs).toContainText("VEC3 5126 3");

    await expect(page.getByTestId("inspector.mesh.shared-note")).toHaveText("also used by: Widget2");

    // Widget2 (node 1) shares the same mesh -> the note points back at Widget
    // (not "Widget2" itself — an exact-text check, since "Widget2" would
    // otherwise also satisfy a looser substring match on "Widget").
    await page.getByTestId("scene-tree.row.1").click();
    await expect(page.getByTestId("inspector.mesh.shared-note")).toHaveText("also used by: Widget");
  });

  test("clicking a primitive's material link switches the asset browser to Materials and flashes that row, WITHOUT switching the bottom dock (UX-409)", async ({
    page
  }) => {
    await page.getByTestId("scene-tree.row.0").click();
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/); // default tab, untouched so far

    await page.getByTestId("inspector.mesh.material-link.1").click();
    await expect(page.getByTestId("asset-browser.tab.materials")).toHaveClass(/active/);
    await expect(page.getByTestId("asset-browser.materials.1")).toHaveClass(/flash-highlight/);
    // UX-409: unlike a deliberate asset-browser-row click (UX-211), this does NOT force-switch to Data.
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId("dock.tab.data")).not.toHaveClass(/active/);
  });

  test("Material sections: one per distinct material referenced by the mesh's primitives, base color / metallic / roughness writes reflected in the document (UX-405)", async ({
    page
  }) => {
    await page.getByTestId("scene-tree.row.0").click(); // Widget: 2 primitives -> 2 materials -> 2 sections
    await expect(page.getByTestId("inspector.material.section.0")).toContainText("Material #0");
    await expect(page.getByTestId("inspector.material.section.1")).toContainText("Material #1");

    await setRangeOrColorValue(page, "inspector.material.metallic.0", "0.5");
    const json = (await documentJson(page)) as {
      materials: Array<{ pbrMetallicRoughness: { metallicFactor: number } }>;
    };
    expect(json.materials[0].pbrMetallicRoughness.metallicFactor).toBeCloseTo(0.5, 5);

    await setRangeOrColorValue(page, "inspector.material.base-color.1", "#00ff00");
    const json2 = (await documentJson(page)) as {
      materials: Array<{ pbrMetallicRoughness: { baseColorFactor: number[] } }>;
    };
    expect(json2.materials[1].pbrMetallicRoughness.baseColorFactor.slice(0, 3)).toEqual([0, 1, 0]);
  });

  test("Audio Emitter section: gain/distance-model reflect and write the document; audition is real and gesture-gates AudioHost.init() (UX-406, M7)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.4").click(); // Speaker
    await expect(page.getByTestId("inspector.audio.gain")).toHaveValue("0.8");
    await expect(page.getByTestId("inspector.audio.distance-model")).toHaveValue("inverse");
    // M7: real once the store's audioHost is registered (App.tsx, every
    // loaded document) — no longer the M2..M6-era disabled stub.
    await expect(page.getByTestId("inspector.audio.audition")).toBeEnabled();
    await page.getByTestId("inspector.audio.audition").click(); // first click = the AH-001 gesture
    // The emitter has no sources bound in this fixture — auditionEmitter is
    // a documented no-op for that case, so nothing more to assert than "the
    // click didn't throw/crash the page" (implicitly covered: every other
    // assertion in this test still passing after the click).
    await expect(page.getByTestId("inspector.audio.audition")).toBeEnabled();

    await page.getByTestId("inspector.audio.distance-model").selectOption("linear");
    const json = (await documentJson(page)) as {
      extensions: { KHR_audio_emitter: { emitters: Array<{ distanceModel: string }> } };
    };
    expect(json.extensions.KHR_audio_emitter.emitters[0].distanceModel).toBe("linear");
  });

  test("Light and camera nodes show Transform plus an explicit later-iteration note, never a silently missing section (UX-414)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.2").click(); // Lamp
    await expect(page.getByTestId("inspector.transform.section")).toBeVisible();
    await expect(page.getByTestId("inspector.light.note")).toContainText("later iteration");
    await expect(page.getByTestId("inspector.mesh.section")).toHaveCount(0);

    await page.getByTestId("scene-tree.row.3").click(); // Cam
    await expect(page.getByTestId("inspector.transform.section")).toBeVisible();
    await expect(page.getByTestId("inspector.camera.note")).toContainText("later iteration");
  });

  test("◈ pointer-shortcut menu: copy path, and Add pointer/set|interpolate create a real KHR_interactivity graph node as one undoable command (UX-411/UX-412, DOC-041/DOC-042)", async ({
    page
  }) => {
    await page.getByTestId("scene-tree.row.0").click();
    await page.getByTestId("inspector.pointer-btn.translation").click();
    await expect(page.getByTestId("inspector.pointer-menu")).toBeVisible();

    await page.getByTestId("inspector.pointer-menu.copy").click();
    await expect(page.getByTestId("toast")).toContainText("/nodes/0/translation");

    await expect(page.getByTestId("topbar.undo")).toBeDisabled(); // copy isn't a document mutation

    // Switch off the Behavior graph tab first, so the assertion below actually
    // proves the pointer-shortcut action switches it back (UX-412), rather
    // than it merely having stayed on its own default.
    await page.getByTestId("dock.tab.data").click();
    await expect(page.getByTestId("dock.tab.graph")).not.toHaveClass(/active/);

    await page.getByTestId("inspector.pointer-btn.translation").click();
    await page.getByTestId("inspector.pointer-menu.add-set").click();

    // UX-412: switches the bottom dock to the Behavior graph tab.
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();

    type Graph = { declarations: Array<{ op: string }>; nodes: Array<{ declaration: number; configuration?: { pointer?: { value: string[] } } }> };
    const jsonAfter = (await documentJson(page)) as { extensions: { KHR_interactivity: { graphs: Graph[] } } };
    const graph = jsonAfter.extensions.KHR_interactivity.graphs[0];
    expect(graph.declarations.some((d) => d.op === "pointer/set")).toBe(true);
    const created = graph.nodes.find((n) => graph.declarations[n.declaration]?.op === "pointer/set");
    expect(created?.configuration?.pointer?.value).toEqual(["/nodes/0/translation"]);

    // One undo step un-does the WHOLE scaffold+node-add.
    await page.getByTestId("topbar.undo").click();
    const jsonUndone = (await documentJson(page)) as { extensions?: { KHR_interactivity?: unknown } };
    expect(jsonUndone.extensions?.KHR_interactivity).toBeUndefined();
  });
});
