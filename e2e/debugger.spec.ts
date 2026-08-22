import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { FIXTURE_PLAY_GLB_PATH, FIXTURE_FRONT_CAMERA_POSE } from "./global-setup.js";
import { assertRegionRendersContent } from "./visual-assert.js";

/**
 * D1 script-debugging spine (docs/adr/0006-devtools-script-debugging.md,
 * specs/ux-debugger.md UX-1500 block, specs/engine-api.md PC-009): the
 * honest, headless proof that a REAL DevTools debugger — not a bespoke
 * stepper — can show and pause the user's own Script-tab TypeScript during
 * compiled play. Uses a real Chrome DevTools Protocol session
 * (`context.newCDPSession`, NOT a page-internal API — CDP is inspector-
 * side, per docs/adr/0006's "CDP self-debugging" rejected-alternative note)
 * against the exact same fixture (`FIXTURE_PLAY_GLB_PATH`) e2e/play.spec.ts
 * already uses (a real, ticking `onTick` handler incrementing `counter`).
 *
 * `Debugger.getScriptSource` returns the RUNNING (compiled JS) script's own
 * text, not the original TypeScript — decoding that script's own inline
 * source map's `sourcesContent[0]` is what a real DevTools "Authored"
 * Sources view itself does to show pretty source, and is this test's own
 * proof of specs/ux-debugger.md UX-1503's text-identity guarantee. The
 * breakpoint is set at a line found by searching the RUNNING script's own
 * text (not the original TS) for a substring known to survive esbuild's
 * transform verbatim (`V.counter = V.counter + 1;`, inside the `onTick`
 * handler body) — readable, non-mangled identifiers (docs/adr/0006's
 * "readable emission is what makes DevTools scopes legible") are exactly
 * what makes this line-finding approach reliable without needing a VLQ
 * source-map-position decoder in this test.
 */

/** Decodes a `//# sourceMappingURL=data:application/json;base64,...` inline map out of a compiled JS string. */
function decodeInlineSourceMap(code: string): { sources: string[]; sourcesContent: string[] } {
  const match = /\/\/# sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([A-Za-z0-9+/=]+)/.exec(code);
  if (!match) throw new Error("no inline sourceMappingURL comment found in the running compiled script");
  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
}

/** 0-based line index of the first line containing `needle`. */
function lineIndexOf(text: string, needle: string): number {
  const idx = text.indexOf(needle);
  if (idx === -1) throw new Error(`substring not found: ${needle}`);
  return text.slice(0, idx).split("\n").length - 1;
}

async function importPlayFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_PLAY_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("play-scene");
}

/** Same pattern as e2e/play.spec.ts/e2e/viewport.spec.ts's `setFrontCamera` — see those files' doc comments for why `isReady()` is awaited first (needed here before `simulateGizmoDrag`). */
async function setFrontCamera(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
  await page.evaluate((pose) => window.__gltfStudioTest!.setCameraPose(pose), FIXTURE_FRONT_CAMERA_POSE);
}

async function openScriptTabAndGetCode(page: Page): Promise<string> {
  await page.getByTestId("dock.tab.script").click();
  await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
  await expect(page.getByTestId("script.panel")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15000 })
    .toContain("rt.onTick(");
  return page.evaluate(() => window.__gltfStudioScriptTest!.getCode());
}

