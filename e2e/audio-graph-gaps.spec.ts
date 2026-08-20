import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";
import { clickNodeHeader, waitForNodesSettled } from "./graph-canvas-test-helpers.js";

/**
 * M7 "audio-graph gaps closed + deeper runtime" pass (specs/ux-audio-graph.md
 * UX-615..619, specs/document-model.md DOC-062/063): the four v1 gaps M7
 * audio-graph editing's own implementation notes left open (fan ports,
 * bypass, terminal-node position persistence, param coverage) plus the
 * runtime-gap messaging this pass adds for `compressor` (gap-analysis G1,
 * resolved at the SCHEMA level upstream but not yet in this project's
 * vendored runtime — see `packages/audio-graph/src/validators.ts`'s header
 * comment). Distinct spec file from `e2e/audio-graph-editing.spec.ts` (M7's
 * original palette/connect/param/lint-on-edit coverage) per this repo's
 * "new e2e in new spec files" convention.
 *
 * Same fixture and mapped-index convention as audio-graph-editing.spec.ts:
 * the imported graph starts as source(0) -> gain(0, "beepGain") -> emitter(0)
 * (global). Mapped node indices for that starting graph: 0 = gain (the one
 * REAL `graph.nodes[]` entry), 1 = the synthetic source terminal, 2 = the
 * synthetic emitter terminal.
 */

const AUDIO_HOOK_KEY = "__gltfStudioAudioGraphCanvasTest";

type RawAudioGraph = {
  nodes: Array<{ kind: string; label?: string; params?: Record<string, unknown>; bypass?: boolean; extras?: { gltfi?: { x: number; y: number } } }>;
  connections: Array<{ from: { node: number; output?: number }; to: { node: number; input?: number } }>;
  inputs?: Array<{ source: number; node: number; input?: number }>;
  outputs?: Array<{ node: number; output?: number; emitter: number }>;
};

async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await page.getByTestId("dock.tab.audio-graph").click();
  await expect(page.getByTestId("acanvas.root")).toBeVisible();
  await expect(page.getByTestId("acanvas.root").locator('[data-testid^="gcanvas.node."]')).toHaveCount(3);
  await waitForNodesSettled(page, AUDIO_HOOK_KEY);
}

async function getAudioGraphJson(page: Page): Promise<RawAudioGraph> {
  const json = await page.evaluate(() => window.__gltfStudioAudioGraphTest!.getDocumentJson());
  return (json as { extensions: { KHR_audio_graph: { graphs: RawAudioGraph[] } } }).extensions.KHR_audio_graph.graphs[0];
}

async function getAudioEmitterExtension(page: Page): Promise<{
  sources: Array<{ extras?: { gltfi?: { x: number; y: number } } }>;
  emitters: Array<{ extras?: { gltfi?: { x: number; y: number } } }>;
}> {
  const json = await page.evaluate(() => window.__gltfStudioAudioGraphTest!.getDocumentJson());
  return (json as { extensions: { KHR_audio_emitter: { sources: unknown[]; emitters: unknown[] } } }).extensions.KHR_audio_emitter as never;
}

