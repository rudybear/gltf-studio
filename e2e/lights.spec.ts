import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { buildInspectorFixtureBytes, INSPECTOR_FIXTURE_NAME } from "./inspector-fixture.js";
import { waitForNodesSettled } from "./graph-canvas-test-helpers.js";
import {
  buildLightsFixtureBytes,
  buildLightsPlayFixtureBytes,
  LIGHTS_FIXTURE_NAME,
  LIGHTS_PLAY_FIXTURE_NAME
} from "./lights-fixture.js";

/**
 * Full punctual-light control (Track L): lifecycle (Add-menu submenu is
 * covered in e2e/scene-tree-add-menu.spec.ts, not duplicated here), type
 * conversion, render confirmation per type (point already covered by
 * e2e/inspector.spec.ts's own Light-section test — this file adds spot and
 * directional, plus the "spot direction follows node rotation" proof), the
 * shared editor-helper overlay (RH-032..RH-034, specs/ux-viewport.md's
 * UX-313/UX-314), studio-lighting AUTO policy, pointer-picker reach
 * (UX-901 r2/UX-909), and a real graph `pointer/set` on a light property
 * applying live in Play.
 */

const FRONT_CAMERA_POSE = { position: [0, 0, 3] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], target: [0, 0, 0] as [number, number, number] };

async function setCameraPose(page: Page, pose: typeof FRONT_CAMERA_POSE): Promise<void> {
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
  await page.evaluate((p) => window.__gltfStudioTest!.setCameraPose(p), pose);
}

/** Same helper as e2e/inspector.spec.ts's own `centerPixelRgb` — see that file's doc comment for the two-rAF-wait rationale. Duplicated here per this codebase's own per-file-local-helper convention (no shared e2e utils module for this). */
async function centerPixelRgb(mount: Locator): Promise<{ r: number; g: number; b: number }> {
  await mount.page().evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
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
const brightness = (c: { r: number; g: number; b: number }): number => c.r + c.g + c.b;

function documentJson(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__gltfStudioDocumentTest?.getJson());
}

interface LightJson {
  type: string;
  color?: number[];
  intensity?: number;
  range?: number;
  spot?: { innerConeAngle: number; outerConeAngle: number };
}
interface LightsFixtureJson {
  nodes: Array<{ name?: string; extensions?: { KHR_lights_punctual?: { light: number } } }>;
  extensions: { KHR_lights_punctual: { lights: LightJson[] } };
}

async function importInspectorFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', { name: INSPECTOR_FIXTURE_NAME, mimeType: "model/gltf-binary", buffer: buildInspectorFixtureBytes() });
  await expect(page.getByTestId("topbar.project-name")).toHaveText("inspector-fixture");
}

async function importLightsFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', { name: LIGHTS_FIXTURE_NAME, mimeType: "model/gltf-binary", buffer: buildLightsFixtureBytes() });
  await expect(page.getByTestId("topbar.project-name")).toHaveText("lights-fixture");
}

test.describe("Light type conversion in the Inspector (UX-417 r2, DOC-065)", () => {
  test.beforeEach(async ({ page }) => {
    await importInspectorFixture(page);
  });

  test("point -> spot -> directional round-trips color/intensity, adds/drops range and spot cone fields per type, and is undoable", async ({ page }) => {
    await page.getByTestId("scene-tree.row.2").click(); // "Lamp", the fixture's point light.
    await expect(page.getByTestId("inspector.light.type")).toHaveValue("point");
    await expect(page.getByTestId("inspector.light.range")).toBeVisible();
    await expect(page.getByTestId("inspector.light.inner-cone-angle")).toHaveCount(0);

    // point -> spot: range stays, cone-angle fields appear with real seeded defaults.
    await page.getByTestId("inspector.light.type").selectOption("spot");
    await expect(page.getByTestId("inspector.light.type")).toHaveValue("spot");
    await expect(page.getByTestId("inspector.light.range")).toBeVisible();
    await expect(page.getByTestId("inspector.light.inner-cone-angle")).toBeVisible();
    await expect(page.getByTestId("inspector.light.outer-cone-angle")).toBeVisible();
    let json = (await documentJson(page)) as LightsFixtureJson;
    let light = json.extensions.KHR_lights_punctual.lights[0];
    expect(light.color).toEqual([1, 1, 1]); // preserved from the fixture's starting value.
    expect(light.intensity).toBe(500); // preserved.
    expect(light.spot).toEqual({ innerConeAngle: 0, outerConeAngle: Math.PI / 4 });

    // spot -> directional: range AND spot both drop; color/intensity still preserved.
    await page.getByTestId("inspector.light.type").selectOption("directional");
    await expect(page.getByTestId("inspector.light.type")).toHaveValue("directional");
    await expect(page.getByTestId("inspector.light.range")).toHaveCount(0);
    await expect(page.getByTestId("inspector.light.inner-cone-angle")).toHaveCount(0);
    json = (await documentJson(page)) as LightsFixtureJson;
    light = json.extensions.KHR_lights_punctual.lights[0];
    expect(light.type).toBe("directional");
    expect(light.color).toEqual([1, 1, 1]);
    expect(light.intensity).toBe(500);
    expect(light.range).toBeUndefined();
    expect(light.spot).toBeUndefined();

    // Two undos (directional->spot, spot->point) restore the original point light exactly.
    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("inspector.light.type")).toHaveValue("spot");
    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("inspector.light.type")).toHaveValue("point");
    json = (await documentJson(page)) as LightsFixtureJson;
    light = json.extensions.KHR_lights_punctual.lights[0];
    expect(light.type).toBe("point");
    expect(light.spot).toBeUndefined();
  });
});

