import { PNG } from "pngjs";
import { test, expect, type Page, type Locator, type CDPSession } from "@playwright/test";
import { validateGraph, type VGraph } from "@gltfi/verify";
import { assertRegionRendersContent, assertRegionSpansMultipleLines, assertRegionsVisuallyDiffer } from "./visual-assert.js";
import { waitForNodesSettled } from "./graph-canvas-test-helpers.js";

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

/**
 * specs/ux-scene-tree.md UX-215 (DOC-052): a real mouse-driven
 * `locator.dragTo()` (as `e2e/scene-tree-reparent-duplicate.spec.ts` uses
 * against its small 4-node fixture) is unreliable here — the scene tree at
 * R4 Racer's real 26+-row scale is taller than the panel, so source and
 * target rows generally aren't simultaneously visible, and Playwright
 * scrolling the target into view mid-drag can shift the SOURCE out from
 * under the already-computed drag-start position, landing the drop on
 * whatever row ends up under the cursor after the scroll rather than the
 * intended target (reproduced while stabilizing this file: a drag "from
 * Pylon00 to a far-away row" silently reparented PadLeft instead). Dispatches
 * synthetic `dragover`/`drop` `Event`s with a hand-built `DataTransfer`-like
 * object directly at the target row instead — the same
 * `Object.defineProperty(event, "dataTransfer", ...)` technique
 * `e2e/folder-drop.spec.ts` already established for a real-OS-drag that
 * Playwright can't script — so the drop always lands exactly on the
 * intended target regardless of scroll position, with no scrolling
 * involved at all.
 */
async function simulateSceneNodeDrop(page: Page, sourceNodeIndex: number, targetTestId: string): Promise<void> {
  await page.evaluate(
    ({ sourceNodeIndex, targetTestId, mime }) => {
      const target = document.querySelector(`[data-testid="${targetTestId}"]`);
      if (!target) throw new Error(`drop target "${targetTestId}" not found`);
      const store = new Map<string, string>();
      const fakeDataTransfer = {
        types: [mime, "text/plain"],
        dropEffect: "move",
        effectAllowed: "copyMove",
        setData(type: string, value: string) {
          store.set(type, value);
        },
        getData(type: string) {
          return store.get(type) ?? "";
        }
      };
      fakeDataTransfer.setData(mime, String(sourceNodeIndex));
      fakeDataTransfer.setData("text/plain", String(sourceNodeIndex));
      const dragOverEvt = new Event("dragover", { bubbles: true, cancelable: true });
      Object.defineProperty(dragOverEvt, "dataTransfer", { value: fakeDataTransfer });
      target.dispatchEvent(dragOverEvt);
      const dropEvt = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvt, "dataTransfer", { value: fakeDataTransfer });
      target.dispatchEvent(dropEvt);
    },
    { sourceNodeIndex, targetTestId, mime: "application/x-scenenode" }
  );
}

async function loadRacer(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.getByTestId("viewport.gallery")).toBeVisible();
  await expect(page.getByTestId("viewport.gallery.card.racer")).toBeVisible();
  await page.getByTestId("viewport.gallery.card.racer.load").click();
  await expect(page.getByTestId("topbar.project-name")).toHaveText("r4-racer");
}

test.describe.configure({ mode: "serial" });