test.describe("Fan ports: splitter numberOfOutputs param addresses/connects channel 2 (UX-615)", () => {
  test("adding a splitter, raising numberOfOutputs to 3, and connecting a new gain node to its THIRD output writes the correct connections[] entry", async ({ page }) => {
    await importFixture(page);
    const audioCanvas = page.getByTestId("acanvas.root");

    // Add a splitter (raw/mapped index 1 — gain is 0) and raise its declared
    // output count from the registry default (2) to 3.
    await page.getByTestId("acanvas.palette.search").fill("splitter");
    await page.getByTestId("acanvas.palette.op.splitter").click();
    await expect(audioCanvas.locator('[data-testid^="gcanvas.node."]')).toHaveCount(4);
    await waitForNodesSettled(page, AUDIO_HOOK_KEY);

    await clickNodeHeader(audioCanvas, 1);
    const countField = page.getByTestId("acanvas.param.splitter.numberOfOutputs");
    await expect(countField).toBeVisible();
    await countField.fill("3");
    await countField.blur();
    await expect.poll(async () => (await getAudioGraphJson(page)).nodes[1]!.params?.numberOfOutputs).toBe(3);

    // Raising the count re-lays-out the canvas (the splitter card now has 3
    // output handles) — settle before the next add/connect.
    await waitForNodesSettled(page, AUDIO_HOOK_KEY);

    // Add a plain gain node to receive the splitter's THIRD (index-2) output
    // — mapped/raw index 2.
    await page.getByTestId("acanvas.palette.search").fill("");
    await page.getByTestId("acanvas.palette.search").fill("gain");
    await page.getByTestId("acanvas.palette.op.gain").click();
    await expect(audioCanvas.locator('[data-testid^="gcanvas.node."]')).toHaveCount(5);
    await waitForNodesSettled(page, AUDIO_HOOK_KEY);

    // Connect splitter (node 1) output index 2 -> the new gain (node 2)
    // input — only reachable/addressable at all because numberOfOutputs=3
    // seeded a THIRD rendered port (UX-615's fix; before this pass, a fresh
    // splitter always rendered exactly one output port regardless of any
    // param).
    await page.evaluate(() =>
      window.__gltfStudioAudioGraphCanvasTest!.simulateConnect({
        source: "1",
        sourceHandle: "value-out:out2",
        target: "2",
        targetHandle: "value-in:in"
      })
    );

    await expect.poll(async () => (await getAudioGraphJson(page)).connections).toEqual(
      expect.arrayContaining([{ from: { node: 1, output: 2 }, to: { node: 2, input: 0 } }])
    );
  });
});

test.describe("Bypass: per-node bypass field (UX-616)", () => {
  test("toggling bypass on the gain node writes graph.nodes[0].bypass and leaves audition enabled/functional", async ({ page }) => {
    await importFixture(page);
    const audioCanvas = page.getByTestId("acanvas.root");

    await clickNodeHeader(audioCanvas, 0);
    await expect(audioCanvas.getByTestId("gcanvas.node.0")).toHaveClass(/gcanvas-op-node-selected/);

    const bypassCheckbox = page.getByTestId("acanvas.param.bypass");
    await expect(bypassCheckbox).toBeVisible();
    await expect(bypassCheckbox).not.toBeChecked();

    await bypassCheckbox.check();
    await expect.poll(async () => (await getAudioGraphJson(page)).nodes[0]!.bypass).toBe(true);

    // Bypass is a document-valid routing choice, not a lint violation —
    // audition stays enabled, and clicking it (the vendored AudioGraphJS
    // runtime rewires straight around the bypassed node — validators.ts/
    // audio-graph-edit.ts's own doc comments) must not throw/crash.
    await expect(page.getByTestId("acanvas.audition")).toBeEnabled();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.getByTestId("acanvas.audition").click();
    await page.waitForTimeout(200);
    expect(pageErrors).toEqual([]);
    await expect(page.getByTestId("acanvas.audition")).toBeEnabled();

    // Undo the checkbox click.
    await bypassCheckbox.uncheck();
    await expect.poll(async () => (await getAudioGraphJson(page)).nodes[0]!.bypass).toBe(false);
  });
});