test.describe("Light render confirmation per type (specs/render-host.md's engine-three implementation notes)", () => {
  test.beforeEach(async ({ page }) => {
    await importLightsFixture(page);
    await setCameraPose(page, FRONT_CAMERA_POSE); // frames "Widget", the fixture's one lit surface.
  });

  test("directional light: an intensity bump produces a measurable rendered brightness increase (rendering confirmed for this type)", async ({ page }) => {
    const mount = page.getByTestId("viewport.mount");
    await page.getByTestId("scene-tree.row.2").click(); // "Sun" (directional).
    await expect(page.getByTestId("inspector.light.type")).toHaveValue("directional");

    const before = await centerPixelRgb(mount);
    await page.getByTestId("inspector.light.intensity").fill("30");
    const after = await centerPixelRgb(mount);
    expect(brightness(after)).toBeGreaterThan(brightness(before) + 20);

    await page.getByTestId("topbar.undo").click();
    const undone = await centerPixelRgb(mount);
    expect(Math.abs(brightness(undone) - brightness(before))).toBeLessThan(20);
  });

  test("spot light: direction follows node ROTATION — identity rotation contributes ~nothing, rotating -90° about X aims the cone straight at Widget, producing a measurable brightness increase (RENDER + rotation-follow both confirmed)", async ({ page }) => {
    const mount = page.getByTestId("viewport.mount");
    await page.getByTestId("scene-tree.row.1").click(); // "Spot".
    await expect(page.getByTestId("inspector.light.type")).toHaveValue("spot");
    await expect(page.getByTestId("inspector.transform.rotation-x")).toHaveValue("0");

    const beforeRotate = await centerPixelRgb(mount);
    await page.getByTestId("inspector.transform.rotation-x").fill("-90");
    const afterRotate = await centerPixelRgb(mount);
    expect(brightness(afterRotate)).toBeGreaterThan(brightness(beforeRotate) + 20);

    // Undo the rotation restores the dark (cone-missing) starting brightness.
    // Undo reverts the DOCUMENT's rotation exactly (the pixel-revert half of
    // "undo really works" is already covered by the directional test above —
    // a spot's own hard cone cutoff right at the boundary this fixture
    // deliberately sits on is real but noisier render-timing territory, not
    // worth a second, more fragile pixel assertion here).
    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("inspector.transform.rotation-x")).toHaveValue("0");
    const json = (await documentJson(page)) as LightsFixtureJson & { nodes: Array<{ rotation?: number[] }> };
    expect(json.nodes[1].rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]);
  });
});

