import { test, expect, type Page, type Locator } from "@playwright/test";
import { FIXTURE_PLAY_GLB_PATH, FIXTURE_FRONT_CAMERA_POSE } from "./global-setup.js";

/**
 * M6 Play Mode e2e coverage: `PlayController`'s full lifecycle
 * (specs/engine-api.md PC-001..PC-008), the document freeze it drives
 * (specs/document-model.md DOC-031/DOC-037/DOC-045), and the shell/viewport
 * chrome that makes it visible (specs/ux-shell.md UX-106/UX-107/UX-113,
 * specs/ux-viewport.md UX-309/UX-310/UX-311).
 *
 * Fixture: `FIXTURE_PLAY_GLB_PATH` (e2e/global-setup.ts's `PLAY_GRAPH`) is
 * the SAME base scene e2e/viewport.spec.ts uses (node 1 "Widget" dead center
 * under `FIXTURE_FRONT_CAMERA_POSE`), but with a real, runnable
 * KHR_interactivity graph instead of the inert editor-only one: an
 * `event/onTick` handler increments the `counter` variable every tick, and
 * an `event/onSelect` handler scoped to node 1 sets `counter` to 100 and
 * moves node 1's translation to `[0.5, 0, 0]` via `pointer/set` — enough
 * distinct, observable behavior to prove the interpreter/compiled engine is
 * really ticking and that a viewport click while playing really routes into
 * the graph (PC-008), not editor selection.
 *
 * `window.__gltfStudioTest` (Viewport.tsx) and `window.__gltfStudioDocumentTest`
 * (App.tsx) are the same test-only seams e2e/viewport.spec.ts and
 * e2e/export.spec.ts already use — no new hook was added for this file.
 *
 * Known coverage gap (by design, not an oversight): `PlayController.tickOnce`
 * (PC's fixed-step single-tick advance while paused) has no UI control wired
 * up anywhere in TopBar.tsx as shipped for M6 — nothing in the app calls the
 * store's `tickOncePlay()` action. There is therefore no UI path to exercise
 * it through Playwright; `packages/play`'s own `play-controller.test.ts` and
 * `packages/contract-tests` already cover `tickOnce` at the unit/contract
 * level. Inventing a UI control here just to make it e2e-testable would be
 * out of scope for an e2e-authoring task, so it is deliberately not asserted
 * below.
 */

async function importPlayFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_PLAY_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("play-scene");
}

/** Same pattern as e2e/viewport.spec.ts's `setFrontCamera` — see that file's doc comment for why `isReady()` is awaited first. */
async function setFrontCamera(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
  await page.evaluate((pose) => window.__gltfStudioTest!.setCameraPose(pose), FIXTURE_FRONT_CAMERA_POSE);
}

/** Reads the numeric value out of a `viewport.play-overlay.*` row's `.val` span (the row's own textContent would otherwise concatenate its label and value). */
async function readVal(row: Locator): Promise<number> {
  const text = await row.locator(".val").textContent();
  return parseFloat(text ?? "0");
}

interface PlayLifecycleHooks {
  /** Runs right after Play starts (locked banner + overlay visible), before the tick/click-select assertions. */
  afterStart?: () => Promise<void>;
  /** Runs right after Pause (locked banner shows the paused message), before the freeze assertions. */
  afterPause?: () => Promise<void>;
  /** Runs after Stop and the render-restore click, at the very end. */
  afterStop?: () => Promise<void>;
}

/**
 * Shared core of the play-mode lifecycle, parameterized by `engine` so the
 * interpreter and compiled tests below don't duplicate the whole scenario
 * (per PC-008's own note that pointer/click routing is identical across both
 * engine kinds, this is exactly the interpreter/compiled parity check):
 * select the engine, Play, prove the tick loop is really running (the
 * `counter` overlay value increases — PC-001/PC-004), prove a viewport click
 * while playing routes into the graph's `onSelect` handler instead of editor
 * selection (`counter` jumps to >=100 — PC-008), prove the document itself
 * is never mutated (DOC-031), Pause (freeze — UX-310), Resume from the same
 * point (UX-311), Stop (restores the pre-play render — PC-003/PC-006/PC-007,
 * unfreezes — DOC-031/DOC-045).
 */