test("R4 Racer: gallery load, scene/graph/script at real scale, and play-mode pad interaction", async ({ page, context }) => {
  test.slow();
  test.setTimeout(180_000); // bumped for the compiled-engine double-click/breakpoint/CDP step below, on top of the graph-canvas step's own already-measured number

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
    // Bug-fix note (deflake, see e2e/graph-canvas-test-helpers.ts's own doc
    // comment): reaching a count of 366 rendered node ELEMENTS doesn't mean
    // their bounding boxes are at final, measured size yet — same node-
    // click/resize race e2e/graph-canvas.spec.ts's own `waitForNodesSettled`
    // guards against (task #33), just with a much longer settle tail here
    // given the scale — same 30s budget as the count-poll just above, for
    // the same "worker-contention, not raw compute time" reason that
    // comment gives. The later target-chip click below depends on this.
    await waitForNodesSettled(page, "__gltfStudioGraphCanvasTest", 30_000);
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

  await test.step("handler node target chip resolves PadLeft's real name (UX-512); chip click selects it; the details editor can retarget it, undoably (UX-513)", async () => {
    // Reach PadLeft's real event/onSelect|onHoverIn|onHoverOut graph node the
    // same way a user would — via the Inspector's existing "Used in
    // behavior" → Graph jump (UX-1107), already proven above to land on one
    // of the three handler nodes addressing PadLeft (node 17). No hardcoded
    // graph-node index: whichever one it is, `.gcanvas-op-node-selected` is
    // the single, real selected card.
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.PAD_LEFT}`).click();
    await expect(page.getByTestId("inspector.usage.row.0")).toContainText("nodeIndex: 17");
    await page.getByTestId("inspector.usage.row.0.to-graph").click();
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);

    const selectedCard = page.locator(".gcanvas-op-node-selected");
    await expect(selectedCard).toBeVisible({ timeout: 15000 });
    const graphNodeIndex = await selectedCard.getAttribute("data-testid").then((v) => v!.replace("gcanvas.node.", ""));

    const targetChip = page.getByTestId(`gcanvas.target-chip.${graphNodeIndex}`);
    await expect(targetChip).toContainText("PadLeft");
    await expect(targetChip).toContainText("(#17)");
    // Visual-assert (this task's coverage requirement): the config region
    // actually renders real pixels, not just DOM text a hidden-mount bug
    // could still satisfy (this file's own established pattern, e.g. the
    // script-jump decoration check above).
    await assertRegionRendersContent(page.getByTestId(`gcanvas.op-target-row.${graphNodeIndex}`), { minNonBackgroundPixels: 20, minNonBackgroundFraction: 0.02 });

    // Chip click selects the scene node directly (complementary to the
    // existing amber reference highlight, which never left) — proven by
    // first moving the scene-tree selection elsewhere.
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.PYLON}`).click();
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PYLON}`)).toHaveClass(/selected/);
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PAD_LEFT}`)).not.toHaveClass(/selected/);

    await targetChip.click();
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PAD_LEFT}`)).toHaveClass(/selected/);
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.PYLON}`)).not.toHaveClass(/selected/);

    // Editable attachment: the node-details "Target node" selector retargets
    // this SAME handler node to Pylon00 (#3) — the card updates immediately,
    // and the change is a normal undoable command.
    const targetSelect = page.getByTestId(`gcanvas.details.config.target-select.${graphNodeIndex}`);
    await targetSelect.selectOption(String(SCENE_NODE.PYLON));
    await expect(targetChip).toContainText("Pylon00");
    await expect(targetChip).toContainText("(#3)");

    await page.getByTestId("topbar.undo").click();
    await expect(targetChip).toContainText("PadLeft");
    await expect(targetChip).toContainText("(#17)");
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

  await test.step("play (compiled): a fast double-click on Play cannot orphan a second engine (user-reported bug regression — Pause/Stop 'didn't work' and the car 'kept moving' after Stop/an engine switch), a mid-play breakpoint toasts instead of silently doing nothing, and a real DevTools breakpoint still pauses the racer's own onTick at the next session (specs/ux-shell.md's play-lifecycle follow-up note, specs/ux-debugger.md UX-1505/UX-1508)", async () => {
    test.slow();

    await page.getByTestId("playbar.engine-picker").selectOption("compiled");
    await expect(page.getByTestId("playbar.engine-picker")).toHaveValue("compiled");

    // The user's own repro trigger: two Play clicks with no gap between them
    // (a real impatient double-click). Before the fix, this asset's
    // multi-hundred-node compiled build (importGraph/checkModule/emit-ts/
    // esbuild-wasm) is slow enough, in a real browser, that the second click
    // reliably lands inside `startPlay()`'s async construction window and
    // builds a SECOND engine host — the loser of that race never gets
    // tracked by `activePlayController`, so nothing ever calls pause()/
    // stop() on it again and its own tick loop runs forever, fighting the
    // tracked engine over the same renderHost. `playStarting` (this fix)
    // closes that window; if it regresses, this double-click reproduces the
    // exact orphan below (the screenshot-stability check after Stop).
    const playBtn = page.getByTestId("playbar.play");
    await Promise.all([playBtn.click(), playBtn.click().catch(() => {})]);

    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");
    await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();
    // Play/engine-picker/Debug-toggle are disabled for the ENTIRE window (the
    // async `playStarting` gap the fix adds, not just the eventual "really
    // playing" state) — asserted now, once already playing, as a floor: if
    // `playStarting` regressed to a no-op, the SECOND click above would have
    // gone on to build a second engine exactly as it used to.
    await expect(page.getByTestId("playbar.play")).toBeDisabled();
    await expect(page.getByTestId("playbar.engine-picker")).toBeDisabled();
    await expect(page.getByTestId("playbar.debug-toggle")).toBeDisabled();

    const stateRow = page.getByTestId("viewport.play-overlay.variable.state");
    await expect.poll(() => readVal(stateRow), { timeout: 6000 }).toBe("1"); // countdown -> racing
    const raceTRow = page.getByTestId("viewport.play-overlay.variable.raceT");
    const baseRaceT = parseFloat(await readVal(raceTRow));
    await page.waitForTimeout(400);
    await expect.poll(async () => parseFloat(await readVal(raceTRow))).toBeGreaterThan(baseRaceT); // exactly one engine ticking, not two racing each other

    // Mid-play breakpoint discoverability fix: setting a breakpoint on the
    // running session's own graph (0) used to give NO feedback beyond an
    // easy-to-miss gutter dot. `toggleBreakpointAtLine` is the exact code
    // path a real glyph-margin click uses (same precedent as
    // e2e/debugger.spec.ts's own "real click" tests), on the onTick
    // handler's own emitted line so the SAME breakpoint is ready to actually
    // fire once a debug session restarts below.
    await page.getByTestId("dock.tab.script").click();
    await expect(page.getByTestId("script.panel")).toBeVisible();
    const scriptText = await page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? "");
    const onTickLine = scriptText.split("\n").findIndex((l) => l.includes("rt.onTick(")) + 1; // 1-based
    expect(onTickLine).toBeGreaterThan(0);
    await page.evaluate((line) => window.__gltfStudioScriptTest!.toggleBreakpointAtLine(line), onTickLine);
    await expect(page.getByTestId("toast")).toContainText("won't hit this session");

    // Pause: the overlay's own values genuinely freeze (not just the UI banner).
    await page.getByTestId("playbar.pause").click();
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "paused");
    const pausedRaceT = await readVal(raceTRow);
    await page.waitForTimeout(500);
    expect(await readVal(raceTRow)).toBe(pausedRaceT);

    // Stop: restores the pre-play scene, re-enables the controls, AND —
    // the direct regression check for the reported bug — leaves the
    // viewport genuinely idle afterward. Before the fix, an orphaned second
    // engine (from the double-click above) would keep fanning pointer
    // writes into the SAME renderHost after Stop, so the "restored" scene
    // would visibly keep drifting frame to frame even though every control
    // correctly reported "stopped".
    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
    await expect(page.getByTestId("viewport.play-overlay")).toHaveCount(0);
    await expect(page.getByTestId("playbar.engine-picker")).toBeEnabled();
    await expect(page.getByTestId("playbar.play")).toBeEnabled();

    const mount = page.getByTestId("viewport.mount");
    await page.waitForTimeout(200); // let the restore's own re-frame/reload settle before baselining
    const shots: Buffer[] = [];
    for (let i = 0; i < 4; i++) {
      shots.push(await mount.screenshot());
      await page.waitForTimeout(400);
    }
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].equals(shots[0]), `viewport pixels changed ${i * 400}ms after Stop — an orphaned engine is still writing to the restored scene`).toBe(true);
    }

    // Real DevTools debugging, end to end, at this asset's real scale: Debug
    // on, restart Play, attach a real CDP session, and prove the breakpoint
    // set above (still pending — UX-1505's "next start only" rule) actually
    // pauses the racer's own onTick this time. No `Debugger.setBreakpointByUrl`
    // call anywhere here — if a pause arrives, it can only be the injected
    // `debugger;` statement firing natively.
    await page.getByTestId("playbar.debug-toggle").click();
    await expect(page.getByTestId("playbar.debug-toggle")).toHaveClass(/active/);

    const cdp: CDPSession = await context.newCDPSession(page);
    await cdp.send("Debugger.enable");
    const pausedEvents: unknown[] = [];
    cdp.on("Debugger.paused", (event) => pausedEvents.push(event));

    await page.getByTestId("playbar.play").click();
    await expect.poll(() => pausedEvents.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await cdp.send("Debugger.resume");
    await cdp.detach().catch(() => {});

    await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();
    await expect(page.getByTestId("viewport.play-overlay.debug-hint.breakpoints")).toHaveText("1 breakpoint set for this session");
    // The engine really resumed (not just the CDP event delivered with no
    // effect): raceT keeps advancing after the debugger resume above.
    const resumedBase = parseFloat(await readVal(raceTRow));
    await expect.poll(async () => parseFloat(await readVal(raceTRow)), { timeout: 5000 }).toBeGreaterThan(resumedBase);

    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
    // Leave the store clean for the remaining steps below: remove the
    // breakpoint this step added (else every subsequent Play click under the
    // interpreter engine would re-toast UX-1508's own "switch to compiled"
    // message), untoggle Debug, and restore the picker to its original
    // pre-step default.
    await page.evaluate((line) => window.__gltfStudioScriptTest!.toggleBreakpointAtLine(line), onTickLine);
    await page.getByTestId("playbar.debug-toggle").click();
    await expect(page.getByTestId("playbar.engine-picker")).toBeEnabled();
    await page.getByTestId("playbar.engine-picker").selectOption("interpreter");
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

  await test.step("DOC-052/DOC-053 stress case: reparenting a checkpoint pylon under a brand-new Empty Group, at real scale, leaves the 366-node graph completely untouched (reparenting/duplicating never fix up ANY reference, DOC-054) and PLAY still works exactly as before", async () => {
    // Empty Group lands as a NEW scene-root node (no selection active) —
    // node/row 26 (25 pre-existing nodes survive the previous step's
    // delete+undo, back to the original 26; this is the 27th).
    await page.getByTestId("scene-tree.add").click();
    await page.getByTestId("scene-tree.add-menu.group").click();
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest?.isReady() === true)).toBe(true);
    await page.getByTestId("scene-tree.row.26.rename-input").press("Escape");
    await expect(page.getByTestId("scene-tree.row.26")).toContainText("Empty Group");

    // Drag Pylon00 (node 3) onto the new Group (row 26) — via
    // `simulateSceneNodeDrop` (this file's own header comment on why a real
    // `dragTo()` isn't reliable at this list's real scrollable-list scale).
    await simulateSceneNodeDrop(page, SCENE_NODE.PYLON, "scene-tree.row.26");
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest?.isReady() === true)).toBe(true);

    const afterReparent = (await page.evaluate(() => window.__gltfStudioDocumentTest?.getJson())) as {
      nodes: Array<{ children?: number[] }>;
      scenes: Array<{ nodes: number[] }>;
      extensions?: { KHR_interactivity?: { graphs: Array<{ nodes: unknown[] }> } };
    };
    expect(afterReparent.nodes).toHaveLength(27); // reparenting never changes the node COUNT.
    expect(afterReparent.nodes[26].children).toEqual([SCENE_NODE.PYLON]); // Group gained Pylon00.
    expect(afterReparent.scenes[0].nodes).not.toContain(SCENE_NODE.PYLON); // no longer a scene-root entry.
    // The 366-node graph itself is untouched — no fixup pass runs for a
    // reparent (DOC-054): still the same node count, still valid.
    const graph = afterReparent.extensions!.KHR_interactivity!.graphs[0];
    expect(graph.nodes).toHaveLength(366);
    expect(validateGraph(graph as unknown as VGraph).ok).toBe(true);

    // Play still genuinely works: PadLeft's real onSelect handler still
    // fires at its own (entirely unrelated, never-touched) index — the
    // scenery-only pylon move has no way to affect it, but this proves that
    // empirically rather than by inference.
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

    // Undo the reparent (leaves the Group node itself in place — that was a
    // separate command) restores Pylon00 to the scene root.
    await page.getByTestId("topbar.undo").click();
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest?.isReady() === true)).toBe(true);
    const undone = (await page.evaluate(() => window.__gltfStudioDocumentTest?.getJson())) as {
      scenes: Array<{ nodes: number[] }>;
    };
    expect(undone.scenes[0].nodes).toContain(SCENE_NODE.PYLON);
  });
});
