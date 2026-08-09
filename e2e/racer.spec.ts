import { test, expect, type Page, type Locator } from "@playwright/test";
import { assertRegionRendersContent, assertRegionSpansMultipleLines } from "./visual-assert.js";

/**
 * R4 Racer (specs/ux-shell.md UX-119's second starter-gallery card,
 * `samples/r4-racer.glb`): end-to-end coverage of that asset at its REAL
 * scale — a 26-node flat scene and a 366-node `KHR_interactivity` behavior
 * graph, both well beyond every other e2e fixture in this repo (the
 * checkpoint sample e2e/golden-path.spec.ts drives has 8 scene nodes and a
 * 20-node graph; e2e/graph-canvas.spec.ts's own fixture has 2 graph nodes).
 * Runs as its own Playwright project (`playwright.config.ts`'s "racer"
 * project, `dependencies: ["golden-path"]`) so it always runs LAST, after
 * every other spec file including the golden path — same rationale as the
 * golden path's own project (a single heavy scenario should not compete
 * for a headless Chromium's GPU/CPU budget against everything else
 * running concurrently; see playwright.config.ts's worker-count comment).
 *
 * Facts asserted below (node indices, variable ids, node/graph counts) come
 * straight from the committed asset — dumped via a throwaway Node script
 * against samples/r4-racer.glb's own GLB JSON chunk, not guessed. It has no
 * wrapping "Root" node (unlike playground.glb) — all 26 nodes are flat
 * scene roots in array order — so scene-tree row index == glTF node index
 * exactly. PadLeft is node 17; V.state (0 = countdown, 1 = racing) and
 * V.raceT/V.steer are `KHR_interactivity` variables the running interpreter
 * exposes through the same `viewport.play-overlay.variable.<key>` testids
 * PlayOverlay.tsx documents generically for any asset.
 */

const SCENE_NODE = { PAD_LEFT: 17 } as const;

async function readVal(row: Locator): Promise<string> {
  return (await row.locator(".val").textContent()) ?? "";
}

async function loadRacer(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("viewport.gallery")).toBeVisible();
  await expect(page.getByTestId("viewport.gallery.card.racer")).toBeVisible();
  await page.getByTestId("viewport.gallery.card.racer.load").click();
  await expect(page.getByTestId("topbar.project-name")).toHaveText("r4-racer");
}

test.describe.configure({ mode: "serial" });