async function runPlayLifecycle(page: Page, engine: "interpreter" | "compiled", hooks: PlayLifecycleHooks = {}): Promise<void> {
  if (engine === "compiled") {
    await page.getByTestId("playbar.engine-picker").selectOption("compiled");
  }
  // PC-001: the engine-picker defaults to "interpreter" (asserted for real by the interpreter test, which calls this with no prior selectOption).
  await expect(page.getByTestId("playbar.engine-picker")).toHaveValue(engine);

  await page.getByTestId("playbar.play").click();
  await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");
  await expect(page.getByTestId("locked-banner")).toHaveText("Document locked while playing — Stop to edit.");
  await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();

  await hooks.afterStart?.();

  // PC-001/PC-004: the interpreter/compiled engine is really ticking — the counter overlay value increases over real time.
  const counterRow = page.getByTestId("viewport.play-overlay.variable.counter");
  const baseCounter = await readVal(counterRow);
  await page.waitForTimeout(400);
  await expect.poll(() => readVal(counterRow)).toBeGreaterThan(baseCounter);

  // PC-008: a viewport click while playing routes to the running engine's fireSelect instead of editor
  // selection — the graph's onSelect handler (scoped to node 1, "Widget", dead center under the fixed
  // camera pose) fires, sets `counter` to 100, then moves node 1 via pointer/set.
  const mount = page.getByTestId("viewport.mount");
  const box = (await mount.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => readVal(counterRow), { timeout: 5000 }).toBeGreaterThanOrEqual(100);

  // PC-001/DOC-031: play mode drove all of the above purely through the fan-out (renderHost.applyPointer) —
  // the authored document itself was never mutated, even by the onSelect handler's own pointer/set.
  const liveJson = (await page.evaluate(() => window.__gltfStudioDocumentTest!.getJson())) as {
    nodes: Array<{ translation?: number[] }>;
  };
  expect(liveJson.nodes[1]?.translation ?? [0, 0, 0]).toEqual([0, 0, 0]);

  // UX-310: Pause suspends the running simulation without discarding its current variable values.
  await page.getByTestId("playbar.pause").click();
  await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "paused");
  await expect(page.getByTestId("locked-banner")).toHaveText("Playback paused — Stop to edit.");

  await hooks.afterPause?.();

  // UX-310/UX-311: while paused, the overlay's time/counter stop changing entirely.
  const timeRow = page.getByTestId("viewport.play-overlay.time");
  const pausedCounter = await readVal(counterRow);
  const pausedTime = await readVal(timeRow);
  await page.waitForTimeout(350);
  expect(await readVal(counterRow)).toBe(pausedCounter);
  expect(await readVal(timeRow)).toBe(pausedTime);

  // UX-311: Play (acting as Resume while paused) continues from the same point — never resets near 0.
  await page.getByTestId("playbar.play").click();
  await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");
  await expect(page.getByTestId("locked-banner")).toHaveText("Document locked while playing — Stop to edit.");
  await expect.poll(() => readVal(counterRow), { timeout: 3000 }).toBeGreaterThan(pausedCounter);

  // PC-003/PC-006/PC-007: Stop ends play mode, restoring the pre-play scene snapshot and unfreezing the document.
  await page.getByTestId("playbar.stop").click();
  await expect(page.getByTestId("locked-banner")).toHaveCount(0);
  await expect(page.getByTestId("viewport.play-overlay")).toHaveCount(0);

  // `stop()`'s restore goes through `RenderHost.loadScene()` (PC-007), which — like any fresh scene
  // load (see e2e/viewport.spec.ts's own "Frame selected" test) — reframes the camera on the whole
  // reloaded scene; re-pin the deterministic front pose before relying on dead-center-click NDC math.
  await setFrontCamera(page);

  // The RENDER is really restored (the document itself was never touched, per the DOC-031 check above): a
  // dead-center click hits "Widget" again at its original transform, and editing is re-enabled.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("scene-tree.row.1")).toHaveClass(/selected/);
  await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("0");
  await expect(page.getByTestId("inspector.transform.position-x")).toBeEnabled();

  await hooks.afterStop?.();
}

