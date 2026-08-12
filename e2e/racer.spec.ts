import { PNG } from "pngjs";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { validateGraph, type VGraph } from "@gltfi/verify";
import { assertRegionRendersContent, assertRegionSpansMultipleLines, assertRegionsVisuallyDiffer } from "./visual-assert.js";

/**
 * R4 Racer (specs/ux-shell.md UX-120's second starter-gallery card,
 * unchanged from that requirement's now-retired predecessor,
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
 *
 * Also covers the EDIT-mode pick-eligibility bug fix (specs/ux-viewport.md
 * UX-312, specs/render-host.md RH-027): the scenery nodes (Ground,
 * TrackRing, StartLine, Pylon00..11, Car, RivalCar) all carry
 * `KHR_node_selectability`'s `selectable: false` so they're non-interactive
 * during PLAY, which used to also make them unclickable in EDIT mode —
 * Pylon00 (node 3) is used below to prove a real viewport click/hover still
 * selects/highlights it while editing, and that PLAY mode's own pick gate is
 * unchanged.
 */

const SCENE_NODE = { PAD_LEFT: 17, PYLON: 3, CAR: 15 } as const;

type Point = { x: number; y: number };

/**
 * Finds a pixel matching `ThreeRenderHost`'s `scene.background` clear color
 * (`0x11141a`, `packages/engine-three/src/render-host.ts`) in the mounted
 * canvas's current screenshot — genuinely empty space with no geometry at
 * all under it. Needed instead of `e2e/viewport-real-click.spec.ts`'s own
 * fixed-corner `emptyCorner()` helper because R4 Racer's Ground plane is
 * large enough that even a tight `frameNode`-style close-up on one small
 * pylon still has geometry filling most corners of the frame — only a thin
 * sky-line strip is guaranteed clear-color background, and its position
 * shifts with camera framing, so it has to be found by scanning real
 * pixels, the same technique `reddishClusters` uses in that other file.
 */
