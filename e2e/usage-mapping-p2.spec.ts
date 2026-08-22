import { test, expect, type Page } from "@playwright/test";
import { buildUsageMappingP2FixtureBytes, USAGE_P2_FIXTURE_NAME, USAGE_P2_GRAPH_NODE, USAGE_P2_NODE } from "./usage-mapping-p2-fixture.js";

/** The fixture's own 3 pre-existing graph nodes (MATERIAL_POINTER_SET/ANIMATION_START/ON_START) — a known, stable baseline rather than a possibly-racy `graphNodeCount` read taken before the Behavior graph canvas's own async ELK layout has settled (the Graph dock tab may not even be the active one yet when a test's baseline read happens). */
const BASE_GRAPH_NODE_COUNT = Object.keys(USAGE_P2_GRAPH_NODE).length;

/**
 * specs/ux-usage-mapping.md UX-1115..1119 (Usage Mapping Phase 2):
 * ambient ⚡ reference badges (scene tree + asset browser), the live
 * "Attach behavior…" menu, and the Script tab's Monaco pointer-path links —
 * on a dedicated fixture (e2e/usage-mapping-p2-fixture.ts) built specifically
 * for these, distinct from Phase 1's own fixture (whose e2e suite pins exact
 * node/graph-node counts this file's own additions would otherwise drift).
 */

async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', {
    name: USAGE_P2_FIXTURE_NAME,
    mimeType: "model/gltf-binary",
    buffer: buildUsageMappingP2FixtureBytes()
  });
  await expect(page.getByTestId("topbar.project-name")).toHaveText("usage-mapping-p2-fixture");
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
}

function graphNodeCount(page: Page) {
  return page.locator('[data-testid^="gcanvas.node."]').count();
}

test.describe("Usage Mapping Phase 2: ambient reference badges (UX-1115/UX-1116/UX-1117)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("a scene-tree row referenced by behavior (via UX-1102's animation fan-out) shows a ⚡ badge with a correct count tooltip; clicking it opens the Inspector's Used-in-behavior section", async ({ page }) => {
    const badge = page.getByTestId(`scene-tree.row.${USAGE_P2_NODE.TARGET}.usage-badge`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("title", "1 reference");

    // The zero-ref row gets no badge at all.
    await expect(page.getByTestId(`scene-tree.row.${USAGE_P2_NODE.ZERO}.usage-badge`)).toHaveCount(0);

    await badge.click();
    await expect(page.getByTestId(`scene-tree.row.${USAGE_P2_NODE.TARGET}`)).toHaveClass(/selected/);
    await expect(page.getByTestId("right-panel.tab.inspector")).toHaveClass(/active/);
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
  });

  test("the badge toggle hides every scene-tree and asset-browser badge; default is ON", async ({ page }) => {
    await expect(page.getByTestId("scene-tree.toggle-usage-badges")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`scene-tree.row.${USAGE_P2_NODE.TARGET}.usage-badge`)).toBeVisible();
    await page.getByTestId("asset-browser.tab.materials").click();
    await expect(page.getByTestId("asset-browser.materials.0.usage-badge")).toBeVisible();

    await page.getByTestId("scene-tree.toggle-usage-badges").click();
    await expect(page.getByTestId("scene-tree.toggle-usage-badges")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId(`scene-tree.row.${USAGE_P2_NODE.TARGET}.usage-badge`)).toHaveCount(0);
    await expect(page.getByTestId("asset-browser.materials.0.usage-badge")).toHaveCount(0);
  });

  test("the Materials tab shows a ⚡ badge on the referenced material row; clicking jumps to its referencing graph node (UX-1115)", async ({ page }) => {
    await page.getByTestId("asset-browser.tab.materials").click();
    const badge = page.getByTestId("asset-browser.materials.0.usage-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("title", "1 reference");

    await badge.click();
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId("gcanvas.details")).toContainText("pointer/set");
    await expect(page.getByTestId("gcanvas.details")).toContainText("/materials/0/pbrMetallicRoughness/baseColorFactor");
  });

  test("the Animations tab shows a ⚡ badge on the referenced clip row; clicking jumps to its referencing animation/start node (UX-1115, resolving OPEN(UX-usage-animation-encoding-tbd))", async ({ page }) => {
    await page.getByTestId("asset-browser.tab.animations").click();
    const badge = page.getByTestId("asset-browser.animations.0.usage-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("title", "1 reference");

    await badge.click();
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId("gcanvas.details")).toContainText("animation/start");
  });
});

