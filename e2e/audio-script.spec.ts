import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH, FIXTURE_NO_GRAPH_GLB_PATH, FIXTURE_AUDIO_GRAPH_GAIN_NODE_LABEL } from "./global-setup.js";
import { assertRegionRendersContent, assertRegionSpansMultipleLines } from "./visual-assert.js";
import { clickNodeHeader, waitForNodesSettled } from "./graph-canvas-test-helpers.js";

/** This canvas's own instance of the shared test hook (see audio-graph-editing.spec.ts's own doc comment). */
const AUDIO_HOOK_KEY = "__gltfStudioAudioGraphCanvasTest";

/**
 * Audio Script tab (specs/ux-audio-script.md UX-1400): the @gltf-audiograph
 * sibling of e2e/script.spec.ts's coverage — Monaco emit/edit surface,
 * off-thread parse diagnostics, EQUIV/DIVERGED via real
 * @gltf-audiograph/verify comparison, and Apply -> Audio graph via
 * editor-core's AudioGraphEdit.replaceAudioGraph (DOC-064).
 *
 * The fixture asset (e2e/global-setup.ts) carries the same small real
 * KHR_audio_graph chain e2e/audio-graph-editing.spec.ts uses: a bound
 * KHR_audio_emitter source -> one `gain` node
 * (FIXTURE_AUDIO_GRAPH_GAIN_NODE_LABEL, "beepGain", gain 0.6) -> the bound
 * emitter — a clean, r2-compatible shape (no oscillator), so the
 * beforeEach's emit-view assertions below hold unconditionally.
 */

type RawAudioGraph = {
  nodes: Array<{ kind: string; label?: string; params?: Record<string, unknown>; extras?: { gltfi?: { x: number; y: number } } }>;
  connections: Array<{ from: { node: number; output?: number }; to: { node: number; input?: number } }>;
  inputs?: Array<{ source: number; node: number; input?: number }>;
  outputs?: Array<{ node: number; output?: number; emitter: number }>;
};

async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
}

async function openAudioScriptTab(page: Page): Promise<void> {
  await page.getByTestId("dock.tab.audio-script").click();
  await expect(page.getByTestId("dock.tab.audio-script")).toHaveClass(/active/);
  await expect(page.getByTestId("audio-script.panel")).toBeVisible();
  // Monaco mounts via a dynamic import + a Worker spin-up — wait for the
  // real test hook and real emitted content, not just the container element.
  await expect
    .poll(() => page.evaluate(() => window.__gltfStudioAudioScriptTest?.getCode() ?? ""), { timeout: 15000 })
    .toContain("a.gain(");
}

async function getAudioGraphJson(page: Page): Promise<RawAudioGraph> {
  // Reads through the Audio Script tab's OWN hook (mounted-but-hidden,
  // UX-1408) rather than AudioGraphTabPanel's — the latter only exists
  // while the plain-conditionally-mounted Audio graph tab is itself active.
  const json = await page.evaluate(() => window.__gltfStudioAudioScriptTest!.getDocumentJson());
  return (json as { extensions: { KHR_audio_graph: { graphs: RawAudioGraph[] } } }).extensions.KHR_audio_graph.graphs[0];
}

async function audioScriptSetValue(page: Page, value: string): Promise<void> {
  await page.evaluate((text) => window.__gltfStudioAudioScriptTest!.setValue(text), value);
}