async function findBackgroundPixel(mount: Locator): Promise<Point> {
  const box = (await mount.boundingBox())!;
  const buffer = await mount.screenshot();
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.abs(r - 0x11) <= 6 && Math.abs(g - 0x14) <= 6 && Math.abs(b - 0x1a) <= 6) {
        return { x: box.x + x, y: box.y + y };
      }
    }
  }
  throw new Error("expected at least one clear-color background pixel in the framed viewport");
}

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

  await test.step("load R4 Racer from the starter gallery (UX-120)", async () => {
    await loadRacer(page);
  });

  await test.step("scene tree is populated with the asset's real 26 flat nodes", async () => {
    const rows = page.getByTestId("scene-tree.list").locator(".tree-row");
    await expect(rows).toHaveCount(26);
    await expect(page.getByTestId("scene-tree.row.0")).toContainText("Ground");
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PAD_LEFT}`)).toContainText("PadLeft");
  });

  await test.step("Inspector 'Used in behavior' populates for PadLeft against the real 366-node graph, within budget (UX-1106/UX-1113)", async () => {
    const start = Date.now();
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.PAD_LEFT}`).click();
    // PadLeft (node 17) is addressed by exactly three real graph nodes in
    // this asset (dumped from samples/r4-racer.glb's own GLB JSON chunk,
    // not guessed): one event/onSelect and one event/onHoverIn/onHoverOut
    // pair, each configured with `nodeIndex: 17`.
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (3)");
    await expect(page.getByTestId("inspector.usage.row.0")).toContainText("nodeIndex: 17");
    const elapsedMs = Date.now() - start;
    console.log(`[racer.spec] usage-mapping Inspector section for a real 366-node graph resolved in ${elapsedMs}ms`);
    // Generous (this is UI click-to-assert wall time, not the pure
    // buildUsageIndex() call packages/usage-index's own unit test measures
    // in isolation at well under 1ms) — same "wide headroom on a possibly
    // saturated CI runner" rationale as this file's other timing budgets.
    expect(elapsedMs).toBeLessThan(5_000);
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

  await test.step("→ Script jump on a pointer/set usage row resolves against the real 366-node graph's decompile (specs/ux-usage-mapping.md UX-1108, the pointer/* row family cross-highlight.ts's sourceNodeIds table alone can't resolve — see the pointerPath fallback)", async () => {
    // Car (node 15) is driven by two real pointer/set nodes in this asset
    // (dumped from samples/r4-racer.glb's own GLB JSON chunk, not guessed):
    // graph node 316 sets /nodes/15/translation, 317 sets /nodes/15/rotation
    // — neither gets a `sourceNodeIds` entry (they're plain inlined
    // statements, not a handler/proc/stateSlot/temp), so this only resolves
    // via the pointer-path text-search fallback this fix adds.
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.CAR}`).click();
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.CAR}`)).toHaveClass(/selected/);
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior");
    const row = page.getByTestId("inspector.usage.row.0");
    await expect(row).toContainText("pointer/set");
    await expect(row).toContainText("/nodes/15/translation");
    const toScript = page.getByTestId("inspector.usage.row.0.to-script");
    await expect(toScript).toBeEnabled(); // reachable from onTick — not the disabled/orphaned case
    await toScript.click();

    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    // The Script tab was already opened once by the previous step (a WARM
    // re-jump, exercising the same durable focus-request effect's already-
    // ready branch against a genuinely large emitted document, where a
    // naive "scroll to the top" or "select nothing" bug would be easy to
    // miss on a small fixture but obvious here).
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getSelectedText() ?? null), { timeout: 15_000 })
      .toContain("/nodes/15/translation");

    // specs/ux-script.md UX-712/UX-1108 (refined "character-precise,
    // visibly-decorated script jump"): the API-level assertion above is
    // exactly the kind that passed on the ORIGINAL (buggy) implementation
    // too — this bug report's whole finding was that a real user saw
    // nothing despite it. At this asset's real 366-node scale (hundreds of
    // emitted lines, well beyond a small fixture's single screenful) a
    // "reveal did nothing"/"decoration didn't survive a real editor mount"
    // regression would be easy to miss without a genuine pixel check too.
    const line = await page.evaluate(() => window.__gltfStudioScriptTest?.getJumpHighlightLineNumber() ?? null);
    expect(line, "expected a jump-highlight decoration line once the → Script jump landed, even at this asset's real scale").not.toBeNull();
    const lineRect = await page.evaluate((l) => window.__gltfStudioScriptTest!.getLineScreenRect(l!), line);
    const baselineRect = await page.evaluate(() => window.__gltfStudioScriptTest!.getLineScreenRect(1));
    if (!lineRect || !baselineRect) throw new Error("getLineScreenRect returned null for a line the Script tab just reported as rendered");
    const [decoratedShot, baselineShot] = await Promise.all([
      page.screenshot({ clip: { x: lineRect.left, y: lineRect.top, width: lineRect.width, height: lineRect.height } }),
      page.screenshot({ clip: { x: baselineRect.left, y: baselineRect.top, width: baselineRect.width, height: baselineRect.height } })
    ]);
    await assertRegionsVisuallyDiffer(decoratedShot, baselineShot);
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

  await test.step("EDIT mode: clicking a checkpoint pylon (KHR_node_selectability selectable:false) selects it via a real viewport click, and hovering it shows the hover affordance (bug fix regression, specs/ux-viewport.md UX-312 / specs/render-host.md RH-027)", async () => {
    // Frame Pylon00 the same way the play-mode step above framed PadLeft —
    // by now playState is back to "stopped" (Stop above restored editor
    // mode), so this scene-tree-select + camera-frame affordance is enabled.
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.PYLON}`).click();
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PYLON}`)).toHaveClass(/selected/);
    await page.getByTestId("viewport.camera-frame").click();

    const mount = page.getByTestId("viewport.mount");
    const box = (await mount.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // R4 Racer's Ground plane is large enough that even this tight
    // close-up on one small pylon still has geometry filling most of the
    // frame (unlike e2e/viewport-real-click.spec.ts's isolated fixtures) —
    // find a real empty (clear-color background) pixel instead of assuming
    // a fixed corner is clear. With the fix, EDIT mode can now also select
    // Ground itself (any visible node is eligible), so a click on Ground
    // would just move the selection to Ground, not prove a clean deselect.
    const empty = await findBackgroundPixel(mount);

    // Clear the scene-tree-driven selection via a real empty-space click
    // (UX-303) so the click below is a genuine reselect of the pylon, not a
    // no-op against a selection that was already there.
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PYLON}`)).not.toHaveClass(/selected/);
    await expect(page.getByTestId("inspector.empty")).toBeVisible();

    // Before the fix, this real click would have missed (ThreeRenderHost.pick()
    // required KHR_node_selectability's selectable:true, which Pylon00 lacks).
    await page.mouse.click(cx, cy);
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PYLON}`)).toHaveClass(/selected/);
    await expect(page.getByTestId("inspector.identity")).toContainText(`Node #${SCENE_NODE.PYLON}`);

    // Hover: move off, then onto, the pylon; hover-pickable should engage.
    await page.mouse.move(empty.x, empty.y);
    await expect(mount).not.toHaveClass(/hover-pickable/);
    await page.mouse.move(cx, cy);
    await expect(mount).toHaveClass(/hover-pickable/);
  });

  await test.step("PLAY mode: a checkpoint pylon stays non-interactive (KHR_node_selectability selectable:false is still honored — the fix must not regress PLAY-mode eligibility)", async () => {
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");
    // Camera is still framed on the pylon from the previous step (Stop is
    // the only thing that resets the camera, per this file's own comment on
    // PadLeft's identical technique above).
    const playPick = await page.evaluate(() => window.__gltfStudioTest?.pick(0, 0) ?? null);
    expect(playPick).toBeNull(); // default (PLAY-mode) eligibility still excludes the pylon.
    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
  });

  await test.step("DOC-048 stress case: deleting a checkpoint pylon (referenced by nothing) at real scale shifts every one of the 366-node graph's node-index references correctly (pointer literals AND event/onSelect's configuration.nodeIndex); undo fully restores the document, and play works exactly as before afterward", async () => {
    // Pylon00 (node 3) is scenery only — no graph node addresses it, so its
    // OWN removal never needs the dangling-reference policy exercised here;
    // this step is about every OTHER node's index shifting correctly at a
    // scale (366 graph nodes) no unit test reasonably reproduces, including
    // PadLeft's (17 -> 16) event/onSelect `configuration.nodeIndex` literal
    // and Car's (15 -> 14) pointer/set `configuration.pointer` literals
    // (both already selected/asserted earlier in this file at their ORIGINAL
    // indices).
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.PYLON}`).click({ button: "right" });
    await expect(page.getByTestId("scene-tree.context-menu.delete")).toBeVisible();
    await page.getByTestId("scene-tree.context-menu.delete").click();
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest?.isReady() === true)).toBe(true);

    const afterDelete = (await page.evaluate(() => window.__gltfStudioDocumentTest?.getJson())) as {
      nodes: unknown[];
      extensions?: { KHR_interactivity?: { graphs: Array<{ nodes: unknown[] }> } };
    };
    expect(afterDelete.nodes).toHaveLength(25); // 26 -> 25
    const graph = afterDelete.extensions!.KHR_interactivity!.graphs[0];
    expect(graph.nodes).toHaveLength(366); // scene-node deletion never touches the graph's OWN node count
    expect(validateGraph(graph as unknown as VGraph).ok).toBe(true);

    // Undo restores the pylon (and every shifted reference) exactly.
    await page.getByTestId("topbar.undo").click();
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest?.isReady() === true)).toBe(true);
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PYLON}`)).toBeVisible();
    const restored = (await page.evaluate(() => window.__gltfStudioDocumentTest?.getJson())) as { nodes: unknown[] };
    expect(restored.nodes).toHaveLength(26);

    // Play still genuinely works post-restore: PadLeft's real onSelect
    // handler still fires at its restored original index (17) — the same
    // interaction this file's own "play (interpreter)" step above already
    // proved once; re-proving it here specifically guards against a
    // delete+undo cycle leaving some STALE shifted reference behind despite
    // the document otherwise looking restored.
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.PAD_LEFT}`).click();
    await page.getByTestId("viewport.camera-frame").click();
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");

    const steerRow = page.getByTestId("viewport.play-overlay.variable.steer");
    const mount = page.getByTestId("viewport.mount");
    const box = (await mount.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => readVal(steerRow), { timeout: 3000 }).not.toBe("0");

    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
  });
});