test.describe("Neutral studio-lighting rig AUTO policy + toggle (specs/ux-viewport.md UX-313)", () => {
  test("a document WITH real lights turns the studio-lighting toggle OFF automatically on import; clicking it manually turns it back on for the current scene", async ({ page }) => {
    await importLightsFixture(page);
    await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
    const toggle = page.getByTestId("viewport.studio-light-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  test("a document with NO authored lights (the Empty scene starter) leaves the studio-lighting toggle ON", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("viewport.gallery.card.empty.load").click();
    await expect(page.getByTestId("topbar.project-name")).toBeVisible();
    await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
    await expect(page.getByTestId("viewport.studio-light-toggle")).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("Light helpers: selected-always + all-lights toggle, never exported (RH-032..RH-034, UX-314)", () => {
  test("selecting a light node always shows its helper regardless of the toggle; the 'all lights' toggle additionally shows every light's helper", async ({ page }) => {
    await importLightsFixture(page);
    await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);

    // Nothing selected, toggle off: no helpers.
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(0);

    // Selecting a light shows exactly its own helper, toggle still off.
    await page.getByTestId("scene-tree.row.1").click(); // "Spot".
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(1);

    // Deselect (clear selection, UX-303): a corner of the canvas has nothing
    // under it (the triangle spans roughly the center third) — same
    // real-mouse-click pattern e2e/viewport.spec.ts's own UX-303 coverage uses.
    const box = (await page.getByTestId("viewport.mount").boundingBox())!;
    await page.mouse.click(box.x + 4, box.y + 4);
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(0);

    // Toggle "all lights" on: both lights (Spot + Sun) get a helper, with nothing selected.
    await page.getByTestId("viewport.light-helpers-toggle").click();
    await expect(page.getByTestId("viewport.light-helpers-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(2);

    // Toggling back off, with a light still selected, drops back to just the selection's own helper.
    await page.getByTestId("scene-tree.row.2").click(); // "Sun".
    await page.getByTestId("viewport.light-helpers-toggle").click();
    await expect(page.getByTestId("viewport.light-helpers-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(1);
  });

  test("GUARANTEE: toggling light helpers on never changes the exported bytes (RH-034 — helpers live only in the three.js scene, never the document)", async ({ page }) => {
    await importLightsFixture(page);
    await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);

    const [download1] = await Promise.all([page.waitForEvent("download"), page.getByTestId("topbar.export").click()]);
    const baseline = readFileSync((await download1.path())!);

    await page.getByTestId("viewport.light-helpers-toggle").click(); // all-lights helpers ON.
    await page.getByTestId("scene-tree.row.1").click(); // plus a selection, exercising the "selected always" path too.
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(2);

    const [download2] = await Promise.all([page.waitForEvent("download"), page.getByTestId("topbar.export").click()]);
    const withHelpersShown = readFileSync((await download2.path())!);

    expect(withHelpersShown.equals(baseline)).toBe(true);
  });
});

test.describe("Pointer picker reaches a light property (specs/ux-pointer-picker.md UX-901 r2/UX-909)", () => {
  test("the Lights tree section lists the fixture's Spot/Sun lights; selecting Spot shows its full type-gated property list (color/intensity/range/both cone angles, since Spot IS a spot); confirming a light property writes the graph node's pointer config", async ({ page }) => {
    await importLightsFixture(page);
    await page.getByTestId("gcanvas.palette.search").fill("pointer/set");
    await page.getByTestId("gcanvas.palette.op.pointer/set").click();
    const graph = (await page.evaluate(() => window.__gltfStudioGraphTest!.getDocumentJson())) as {
      extensions: { KHR_interactivity: { graphs: Array<{ nodes: unknown[] }> } };
    };
    const nodeIndex = graph.extensions.KHR_interactivity.graphs[0].nodes.length - 1;
    await expect(page.getByTestId(`gcanvas.node.${nodeIndex}`)).toBeVisible();
    await waitForNodesSettled(page);

    await page.getByTestId(`gcanvas.pointer-icon.${nodeIndex}`).click();
    const dialog = page.getByTestId("pointer-picker.dialog");
    await expect(dialog).toBeVisible();

    await expect(page.locator('[data-testid^="pointer-picker.tree.lights."]')).toHaveCount(2); // Spot, Sun.
    await page.getByTestId("pointer-picker.tree.lights.0").click(); // "Spot".
    await expect(page.getByTestId("pointer-picker.prop.color")).toBeVisible();
    await expect(page.getByTestId("pointer-picker.prop.intensity")).toBeVisible();
    await expect(page.getByTestId("pointer-picker.prop.range")).toBeVisible();
    await expect(page.getByTestId("pointer-picker.prop.spot/innerConeAngle")).toBeVisible();

    await page.getByTestId("pointer-picker.prop.intensity").click();
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("/extensions/KHR_lights_punctual/lights/0/intensity");
    await expect(page.getByTestId("pointer-picker.type-chip")).toHaveText("float");
    await page.getByTestId("pointer-picker.confirm").click();
    await expect(dialog).not.toBeVisible();

    const after = (await page.evaluate(() => window.__gltfStudioGraphTest!.getDocumentJson())) as {
      extensions: { KHR_interactivity: { graphs: Array<{ nodes: Array<{ configuration?: { pointer?: { value: string[] } } }> }> } };
    };
    expect(after.extensions.KHR_interactivity.graphs[0].nodes[nodeIndex].configuration?.pointer?.value).toEqual([
      "/extensions/KHR_lights_punctual/lights/0/intensity"
    ]);
  });
});

test.describe("Graph pointer/set on a light property applies live in Play (specs/render-host.md RH-032..RH-034's routing, engine-api.md PC-001)", () => {
  test("event/onStart -> pointer/set(light color) turns the light from green to red as soon as Play starts, visible as a real rendered color shift", async ({ page }) => {
    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', {
      name: LIGHTS_PLAY_FIXTURE_NAME,
      mimeType: "model/gltf-binary",
      buffer: buildLightsPlayFixtureBytes()
    });
    await expect(page.getByTestId("topbar.project-name")).toHaveText("lights-play-fixture");
    await setCameraPose(page, FRONT_CAMERA_POSE);

    const mount = page.getByTestId("viewport.mount");
    const beforePlay = await centerPixelRgb(mount);
    expect(beforePlay.g).toBeGreaterThan(beforePlay.r); // starting color is GREEN.

    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("locked-banner")).toBeVisible();
    const duringPlay = await centerPixelRgb(mount);
    expect(duringPlay.r).toBeGreaterThan(duringPlay.g); // event/onStart's pointer/set flipped it to RED, live.

    await page.getByTestId("playbar.stop").click();
  });
});