test("R4 Racer: gallery load, scene/graph/script at real scale, and play-mode pad interaction", async ({ page }) => {
  test.slow();
  test.setTimeout(120_000); // see the graph-canvas step's own comment for the measured number this is sized against

  await test.step("load R4 Racer from the starter gallery (UX-119)", async () => {
    await loadRacer(page);
  });

  await test.step("scene tree is populated with the asset's real 26 flat nodes", async () => {
    const rows = page.getByTestId("scene-tree.list").locator(".tree-row");
    await expect(rows).toHaveCount(26);
    await expect(page.getByTestId("scene-tree.row.0")).toContainText("Ground");
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PAD_LEFT}`)).toContainText("PadLeft");
  });

  await test.step("viewport renders real pixels, not a blank canvas", async () => {
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest?.isReady() === true)).toBe(true);
    await assertRegionRendersContent(page.getByTestId("viewport.mount"));
  });

  await test.step("graph canvas opens at the real 366-node scale without freezing the page", async () => {
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId("gcanvas.root")).toBeVisible();
    const start = Date.now();
    // ELK's layered layout for 366 nodes runs off-thread in a worker
    // (packages/graph-canvas/src/layout.worker.ts). Measured locally
    // (single Chromium instance, unloaded machine, prod build via `vite
    // preview`): consistently ~600ms — see the console.log below for this
    // run's own number. e2e/graph-canvas.spec.ts's own comments document a
    // mere 20-node graph occasionally needing up to 120s of assertion
    // budget under a SATURATED CI runner (playwright.config.ts's
    // worker-count comment: several concurrent headless-Chromium instances
    // doing real WebGL/ELK work on a 4-vCPU box), but that number is about
    // resource CONTENTION between concurrently-running spec files, not raw
    // compute time for a bigger graph — and this project's own
    // `dependencies: ["golden-path"]` chaining (see this file's header
    // comment) means racer.spec.ts never actually shares a worker slot with
    // anything else the way graph-canvas.spec.ts's tests can. 30s is
    // therefore a genuinely generous (~50x local measurement) but still
    // honestly-bounded budget, not a guess scaled from an unrelated number.
    await expect(page.locator('[data-testid^="gcanvas.node."]')).toHaveCount(366, { timeout: 30_000 });
    const layoutMs = Date.now() - start;
    console.log(`[racer.spec] 366-node ELK layout resolved in ${layoutMs}ms`);
    // Liveness check independent of the count-poll above: a truly hung main
    // thread wouldn't just fail that poll, it would also never commit this
    // completely unrelated tab switch. Confirms the page didn't just
    // eventually settle into a barely-alive state.
    await page.getByTestId("dock.tab.console").click();
    await expect(page.getByTestId("dock.tab.console")).toHaveClass(/active/);
    await page.getByTestId("dock.tab.graph").click();
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
  });

  await test.step("script tab decompiles the real graph to visible, multi-line TypeScript", async () => {
    await page.getByTestId("dock.tab.script").click();
    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    await expect(page.getByTestId("script.panel")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 30_000 })
      .toContain("rt.onTick(");
    const code = await page.evaluate(() => window.__gltfStudioScriptTest!.getCode());
    expect(code).toContain("createEngine");
    expect(code).toContain("rt.onSelect(");
    expect(code).toContain("rt.setDelay(");
    await assertRegionSpansMultipleLines(page.getByTestId("script.panel"));
  });

  await test.step("play (interpreter): countdown->racing transition and onTick activity observable; steer pad click updates state; stop restores", async () => {
    test.slow();
    // Frame the camera on PadLeft via the real "Frame selected" affordance
    // (Viewport.tsx's onFrameSelected -> RenderHost.frameNode ->
    // frame-camera.ts's frameCameraOnObject, an angled `camera.lookAt(center)`
    // on the node's bounding-sphere center) BEFORE entering play mode — edit
    // affordances including this button are disabled once playing (UX-113),
    // and play mode does not itself reset the camera (only Stop does, per
    // golden-path.spec.ts's own comment on that exact mechanism) — so the
    // framing set up here persists into the click below. Reusing this real,
    // already-exercised mechanism instead of hand-picking a camera pose
    // avoids a bespoke, geometry-fragile NDC calculation of PadLeft's screen
    // position.
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.PAD_LEFT}`).click();
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PAD_LEFT}`)).toHaveClass(/selected/);
    await page.getByTestId("viewport.camera-frame").click();

    await expect(page.getByTestId("playbar.engine-picker")).toHaveValue("interpreter");
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");
    await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();

    // V.state starts at 0 ("countdown") — src/game.template.ts's onStart (in
    // the sibling gltf-interactivity-game repo) chains three ~1s delays
    // (TN_COUNTDOWN / 3 each, TN_COUNTDOWN = 3.0) before flipping to 1
    // ("racing"). Observing that transition is the "race countdown ...
    // observable" half of this step.
    const stateRow = page.getByTestId("viewport.play-overlay.variable.state");
    expect(await readVal(stateRow)).toBe("0");
    await expect.poll(() => readVal(stateRow), { timeout: 6000 }).toBe("1");

    // Once racing, onTick continuously advances raceT every tick — the
    // "... onTick activity observable" half.
    const raceTRow = page.getByTestId("viewport.play-overlay.variable.raceT");
    const baseRaceT = parseFloat(await readVal(raceTRow));
    await page.waitForTimeout(400);
    await expect.poll(async () => parseFloat(await readVal(raceTRow))).toBeGreaterThan(baseRaceT);

    // Click PadLeft (framed dead-center above) — routes to the running
    // engine's fireSelect (PC-008), firing R4's real onSelect handler, which
    // clamps V.steer away from 0.
    const steerRow = page.getByTestId("viewport.play-overlay.variable.steer");
    expect(await readVal(steerRow)).toBe("0");
    const mount = page.getByTestId("viewport.mount");
    const box = (await mount.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => readVal(steerRow), { timeout: 3000 }).not.toBe("0");

    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
    await expect(page.getByTestId("viewport.play-overlay")).toHaveCount(0);
    // Stop restores the pre-play document — normal editor selection works again.
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.PAD_LEFT}`).click();
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PAD_LEFT}`)).toHaveClass(/selected/);
  });
});