test.describe("Terminal-node position persistence (UX-617)", () => {
  test("moving the source terminal node persists its position via extras.gltfi on KHR_audio_emitter.sources[0], surviving a full page reload", async ({ page }) => {
    await importFixture(page);
    await expect(page.getByTestId("acanvas.root")).toBeVisible();

    // Mapped node 1 is the synthetic source terminal (see this file's own
    // header comment for the starting fixture's mapped-index convention).
    // `simulateMoveNode` (graph-view.tsx's `GraphCanvasTestHook`, added
    // alongside this coverage) invokes the SAME `onMoveNode` handler a real
    // node-header drag triggers, bypassing raw pixel mouse choreography —
    // this canvas's `fitView minZoom={0.05}` renders a small graph like this
    // fixture's 3-node one at a tiny fraction of its logical size, making a
    // literal pixel-coordinate drag unreliable regardless of how carefully a
    // spec tries to zoom back in first (see that hook's own doc comment).
    await page.evaluate(() => window.__gltfStudioAudioGraphCanvasTest!.simulateMoveNode("1", 123, 456));

    await expect.poll(async () => (await getAudioEmitterExtension(page)).sources[0]?.extras?.gltfi).toEqual({ x: 123, y: 456 });
    const extras = { x: 123, y: 456 };

    // UX-123's debounced autosave, then a full reload — the source terminal
    // is NOT a `graph.nodes[]` entry, so this specifically exercises
    // DOC-062's `SceneEdit.setAudioSourceProperty` write surviving a real
    // save/reload round trip, not just an in-memory store value.
    await expect(page.getByTestId("topbar.save-status")).toHaveText("Saved", { timeout: 8000 });
    await page.reload();
    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
    await expect(page.getByTestId("recovery.dialog")).toHaveCount(0);

    await page.getByTestId("dock.tab.audio-graph").click();
    await expect(page.getByTestId("acanvas.root")).toBeVisible();
    await waitForNodesSettled(page, AUDIO_HOOK_KEY);

    const afterReload = (await getAudioEmitterExtension(page)).sources[0]?.extras?.gltfi;
    expect(afterReload).toEqual(extras);
  });
});

test.describe("Spec-gap vs runtime-gap messaging: compressor (UX-619, gap-analysis G1)", () => {
  test("a compressor wired into the audition path lints as a runtime-unimplemented WARNING (not an error), stays auditionable, and does not crash the app", async ({ page }) => {
    await importFixture(page);
    const audioCanvas = page.getByTestId("acanvas.root");

    // Add a compressor (raw/mapped index 1 — gain is 0) and splice it into
    // the signal path: gain -> compressor -> emitter (replacing gain's
    // direct emitter binding, "last write wins", UX-611).
    await page.getByTestId("acanvas.palette.search").fill("compressor");
    await expect(page.getByTestId("acanvas.palette.op.compressor")).toBeVisible();
    await page.getByTestId("acanvas.palette.op.compressor").click();
    await expect(audioCanvas.locator('[data-testid^="gcanvas.node."]')).toHaveCount(4);
    await waitForNodesSettled(page, AUDIO_HOOK_KEY);

    // Mapped indices after the add: 0 = gain, 1 = compressor (both real),
    // 2 = source terminal, 3 = emitter terminal.
    await page.evaluate(() =>
      window.__gltfStudioAudioGraphCanvasTest!.simulateConnect({ source: "0", sourceHandle: "value-out:out", target: "1", targetHandle: "value-in:in" })
    );
    await page.evaluate(() =>
      window.__gltfStudioAudioGraphCanvasTest!.simulateConnect({ source: "1", sourceHandle: "value-out:out", target: "3", targetHandle: "value-in:in" })
    );
    await expect.poll(async () => (await getAudioGraphJson(page)).outputs).toEqual([{ node: 1, output: 0, emitter: 0 }]);

    // UX-619: the lint banner names BOTH halves of the distinction plainly —
    // schema-valid, runtime-unimplemented — not a generic/opaque error.
    const banner = page.getByTestId("acanvas.lint-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/compressor/i);
    await expect(banner).toContainText(/ratified KHR_audio_graph schema/i);
    await expect(banner).toContainText(/vendored AudioGraphJS runtime/i);

    // A schema-valid-but-runtime-unimplemented node is a WARNING, not an
    // error — UX-612's audition-disable policy only fires on error-severity
    // violations, so audition stays enabled and clickable.
    await expect(page.getByTestId("acanvas.audition")).toBeEnabled();

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    // AudioGraphJsHost.audition()'s build-failure safety net (this pass) is
    // what keeps this click from throwing an uncaught exception into the
    // page — a graph reaching a compressor previously had no guard at all.
    await page.getByTestId("acanvas.audition").click();
    await page.waitForTimeout(200);
    expect(pageErrors).toEqual([]);
    await expect(page.getByTestId("acanvas.audition")).toBeEnabled();
    await expect(audioCanvas).toBeVisible();
  });
});
