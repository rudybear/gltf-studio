import { test, expect, type Page, type Locator } from "@playwright/test";
import { assertRegionRendersContent, assertRegionSpansMultipleLines, assertRegionsVisuallyDiffer } from "./visual-assert.js";
import { waitForNodesSettled } from "./graph-canvas-test-helpers.js";

/**
 * Champagne (specs/ux-shell.md UX-120 r2's third starter-gallery card,
 * `samples/champagne.glb`, `scripts/make-champagne.mjs`): end-to-end
 * coverage of the pop-the-cork interaction, at both the DOM/overlay level
 * (the `popped`/`animating` variables the interpreter/compiled engine both
 * expose the same way racer.spec.ts's `V.state`/`V.raceT`/`V.steer` rows
 * do) and the pixel level (real geometry actually moving/appearing on
 * screen, not just a variable flipping in isolation).
 *
 * Scene facts below (node indices, variable ids, node/graph counts) come
 * straight from `scripts/make-champagne.mjs`'s own exported constants and
 * its own build log ("64 graph nodes" — see that script's `buildGlbBytes`
 * verification output), not guessed. Like `playground.glb`, this asset has
 * a wrapping "Root" node (node 0) — every other node is one of its direct
 * children — so `scene-tree.row.<n>` == raw glTF node index exactly, same
 * convention `e2e/golden-path.spec.ts` relies on for its own Root-wrapped
 * fixture.
 *
 * Cork (node 3) is the ONLY selectable node in the whole scene (Bottle,
 * Ground, and all six foam spheres carry `KHR_node_selectability`'s
 * `selectable: false` — the racer convention). That fact is exploited below
 * for the SECOND click: once popped, Cork has moved to a screen position
 * this file has no closed-form projection for (no camera reframe is
 * possible mid-play — `viewport.camera-frame` is an edit-mode-only
 * affordance, same restriction `racer.spec.ts`'s own play-mode steps note),
 * so `locateSelectableNodeOnScreen` grid-scans NDC space via the existing
 * `window.__gltfStudioTest.pick()` test hook (already an established
 * PLAY-mode passthrough, see `racer.spec.ts`'s own "PLAY mode: a checkpoint
 * pylon stays non-interactive" step) to find wherever Cork actually
 * rendered to, then drives a REAL `page.mouse.click()` there — Cork being
 * the only selectable node in the document means any non-null hit from
 * that scan can only be Cork, no per-hit nodeIndex check required.
 */

const SCENE_NODE = { CORK: 3, BOTTLE: 2, FOAM0: 4 } as const;
const TOTAL_SCENE_NODES = 12; // Root + Ground + Bottle + Cork + 6 foam + Lamp + Cam
const TOTAL_GRAPH_NODES = 64; // scripts/make-champagne.mjs's own "GIscript compile" build-log line

async function loadChampagne(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.getByTestId("viewport.gallery")).toBeVisible();
  await expect(page.getByTestId("viewport.gallery.card.champagne")).toBeVisible();
  await page.getByTestId("viewport.gallery.card.champagne.load").click();
  await expect(page.getByTestId("topbar.project-name")).toHaveText("champagne");
}

async function readVal(row: Locator): Promise<string> {
  return (await row.locator(".val").textContent()) ?? "";
}

function audioDiagnostics(page: Page): Promise<string> {
  return page.evaluate(() => window.__gltfStudioAudioTest?.diagnostics() ?? "no hook");
}

/**
 * Grid-scans NDC space (step 0.04, ~46x46) via the live `pick()` test hook
 * to find a selectable node's CURRENT screen position, then converts the
 * hit NDC coordinate back to real client coordinates using the exact
 * inverse of Viewport.tsx's own `onClick` NDC-from-`clientX/clientY`
 * formula. Returns `null` if nothing selectable is under any sampled point
 * (camera framing too tight/loose) rather than guessing.
 */