test.describe("Script debugger D1 (docs/adr/0006, specs/ux-debugger.md UX-1500 block, PC-009)", () => {
  test("toggle is disabled under the interpreter engine, enabled under compiled (UX-1500)", async ({ page }) => {
    await importPlayFixture(page);
    await expect(page.getByTestId("playbar.engine-picker")).toHaveValue("interpreter");
    await expect(page.getByTestId("playbar.debug-toggle")).toBeDisabled();

    await page.getByTestId("playbar.engine-picker").selectOption("compiled");
    await expect(page.getByTestId("playbar.debug-toggle")).toBeEnabled();
  });

  test("real DevTools debugging: scriptParsed for the virtual sourceURL, text-identity with the Script tab, a real breakpoint pauses a tick, then resume/stop leaves freeze+undo intact (PC-009, UX-1502, UX-1503, UX-1504)", async ({
    page,
    context
  }) => {
    test.slow(); // real CDP round-trips + real rAF-driven ticking, same sensitivity note as e2e/play.spec.ts.

    await importPlayFixture(page);
    await setFrontCamera(page);
    const scriptTabText = await openScriptTabAndGetCode(page);

    // Push one real undoable command before entering play mode, on a node
    // unrelated to the fixture graph's own play-driven writes (same
    // "Widget_Detail", node 3, row 2 in this fixture's depth-first flatten"
    // choice e2e/play.spec.ts already makes, for the same reason) — a clean
    // target for verifying HistoryStack survives the debug pause/resume/stop
    // cycle intact.
    await page.getByTestId("scene-tree.row.2").click(); // "Widget_Detail" (node 3)
    const committed = await page.evaluate(() => window.__gltfStudioTest!.simulateGizmoDrag([1, 0, 0]));
    expect(committed).toBe(true);
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();

    await page.getByTestId("playbar.engine-picker").selectOption("compiled");
    await page.getByTestId("playbar.debug-toggle").click();

    const cdp: CDPSession = await context.newCDPSession(page);
    await cdp.send("Debugger.enable");

    const scriptParsedEvents: Array<{ scriptId: string; url: string }> = [];
    cdp.on("Debugger.scriptParsed", (event) => scriptParsedEvents.push(event as { scriptId: string; url: string }));

    const pausedEvents: unknown[] = [];
    cdp.on("Debugger.paused", (event) => pausedEvents.push(event));

    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();

    // UX-1504: the play-overlay debug hint is visible — and really renders
    // (pixel assert, not just toBeVisible()).
    const debugHint = page.getByTestId("viewport.play-overlay.debug-hint");
    await expect(debugHint).toHaveText("Debuggable — open DevTools → Sources → gltf-studio://");
    await assertRegionRendersContent(debugHint, { minNonBackgroundPixels: 20, minNonBackgroundFraction: 0.02 });

    // PC-009/UX-1502: DevTools really parsed a script named after the stable virtual sourceURL.
    const virtualUrl = "gltf-studio:///behavior/graph0.ts";
    await expect.poll(() => scriptParsedEvents.some((e) => e.url === virtualUrl), { timeout: 10000 }).toBe(true);
    const scriptId = scriptParsedEvents.find((e) => e.url === virtualUrl)!.scriptId;

    // UX-1503: the running script's OWN inline source map decodes to sources=[virtualUrl] and
    // sourcesContent[0] === the Script tab's EXACT displayed text — the text-identity guarantee,
    // checked against the REAL served script, not a unit-test fixture.
    const { scriptSource } = await cdp.send("Debugger.getScriptSource", { scriptId });
    const map = decodeInlineSourceMap(scriptSource);
    expect(map.sources).toEqual([virtualUrl]);
    expect(map.sourcesContent[0]).toBe(scriptTabText);

    // A real breakpoint, on a line found in the RUNNING script's own text (readable emission —
    // docs/adr/0006 — means `V.counter = V.counter + 1;` inside onTick's handler body survives
    // esbuild's transform verbatim), pauses the NEXT tick.
    const lineNumber = lineIndexOf(scriptSource, "V.counter = V.counter + 1");
    const { breakpointId } = await cdp.send("Debugger.setBreakpointByUrl", { url: virtualUrl, lineNumber, columnNumber: 0 });

    await expect.poll(() => pausedEvents.length, { timeout: 10000 }).toBeGreaterThan(0);

    // Remove the breakpoint before resuming — ticks fire ~60/s, and the very next one would
    // otherwise re-hit the same line and pause again immediately.
    await cdp.send("Debugger.removeBreakpoint", { breakpointId });
    await cdp.send("Debugger.resume");

    // The counter overlay resumes changing after resume (the engine really was paused, not just
    // the CDP event delivered with no real effect on execution).
    const counterRow = page.getByTestId("viewport.play-overlay.variable.counter");
    const readCounter = async (): Promise<number> => parseFloat((await counterRow.locator(".val").textContent()) ?? "0");
    const afterResume = await readCounter();
    await expect.poll(readCounter, { timeout: 5000 }).toBeGreaterThan(afterResume);

    // Stop cleanly: locked banner clears, and the pre-play edit's undo history is intact (the
    // debug pause/resume cycle didn't corrupt HistoryStack's freeze/unfreeze, DOC-031/DOC-045).
    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
  });
});
