import { PNG } from "pngjs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { buildInspectorFixtureBytes, INSPECTOR_FIXTURE_NAME } from "./inspector-fixture.js";

// Richer inspector (UX-415/UX-416): the fixture's "Widget" triangle
// (positions [-1,-1,0, 1,-1,0, 0,1,0]) is CCW as viewed from +Z — the SAME
// front-facing winding `packages/engine-three/test/fixture.ts`'s own
// contract-test triangle uses (see that file's header comment) — so the
// SAME `[0,0,3]`/identity-rotation front pose every other e2e spec already
// uses (`e2e/global-setup.ts`'s `FIXTURE_FRONT_CAMERA_POSE`) frames it
// straight-on, and its 180°-about-Y mirror frames the triangle's BACK,
// exactly the pose a doubleSided:false -> true toggle needs a real,
// observable pixel difference at (nothing rendered, backface-culled ->
// the material's own color).
const FRONT_CAMERA_POSE = { position: [0, 0, 3] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], target: [0, 0, 0] as [number, number, number] };
const BACK_CAMERA_POSE = { position: [0, 0, -3] as [number, number, number], rotation: [0, 1, 0, 0] as [number, number, number, number], target: [0, 0, 0] as [number, number, number] };

async function setCameraPose(page: Page, pose: typeof FRONT_CAMERA_POSE): Promise<void> {
  await page.evaluate((p) => window.__gltfStudioTest!.setCameraPose(p), pose);
}

/**
 * Average RGB of a small box at the CENTER of `mount`'s current screenshot —
 * cheap, real-pixel confirmation that an edited property actually reached
 * the renderer (specs/ux-inspector.md's "confirm renders" acceptance bar),
 * without needing a full scene-diff helper. Waits for two consecutive
 * `requestAnimationFrame` callbacks first — `ThreeRenderHost`'s own render
 * loop (`render-host.ts`'s `tick`) re-renders on the NEXT frame after a
 * `patchScene`/camera-pose write, not synchronously within the React
 * event handler that triggered it; screenshotting immediately raced that
 * frame in practice (caught by this feature's own e2e run: a same-tick
 * screenshot occasionally still showed the PRE-edit pixel).
 */