test.describe("Play mode (PC-001..PC-008, DOC-031/DOC-037/DOC-045, UX-106/UX-107/UX-113, UX-309/UX-310/UX-311)", () => {
  test.beforeEach(async ({ page }) => {
    await importPlayFixture(page);
    await setFrontCamera(page);
  });

  test("interpreter engine: full lifecycle — start/tick/select-injection/pause/resume/stop with a real document freeze and restore (PC-001..PC-004, PC-007, PC-008, DOC-031, DOC-037, DOC-045, UX-106, UX-107, UX-113, UX-309, UX-310, UX-311)", async ({
    page
  }) => {
    test.slow(); // real rAF-driven ticking + several real waits, same sensitivity note as this repo's other timing-heavy e2e tests.

    // Push one real undoable command on a DIFFERENT node ("Widget_Detail", node 3 — scene-tree row 2 in
    // this fixture's depth-first flatten: Root(0), Widget(1), Widget_Detail(3), KeyLight(2)) before
    // entering play mode — unrelated to node 1's own play-driven translation, so it's a clean target for
    // the DOC-045 "does play mode's freeze/unfreeze corrupt HistoryStack" check in afterStop below.
    // "Widget_Detail" starts at translation [10, 10, 10] (e2e/global-setup.ts).
    await page.getByTestId("scene-tree.row.2").click(); // "Widget_Detail" (node 3)
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("10");
    const committed = await page.evaluate(() => window.__gltfStudioTest!.simulateGizmoDrag([1, 0, 0]));
    expect(committed).toBe(true);
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("11");
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();

    await runPlayLifecycle(page, "interpreter", {
      afterStart: async () => {
        // startPlay() clears editor selection (UX-113) — the Inspector reverts to its empty state.
        await expect(page.getByTestId("inspector.empty")).toBeVisible();

        // DOC-031/DOC-037: attempting Undo while playing is rejected with the exact toast, and nothing
        // is undone — this exercises the store's own frozen-document guard (dispatchCommand/undo/redo's
        // pre-check plus DocumentFrozenError catch), not merely a UI affordance: topbar.undo's `disabled`
        // attribute tracks `canUndo`, not `playState`, so the button is enabled here and the click really
        // reaches the guarded code path.
        await page.getByTestId("topbar.undo").click();
        await expect(page.getByTestId("toast")).toHaveText("Document locked while playing — Stop to edit.");
        await expect(page.getByTestId("topbar.undo")).toBeEnabled(); // unaffected — nothing was undone

        // UX-113: selecting a node while playing is allowed (a scene-tree click is a selection, not a
        // document edit), but its edit-affordances stay disabled — the Inspector's transform fields...
        await page.getByTestId("scene-tree.row.1").click(); // "Widget"
        await expect(page.getByTestId("inspector.transform.position-x")).toBeDisabled();
        await expect(page.getByTestId("inspector.transform.rotation-x")).toBeDisabled();
        await expect(page.getByTestId("inspector.transform.scale-x")).toBeDisabled();
        // ...and the gizmo itself (UX-113 explicitly lists it as a disabled edit-affordance): attempting
        // a gizmo drag on the just-selected node is a no-op because no gizmo is attached while playing.
        const gizmoDragAttempted = await page.evaluate(() => window.__gltfStudioTest!.simulateGizmoDrag([1, 0, 0]));
        expect(gizmoDragAttempted).toBe(false);
      },
      afterStop: async () => {
        // DOC-045: HistoryStack survives the freeze/unfreeze cycle intact — the pre-play Widget_Detail
        // edit is still exactly one undoable step, and undo actually applies (not silently corrupted/cleared).
        await page.getByTestId("scene-tree.row.2").click(); // "Widget_Detail" (node 3)
        await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("11");
        await expect(page.getByTestId("topbar.undo")).toBeEnabled();
        await page.getByTestId("topbar.undo").click();
        await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("10");
        await expect(page.getByTestId("topbar.undo")).toBeDisabled();
      }
    });
  });

  test("compiled engine: parity with the interpreter — starts, ticks, click-select routing, pause freeze, stop restore (PC-001, PC-004, PC-007, PC-008, UX-310)", async ({
    page
  }) => {
    test.slow();
    await runPlayLifecycle(page, "compiled");
  });
});