test.describe("Audio Script tab", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
    await openAudioScriptTab(page);
  });

  test("Emit view shows the fixture audio graph's real generated code, read-only, EQUIV by default; toolbar is exactly Edit/Apply/badge (UX-1400/UX-1401/UX-1403)", async ({ page }) => {
    const code = await page.evaluate(() => window.__gltfStudioAudioScriptTest!.getCode());
    expect(code.startsWith("// Audio script — generated from audio graph 0")).toBe(true);
    expect(code).toContain(`const ${FIXTURE_AUDIO_GRAPH_GAIN_NODE_LABEL} = a.gain(`);
    expect(code).toContain(".out.connect(a.emitter(0));");
    await expect(page.getByTestId("audio-script.equiv-badge")).toHaveText("EQUIV ✓");
    await expect(page.getByTestId("audio-script.edit-toggle")).toHaveText("Edit");
    await expect(page.getByTestId("audio-script.apply")).toBeDisabled();
    await expect(page.getByTestId("audio-script.toolbar").locator("button")).toHaveCount(2);
  });

  test("editing a gain value diverges the script from the audio graph; Apply -> Audio graph replaces the graph as ONE undoable command, and the Audio graph canvas reflects it (UX-1403/UX-1404, DOC-064)", async ({ page }) => {
    test.slow(); // real off-thread parse round trip(s), same sensitivity note as e2e/script.spec.ts's own edit/Apply test.

    await page.getByTestId("audio-script.edit-toggle").click();
    await expect(page.getByTestId("audio-script.edit-toggle")).toHaveText("Done");

    const before = await getAudioGraphJson(page);
    expect(before.nodes[0]!.params?.gain).toBe(0.6);

    const code = await page.evaluate(() => window.__gltfStudioAudioScriptTest!.getCode());
    const edited = code.replace("gain: 0.6", "gain: 0.9");
    expect(edited).not.toBe(code);
    await audioScriptSetValue(page, edited);

    await expect(page.getByTestId("audio-script.equiv-badge")).toHaveText("DIVERGED ⚠", { timeout: 15000 });
    await expect(page.getByTestId("audio-script.apply")).toBeEnabled();

    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await page.getByTestId("audio-script.apply").click();

    await expect(page.getByTestId("audio-script.equiv-badge")).toHaveText("EQUIV ✓");
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();

    const after = await getAudioGraphJson(page);
    expect(after.nodes[0]!.params?.gain).toBe(0.9);

    // Canvas reflection: switch to the Audio graph tab and read the SAME
    // gain param back out of its own typed param field, not just the raw
    // document JSON already asserted above.
    await page.getByTestId("dock.tab.audio-graph").click();
    const audioCanvas = page.getByTestId("acanvas.root");
    await waitForNodesSettled(page, AUDIO_HOOK_KEY);
    await clickNodeHeader(audioCanvas, 0);
    await expect(page.getByTestId("acanvas.param.gain.gain")).toHaveValue("0.9");

    // One history entry: undo restores the exact prior graph, and — since
    // the edit buffer still holds the unapplied edit — re-diverges the
    // Audio Script badge automatically, same behavior e2e/script.spec.ts's
    // own Apply/undo test documents for the interactivity side.
    await page.getByTestId("topbar.undo").click();
    const undone = await getAudioGraphJson(page);
    expect(undone).toEqual(before);
    await page.getByTestId("dock.tab.audio-script").click();
    await expect(page.getByTestId("audio-script.equiv-badge")).toHaveText("DIVERGED ⚠");

    // EQUIV returns after a regen with no unapplied edit: leaving edit mode
    // (Done) discards the buffer and regenerates the Emit view from the
    // now-reverted graph.
    await page.getByTestId("audio-script.edit-toggle").click();
    await expect(page.getByTestId("audio-script.equiv-badge")).toHaveText("EQUIV ✓");
  });

  test("a syntax error shows diagnostics and disables Apply, with the gutter marker landing on the diagnostic's exact structured line", async ({ page }) => {
    await page.getByTestId("audio-script.edit-toggle").click();

    const code = await page.evaluate(() => window.__gltfStudioAudioScriptTest!.getCode());
    const marker = "export default function audio(a: AudioScript) {";
    const insertAt = code.indexOf(marker) + marker.length;
    const before = code.slice(0, insertAt);
    const markerLine = before.split("\n").length;
    const badLine = markerLine + 3; // +1 for the newline right after `{`, +2 padding comment lines, then the bad statement.
    const edited = `${before}\n  // padding line A\n  // padding line B\n  debugger;\n${code.slice(insertAt)}`;
    await audioScriptSetValue(page, edited);

    await expect(page.getByTestId("audio-script.diagnostics")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("audio-script.apply")).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.__gltfStudioAudioScriptTest!.getMarkerLines()), { timeout: 15000 }).toEqual([badLine]);
  });

  test("selecting the gain node on the Audio graph canvas cross-highlights its emitted identifier in the Audio Script tab (UX-1406)", async ({ page }) => {
    await page.getByTestId("dock.tab.audio-graph").click();
    const audioCanvas = page.getByTestId("acanvas.root");
    await expect(audioCanvas.locator('[data-testid^="gcanvas.node."]')).toHaveCount(3);
    await waitForNodesSettled(page, AUDIO_HOOK_KEY);
    await clickNodeHeader(audioCanvas, 0); // mapped/raw index 0 = the real "gain" node.
    await expect(audioCanvas.getByTestId("gcanvas.node.0")).toHaveClass(/gcanvas-op-node-selected/);

    await page.getByTestId("dock.tab.audio-script").click();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioAudioScriptTest?.getSelectedText() ?? null), { timeout: 15000 })
      .toBe(FIXTURE_AUDIO_GRAPH_GAIN_NODE_LABEL);
  });

  test('adding a legacy oscillator NODE from the palette (r2/canvas reconciliation, UX-1409) produces an honest diagnostics-only placeholder, not a crash, with a working "→ Audio graph" jump (UX-1407)', async ({
    page
  }) => {
    // audio-canvas's palette still authors the pre-r2 oscillator-as-node
    // shape (see e2e/audio-graph-editing.spec.ts) — @gltf-audiograph's
    // importAudioGraph rejects that shape outright. This is the direct e2e
    // proof of UX-1409's documented tolerance.
    await page.getByTestId("dock.tab.audio-graph").click();
    const audioCanvas = page.getByTestId("acanvas.root");
    await waitForNodesSettled(page, AUDIO_HOOK_KEY);
    await page.getByTestId("acanvas.palette.search").fill("oscillator");
    await expect(page.getByTestId("acanvas.palette.op.oscillator")).toBeVisible();
    await page.getByTestId("acanvas.palette.op.oscillator").click();
    await expect(audioCanvas.locator('[data-testid^="gcanvas.node."]')).toHaveCount(4);

    await page.getByTestId("dock.tab.audio-script").click();
    await expect(page.getByTestId("audio-script.diagnostics")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("audio-script.diagnostics")).toContainText("oscillator");
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioAudioScriptTest?.getCode() ?? ""), { timeout: 15000 })
      .toContain("Cannot generate a script");

    // The "→ Audio graph" jump: clicking it selects the flagged node (mapped/raw index 1, the new oscillator) on the Audio graph canvas.
    await page.getByTestId("audio-script.diagnostic-jump").click();
    await expect(page.getByTestId("dock.tab.audio-graph")).toHaveClass(/active/);
    await expect(audioCanvas.getByTestId("gcanvas.node.1")).toHaveClass(/gcanvas-op-node-selected/);
  });

  test("emitted multi-line code is genuinely VISIBLE (not just present in Monaco's model) at default dock height and after a tab-switch-away-and-back (UX-1400, visual regression)", async ({
    page
  }) => {
    const codeRegion = page.getByTestId("audio-script.code");
    await assertRegionSpansMultipleLines(codeRegion);

    await page.getByTestId("dock.tab.graph").click();
    await page.getByTestId("dock.tab.audio-script").click();
    await assertRegionSpansMultipleLines(codeRegion);
  });
});

// UX-1405's no-audio-graph empty state — a separate describe block since it needs a document with
// no KHR_audio_graph at all, unlike every test above (this file's shared beforeEach imports the
// real-audio-graph fixture).
test.describe("Audio Script tab - no-audio-graph empty state (UX-1405)", () => {
  test('shows an honest "no audio graph" message, not a live-but-empty editor, when the document has no KHR_audio_graph', async ({ page }) => {
    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_NO_GRAPH_GLB_PATH);
    await expect(page.getByTestId("topbar.project-name")).toBeVisible();
    await page.getByTestId("dock.tab.audio-script").click();

    await expect(page.getByTestId("audio-script.empty-state")).toHaveText("No audio graph in this asset — add nodes from the audio palette.");
    await expect(page.getByTestId("audio-script.toolbar")).toHaveCount(0);
    await expect(page.getByTestId("audio-script.code")).toBeHidden();

    await assertRegionRendersContent(page.getByTestId("audio-script.panel"));
  });
});