async function centerPixelRgb(mount: Locator): Promise<{ r: number; g: number; b: number }> {
  await mount.page().evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
  const buffer = await mount.screenshot();
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const box = 6;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = cy - box; y <= cy + box; y++) {
    for (let x = cx - box; x <= cx + box; x++) {
      const i = (width * y + x) << 2;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
  }
  return { r: r / count, g: g / count, b: b / count };
}

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
      extensions: { KHR_audio_emitter: { emitters: Array<{ positional?: { distanceModel: string } }> } };
    };
    // UX-419 bugfix: this now writes/reads `positional.distanceModel`, not a
    // top-level `emitters[i].distanceModel` — the latter is what
    // `WebAudioHost.buildEmitterChain` actually never read, a real
    // write-only-field bug this pass fixed (see AudioSection.tsx's own doc
    // comment).
    expect(json.extensions.KHR_audio_emitter.emitters[0].positional?.distanceModel).toBe("linear");
  });

  test("Light and camera nodes show Transform plus their own real Light/Camera sections, never a silently missing section (UX-414/UX-417/UX-418)", async ({
    page
  }) => {
    await page.getByTestId("scene-tree.row.2").click(); // Lamp
    await expect(page.getByTestId("inspector.transform.section")).toBeVisible();
    await expect(page.getByTestId("inspector.light.section")).toBeVisible();
    // Full punctual-light control (UX-417 r2): type is a real editable
    // dropdown now, not read-only text — see e2e/lights.spec.ts for the
    // dedicated type-conversion coverage.
    await expect(page.getByTestId("inspector.light.type")).toHaveValue("point");
    await expect(page.getByTestId("inspector.mesh.section")).toHaveCount(0);

    await page.getByTestId("scene-tree.row.3").click(); // Cam
    await expect(page.getByTestId("inspector.transform.section")).toBeVisible();
    await expect(page.getByTestId("inspector.camera.section")).toBeVisible();
    await expect(page.getByTestId("inspector.camera.note")).toContainText("later iteration"); // no live viewport preview yet
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

  // ---------------------------------------------------------------------
  // Richer inspector (UX-415/UX-416/UX-417/UX-418): PBR extras, texture
  // slots, lights, cameras. Each edit is checked against BOTH the document
  // (round-trip, undoable) AND — the acceptance bar this whole feature is
  // held to — real rendered pixels or a real successful RenderHost reload,
  // never a write-only field.
  // ---------------------------------------------------------------------

  test("Texture Slots: a real decoded thumbnail for the fixture's baseColorTexture, 'not set' for the rest, Clear removes it and is undoable (UX-416)", async ({
    page
  }) => {
    await page.getByTestId("scene-tree.row.0").click(); // Widget: 2 materials -> suffixed testids
    const thumb = page.getByTestId("inspector.material.texture.baseColorTexture.thumb.0");
    await expect(thumb).toBeVisible();
    const src = await thumb.getAttribute("src");
    expect(src).toMatch(/^data:image\//); // a REAL decode (loadImageBitmaps -> canvas -> toDataURL), not a placeholder.
    await expect(page.getByTestId("inspector.material.texture.normalTexture.unset.0")).toHaveText("not set");
    await expect(page.getByTestId("inspector.material.texture.emissiveTexture.unset.0")).toHaveText("not set");

    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await page.getByTestId("inspector.material.texture.baseColorTexture.clear.0").click();
    await expect(page.getByTestId("inspector.material.texture.baseColorTexture.thumb.0")).toHaveCount(0);
    await expect(page.getByTestId("inspector.material.texture.baseColorTexture.unset.0")).toHaveText("not set");

    const json = (await documentJson(page)) as { materials: Array<{ pbrMetallicRoughness: { baseColorTexture?: unknown } }> };
    expect(json.materials[0].pbrMetallicRoughness.baseColorTexture).toBeUndefined();

    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("inspector.material.texture.baseColorTexture.thumb.0")).toBeVisible();
    const jsonUndone = (await documentJson(page)) as { materials: Array<{ pbrMetallicRoughness: { baseColorTexture?: { index: number } } }> };
    expect(jsonUndone.materials[0].pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
  });

  test("Texture Slots: KHR_texture_transform offset/scale edits write through and scaffold extensionsUsed (UX-416)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.0").click();
    await expect(page.getByTestId("inspector.material.texture.baseColorTexture.offset-x.0")).toBeVisible();

    await page.getByTestId("inspector.material.texture.baseColorTexture.offset-x.0").fill("0.25");
    await page.getByTestId("inspector.material.texture.baseColorTexture.scale-x.0").fill("2");

    const json = (await documentJson(page)) as {
      extensionsUsed: string[];
      materials: Array<{
        pbrMetallicRoughness: { baseColorTexture: { extensions?: { KHR_texture_transform?: { offset?: number[]; scale?: number[] } } } };
      }>;
    };
    const transform = json.materials[0].pbrMetallicRoughness.baseColorTexture.extensions?.KHR_texture_transform;
    expect(transform?.offset?.[0]).toBeCloseTo(0.25, 5);
    expect(transform?.scale?.[0]).toBeCloseTo(2, 5);
    expect(json.extensionsUsed).toContain("KHR_texture_transform");
  });

  test("Material PBR extras: emissiveFactor renders live in the viewport and is undoable (UX-415)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.0").click();

    const mount = page.getByTestId("viewport.mount");
    await setCameraPose(page, FRONT_CAMERA_POSE);
    const before = await centerPixelRgb(mount);

    // Material index 1 ("Mat_Blue", orderIndex 1 -> suffix ".1"), NOT index
    // 0: this fixture's "Widget" mesh deliberately has TWO primitives
    // sharing the exact SAME position accessor (UX-405's own multi-material
    // coverage need — see inspector-fixture.ts's header) — both triangles
    // are therefore perfectly coplanar, and (confirmed via a real rendered
    // screenshot while first writing this test — see this test's own PR
    // description) the LATER-drawn primitive (Mat_Blue, primitive 1) wins
    // the depth tie and is what's actually visible on screen; editing
    // Mat_Red (primitive 0, fully depth-occluded here) would be a
    // write-only-looking assertion for the wrong reason. A real pixel test
    // has to target whichever material the renderer actually shows.
    await setRangeOrColorValue(page, "inspector.material.emissive.1", "#00ffff"); // bright cyan -- adds directly to the lit color.
    const after = await centerPixelRgb(mount);

    // Emissive is additive on top of whatever lit base-color contribution
    // was already there. Green has the most headroom to prove this (Mat_Blue's
    // OWN baseColorFactor is already [0.1, 0.1, 0.8] -- blue is close to
    // saturated from the base color alone, so a same-magnitude rise there
    // isn't guaranteed the way it is for the previously-low green channel);
    // overall brightness (r+g+b) is the more robust cross-channel check.
    expect(after.g).toBeGreaterThan(before.g + 15);
    expect(after.r + after.g + after.b).toBeGreaterThan(before.r + before.g + before.b + 15);

    const json = (await documentJson(page)) as { materials: Array<{ emissiveFactor?: number[] }> };
    expect(json.materials[1].emissiveFactor?.slice(0, 3)).toEqual([0, 1, 1]);

    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    const jsonUndone = (await documentJson(page)) as { materials: Array<{ emissiveFactor?: number[] }> };
    expect(jsonUndone.materials[1].emissiveFactor ?? [0, 0, 0]).toEqual([0, 0, 0]);
  });

  test("Material PBR extras: doubleSided toggles a REAL backface-culling difference in the viewport and is undoable (UX-415)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.0").click();
    await page.getByTestId("inspector.material.texture.baseColorTexture.clear.0").click();

    const mount = page.getByTestId("viewport.mount");
    await setCameraPose(page, BACK_CAMERA_POSE); // looking at the triangle's BACK -- backface-culled while single-sided (the fixture's own default).
    const beforeBack = await centerPixelRgb(mount);

    await expect(page.getByTestId("inspector.material.double-sided.0")).not.toBeChecked();
    await page.getByTestId("inspector.material.double-sided.0").check();
    await setCameraPose(page, BACK_CAMERA_POSE); // re-assert the pose (a document-driven reload could otherwise reset it).
    const afterBack = await centerPixelRgb(mount);

    // Single-sided (before): the back view shows only background/grid --
    // roughly neutral (r/g/b close together). doubleSided:true (after): the
    // material's own red base color now renders there too -- a real,
    // measurable hue shift, not just "some pixels changed".
    expect(afterBack.r - afterBack.g).toBeGreaterThan(beforeBack.r - beforeBack.g + 15);

    const json = (await documentJson(page)) as { materials: Array<{ doubleSided?: boolean }> };
    expect(json.materials[0].doubleSided).toBe(true);

    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    await setCameraPose(page, BACK_CAMERA_POSE);
    const afterUndoBack = await centerPixelRgb(mount);
    expect(afterUndoBack.r - afterUndoBack.g).toBeLessThan(afterBack.r - afterBack.g - 10); // reverted back toward the neutral "before" reading.
  });

  test("Material PBR extras: alphaMode round-trips through a full RenderHost reload (no vendored pointer-router route -- a load-time-only glTF field) without breaking the viewport, and alphaCutoff only shows for MASK (UX-415)", async ({
    page
  }) => {
    await page.getByTestId("scene-tree.row.0").click();
    await expect(page.getByTestId("inspector.material.alpha-cutoff.0")).toHaveCount(0); // OPAQUE (the fixture's default) -- alphaCutoff hidden.

    await page.getByTestId("inspector.material.alpha-mode.0").selectOption("MASK");
    await expect(page.getByTestId("inspector.material.alpha-cutoff.0")).toBeVisible();
    await setRangeOrColorValue(page, "inspector.material.alpha-cutoff.0", "0.3");

    await page.getByTestId("inspector.material.alpha-mode.0").selectOption("BLEND");
    // alphaMode has no live pointer-router route (a value-bearing string
    // isn't a valid PointerValue) -- patchScene's classifier correctly
    // routes it through a full RenderHost.loadScene() reload instead. This
    // waits for that reload to actually complete rather than asserting
    // blind -- the real "did this actually reach the renderer" check for a
    // field with no pixel-visible effect at alpha=1 (no alpha slider exists
    // in this PR yet -- see this test's own PR notes for that honest gap).
    await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
    await expect(page.getByTestId("inspector.material.alpha-mode.0")).toHaveValue("BLEND");

    const json = (await documentJson(page)) as { materials: Array<{ alphaMode?: string; alphaCutoff?: number }> };
    expect(json.materials[0].alphaMode).toBe("BLEND");
    expect(json.materials[0].alphaCutoff).toBeCloseTo(0.3, 5);

    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click(); // undoes the BLEND write.
    await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
    const jsonUndone = (await documentJson(page)) as { materials: Array<{ alphaMode?: string }> };
    expect(jsonUndone.materials[0].alphaMode ?? "OPAQUE").toBe("MASK");
  });

  test("Light section: color/intensity render live (measurable brightness change) and round-trip; range shown (point), cone angles hidden (non-spot) (UX-417)", async ({
    page
  }) => {
    const mount = page.getByTestId("viewport.mount");
    await setCameraPose(page, FRONT_CAMERA_POSE); // frames "Widget", the fixture's one lit/visible object.

    await page.getByTestId("scene-tree.row.2").click(); // Lamp (point, translated off-origin -- see inspector-fixture.ts)
    await expect(page.getByTestId("inspector.light.intensity")).toHaveValue("500");
    await expect(page.getByTestId("inspector.light.range")).toBeVisible(); // point -- range is meaningful.
    await expect(page.getByTestId("inspector.light.inner-cone-angle")).toHaveCount(0); // not a spot light.

    const before = await centerPixelRgb(mount);
    await page.getByTestId("inspector.light.intensity").fill("6000");
    const after = await centerPixelRgb(mount);
    const brightness = (c: { r: number; g: number; b: number }) => c.r + c.g + c.b;
    expect(brightness(after)).toBeGreaterThan(brightness(before) + 20);

    const json = (await documentJson(page)) as { extensions: { KHR_lights_punctual: { lights: Array<{ intensity: number }> } } };
    expect(json.extensions.KHR_lights_punctual.lights[0].intensity).toBe(6000);

    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("inspector.light.intensity")).toHaveValue("500");
  });

  test("Camera section: yfov/znear/zfar round-trip through the document and are undoable; the 'no live preview yet' gap is noted, not silently missing (UX-418)", async ({
    page
  }) => {
    await page.getByTestId("scene-tree.row.3").click(); // Cam
    await expect(page.getByTestId("inspector.camera.yfov")).toHaveValue("0.8");
    await expect(page.getByTestId("inspector.camera.note")).toContainText("does not yet preview live");

    await page.getByTestId("inspector.camera.yfov").fill("1.2");
    const json = (await documentJson(page)) as { cameras: Array<{ perspective: { yfov: number } }> };
    expect(json.cameras[0].perspective.yfov).toBeCloseTo(1.2, 5);

    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("inspector.camera.yfov")).toHaveValue("0.8");
  });
});