test.describe("Usage Mapping Phase 2: live Attach-behavior menu (UX-1118)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  async function openAttachMenu(page: Page, nodeIndex: number = USAGE_P2_NODE.ZERO): Promise<void> {
    await page.getByTestId(`scene-tree.row.${nodeIndex}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Not referenced in behavior");
    await page.getByTestId("inspector.usage.attach").click();
    await expect(page.getByTestId("inspector.usage.attach-menu")).toHaveClass(/open/);
  }

  test('"On select → Set property…" creates a real event/onSelect + pointer/set node pair as one undo step, navigates to the Behavior graph, and opens the pointer picker', async ({ page }) => {
    await openAttachMenu(page);

    await page.getByTestId("inspector.usage.attach-menu.set-property").click();

    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(graphNodeCount(page)).resolves.toBe(BASE_GRAPH_NODE_COUNT + 2);
    await expect(page.getByTestId("gcanvas.details")).toContainText("pointer/set");

    // UX-1118: the picker opens preset to the newly-created node's own
    // placeholder path, letting the user retarget it immediately.
    await expect(page.getByTestId("pointer-picker.dialog")).toBeVisible();
    await expect(page.getByTestId("pointer-picker.path")).toContainText(`/nodes/${USAGE_P2_NODE.ZERO}/translation`);
    await page.getByTestId("pointer-picker.cancel").click();

    // One undo step removes BOTH new nodes (the whole attach, not two separate steps).
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    await expect(graphNodeCount(page)).resolves.toBe(BASE_GRAPH_NODE_COUNT);
  });

  test('"On select → Interpolate…" creates an event/onSelect + pointer/interpolate node pair', async ({ page }) => {
    await openAttachMenu(page);

    await page.getByTestId("inspector.usage.attach-menu.interpolate").click();

    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(graphNodeCount(page)).resolves.toBe(BASE_GRAPH_NODE_COUNT + 2);
    await expect(page.getByTestId("gcanvas.details")).toContainText("pointer/interpolate");
  });

  test('"On select → Play sound" is offered (this node carries a real KHR_audio_emitter) and creates an event/onSelect + pointer/set node pair targeting the emitter\'s source "playing" trigger', async ({ page }) => {
    await openAttachMenu(page);
    const playSound = page.getByTestId("inspector.usage.attach-menu.play-sound");
    await expect(playSound).toBeVisible();

    await playSound.click();

    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(graphNodeCount(page)).resolves.toBe(BASE_GRAPH_NODE_COUNT + 2);
    await expect(page.getByTestId("gcanvas.details")).toContainText("/extensions/KHR_audio_emitter/sources/0/playing");
  });

  test('"On select → Play sound" on a MULTI-emitter node (PR #59\'s .emitters array) targets the FIRST bound emitter\'s own source, not the singular-.emitter shape', async ({ page }) => {
    await openAttachMenu(page, USAGE_P2_NODE.MULTI);
    const playSound = page.getByTestId("inspector.usage.attach-menu.play-sound");
    await expect(playSound).toBeVisible(); // offered even though this node has no singular `.emitter` at all.

    await playSound.click();

    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(graphNodeCount(page)).resolves.toBe(BASE_GRAPH_NODE_COUNT + 2);
    // Prop_Multi's `.emitters` is [1, 0] — the FIRST entry (registry emitter 1, sources: [1]) wins.
    await expect(page.getByTestId("gcanvas.details")).toContainText("/extensions/KHR_audio_emitter/sources/1/playing");
  });

  test('"On select → Play animation ▸" opens a clip submenu; choosing "Spin" creates an event/onSelect + animation/start node pair', async ({ page }) => {
    await openAttachMenu(page);

    await page.getByTestId("inspector.usage.attach-menu.play-animation").click();
    await expect(page.getByTestId("inspector.usage.attach-menu.play-animation-submenu")).toHaveClass(/open/);
    await page.getByTestId("inspector.usage.attach-menu.play-animation.0").click();

    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(graphNodeCount(page)).resolves.toBe(BASE_GRAPH_NODE_COUNT + 2);
    await expect(page.getByTestId("gcanvas.details")).toContainText("animation/start");
  });
});

test.describe("Usage Mapping Phase 2: Script tab Monaco pointer-path links (UX-1119)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("the pointer-path link the Script tab reports really is present, and clicking it selects the referenced material's Asset Browser row without leaving the Script tab", async ({ page }) => {
    await page.getByTestId("dock.tab.script").click();
    await expect(page.getByTestId("script.panel")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15_000 })
      .toContain("/materials/0/pbrMetallicRoughness/baseColorFactor");
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getPointerLinks() ?? []))
      .toContain("/materials/0/pbrMetallicRoughness/baseColorFactor");

    // `clickPointerLink` invokes the exact same handler the real Monaco
    // "command:" URI click does (`script-panel.tsx`'s `registerCommand`
    // callback) — this repo's established way to exercise a real-click
    // RESULT without a flaky pixel-perfect Monaco DOM interaction (the same
    // precedent `setValue`/`GraphCanvasTestHook.simulateConnect` set for
    // other Monaco/canvas gestures in this suite).
    const clicked = await page.evaluate(() => window.__gltfStudioScriptTest?.clickPointerLink("/materials/0/pbrMetallicRoughness/baseColorFactor") ?? false);
    expect(clicked).toBe(true);

    // Still on the Script tab — this jump never switches `activeDockTab`.
    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    await page.getByTestId("asset-browser.tab.materials").click();
    await expect(page.getByTestId("asset-browser.materials.0")).toHaveClass(/selected/);
  });

  test("clicking a pointer-path link for a /nodes/{N} pointer selects that scene node AND drives the amber reference highlight (bidirectional with UX-1108's own → Script jump)", async ({ page }) => {
    // Reuses this same fixture's material pointer/set node's own reachable
    // handler wiring is materials-only; for a /nodes/* link this test wires
    // one in directly via the live Attach-behavior flow (UX-1118) — a real,
    // already-verified way to get a genuine reachable pointer/set node onto
    // Prop_Zero without hand-authoring yet another fixture variant.
    await page.getByTestId(`scene-tree.row.${USAGE_P2_NODE.ZERO}`).click();
    await page.getByTestId("inspector.usage.attach").click();
    await page.getByTestId("inspector.usage.attach-menu.set-property").click();
    await page.getByTestId("pointer-picker.cancel").click(); // keep the default /translation path

    await page.getByTestId("dock.tab.script").click();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getPointerLinks() ?? []), { timeout: 15_000 })
      .toContain(`/nodes/${USAGE_P2_NODE.ZERO}/translation`);

    const clicked = await page.evaluate((path) => window.__gltfStudioScriptTest?.clickPointerLink(path) ?? false, `/nodes/${USAGE_P2_NODE.ZERO}/translation`);
    expect(clicked).toBe(true);

    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/); // never left the Script tab
    await expect(page.getByTestId(`scene-tree.row.${USAGE_P2_NODE.ZERO}`)).toHaveClass(/selected/);
    await expect(page.getByTestId(`scene-tree.row.${USAGE_P2_NODE.ZERO}`)).toHaveClass(/ref-highlighted/);
  });
});