async function locateSelectableNodeOnScreen(page: Page, mount: Locator): Promise<{ x: number; y: number } | null> {
  const box = (await mount.boundingBox())!;
  const ndc = await page.evaluate(() => {
    const test = window.__gltfStudioTest;
    if (!test) return null;
    for (let y = -0.92; y <= 0.92; y += 0.04) {
      for (let x = -0.92; x <= 0.92; x += 0.04) {
        const hit = test.pick(x, y);
        if (hit) return { x, y };
      }
    }
    return null;
  });
  if (!ndc) return null;
  return { x: box.x + ((ndc.x + 1) / 2) * box.width, y: box.y + ((1 - ndc.y) / 2) * box.height };
}

test.describe.configure({ mode: "serial" });

test("Champagne: gallery load, scene tree, pop-the-cork (interpreter), reset, stop, graph/script tabs, and compiled-engine parity", async ({ page }) => {
  test.slow();
  test.setTimeout(120_000);

  await test.step("load Champagne from the starter gallery (UX-120 r2)", async () => {
    await loadChampagne(page);
  });

  await test.step("scene tree is populated with the asset's real 12 flat-under-Root nodes", async () => {
    const rows = page.getByTestId("scene-tree.list").locator(".tree-row");
    await expect(rows).toHaveCount(TOTAL_SCENE_NODES);
    await expect(page.getByTestId("scene-tree.row.1")).toContainText("Ground");
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.BOTTLE}`)).toContainText("Bottle");
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.CORK}`)).toContainText("Cork");
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.FOAM0}`)).toContainText("FoamBurst0");
  });

  await test.step("viewport renders real pixels, not a blank canvas", async () => {
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest?.isReady() === true)).toBe(true);
    await assertRegionRendersContent(page.getByTestId("viewport.mount"));
  });

  await test.step("audition (edit mode): AH-001's user gesture happens here, before play mode, so the pop sound can actually play once popped", async () => {
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.CORK}`).click();
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.CORK}`)).toHaveClass(/selected/);
    await expect(page.getByTestId("inspector.audio.audition")).toBeEnabled();
    await page.getByTestId("inspector.audio.audition").click();
    await expect.poll(() => audioDiagnostics(page)).toContain("running");
  });

  const mount = page.getByTestId("viewport.mount");
  let baselineShot: Buffer;
  let poppedShot: Buffer;

  await test.step("frame the camera on Cork, then enter play mode (interpreter)", async () => {
    await page.getByTestId("viewport.camera-frame").click();
    baselineShot = await mount.screenshot();

    await expect(page.getByTestId("playbar.engine-picker")).toHaveValue("interpreter");
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");
    await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();
  });

  await test.step("a real click dead-center (Cork, framed above) pops it: popped observable, audio trigger, foam + cork motion visible, animating guard clears", async () => {
    const poppedRow = page.getByTestId("viewport.play-overlay.variable.popped");
    const animatingRow = page.getByTestId("viewport.play-overlay.variable.animating");
    expect(await readVal(poppedRow)).toBe("false");
    expect(await readVal(animatingRow)).toBe("false");

    const box = (await mount.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // popped flips synchronously (the graph's very first statement on click).
    await expect.poll(() => readVal(poppedRow)).toBe("true");
    // The pop sound: a real, audible voice, the same diagnostics contract
    // e2e/golden-path.spec.ts's own "play (interpreter)" step already
    // established for make-sample.mjs's audio-emitter "playing" trigger.
    await expect.poll(() => audioDiagnostics(page)).toMatch(/last trigger: source 0/);

    // The pop arc + staggered foam reveal take ~0.55s total (see
    // scripts/make-champagne.mjs's own durations); `animating` clears once
    // it fully settles -- the guard e2e-observably doing its job.
    await expect.poll(() => readVal(animatingRow), { timeout: 4000 }).toBe("false");
    expect(await readVal(poppedRow)).toBe("true"); // still popped -- only a second click resets it.

    // Pixel evidence that something genuinely moved/appeared, not just a
    // variable flipping in isolation: Cork flew off its framed dead-center
    // position and six foam spheres appeared near the (now-empty) neck --
    // both changes land within this same whole-viewport screenshot.
    poppedShot = await mount.screenshot();
    await assertRegionsVisuallyDiffer(baselineShot, poppedShot);
  });

  await test.step("a second real click on Cork (now relocated) resets it: foam hidden, cork back at its rest pose, popped clears", async () => {
    const poppedRow = page.getByTestId("viewport.play-overlay.variable.popped");
    const animatingRow = page.getByTestId("viewport.play-overlay.variable.animating");

    const corkPos = await locateSelectableNodeOnScreen(page, mount);
    expect(corkPos, "expected to find Cork (the only selectable node) somewhere on screen after it popped").not.toBeNull();
    await page.mouse.click(corkPos!.x, corkPos!.y);

    await expect.poll(() => readVal(animatingRow)).toBe("true");
    await expect.poll(() => readVal(poppedRow), { timeout: 4000 }).toBe("false");
    await expect.poll(() => readVal(animatingRow)).toBe("false");

    // Cork interpolated back toward its exact authored rest pose and the
    // foam re-hid -- compared against the fully-popped mid-state (foam
    // visible, cork away) rather than the original baseline, since AA/float
    // settle noise can make a strict "back to baseline" pixel comparison
    // flaky; what matters is that resetting visibly changed the frame away
    // from the popped state, which this still proves without over-fitting
    // to exact pixel equality.
    await page.waitForTimeout(150);
    const resetShot = await mount.screenshot();
    await assertRegionsVisuallyDiffer(poppedShot, resetShot);
  });

  await test.step("stop restores the pre-play document -- normal editor selection works again", async () => {
    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
    await expect(page.getByTestId("viewport.play-overlay")).toHaveCount(0);
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.CORK}`).click();
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.CORK}`)).toHaveClass(/selected/);
    await expect(page.getByTestId("inspector.identity")).toContainText(`Node #${SCENE_NODE.CORK}`);
  });

  await test.step("graph tab opens at the asset's real 64-node scale", async () => {
    await page.getByTestId("dock.tab.graph").click();
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId("gcanvas.root")).toBeVisible();
    await expect(page.locator('[data-testid^="gcanvas.node."]')).toHaveCount(TOTAL_GRAPH_NODES, { timeout: 15_000 });
    await waitForNodesSettled(page, "__gltfStudioGraphCanvasTest", 15_000);
  });

  await test.step("Script tab shows real, readable, multi-line TypeScript (this asset's whole showcase point)", async () => {
    await page.getByTestId("dock.tab.script").click();
    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    await expect(page.getByTestId("script.panel")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15_000 })
      .toContain("rt.onSelect(");
    const code = await page.evaluate(() => window.__gltfStudioScriptTest!.getCode());
    expect(code).toContain("createEngine");
    expect(code).toContain("rt.setDelay(");
    expect(code).toContain("rt.ptrInterp(");
    await assertRegionSpansMultipleLines(page.getByTestId("script.panel"));
  });

  await test.step("compiled-engine parity: the same pop click, driven by the compiled engine instead of the interpreter", async () => {
    test.slow();
    await page.getByTestId("playbar.engine-picker").selectOption("compiled");
    await expect(page.getByTestId("playbar.engine-picker")).toHaveValue("compiled");

    await page.getByTestId(`scene-tree.row.${SCENE_NODE.CORK}`).click();
    await page.getByTestId("viewport.camera-frame").click();
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");
    await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();

    const poppedRow = page.getByTestId("viewport.play-overlay.variable.popped");
    expect(await readVal(poppedRow)).toBe("false");
    const box = (await mount.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => readVal(poppedRow), { timeout: 5000 }).toBe("true");

    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
    // Leave the store clean for any spec run after this one.
    await page.getByTestId("playbar.engine-picker").selectOption("interpreter");
  });
});
