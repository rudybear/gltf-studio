import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH, FIXTURE_AUDIO_GRAPH_GAIN_NODE_LABEL } from "./global-setup.js";
import { clickNodeHeader, waitForNodesSettled } from "./graph-canvas-test-helpers.js";

/** This canvas's own instance of the shared test hook — see `GraphViewProps.testHookKey`'s doc comment (packages/graph-canvas/src/graph-view.tsx) for why audio-graph gets a separate key from the behavior graph. */
const AUDIO_HOOK_KEY = "__gltfStudioAudioGraphCanvasTest";

/**
 * M7 audio-graph EDITING (specs/ux-audio-graph.md UX-608..614,
 * specs/document-model.md DOC-056..059): the audio-graph canvas's own
 * palette, connect/disconnect, param editing, node deletion/position, lint-
 * on-edit (including the "allow the cycle, flag it loudly" policy, UX-612),
 * and the audition control (UX-614). Distinct spec file from
 * e2e/audio.spec.ts (which stays scoped to the pre-M7 read-only rendering +
 * lint-banner-on-import coverage, UX-600..607).
 *
 * The fixture asset (e2e/global-setup.ts) carries a small real
 * KHR_audio_graph chain: a bound KHR_audio_emitter source -> one `gain` node
 * (`FIXTURE_AUDIO_GRAPH_GAIN_NODE_LABEL`, "beepGain", gain 0.6) -> the
 * bound emitter. Mapped node indices for that starting graph: 0 = gain (the
 * one REAL `graph.nodes[]` entry), 1 = the synthetic source terminal, 2 =
 * the synthetic emitter terminal (map-audio-graph.ts always orders real
 * nodes first, then sources, then emitters).
 *
 * `window.__gltfStudioAudioGraphTest` (installed by AudioGraphTabPanel.tsx
 * alongside its own mount) is this suite's only way to read
 * `extensions.KHR_audio_graph` out of the live document.
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
  await page.getByTestId("dock.tab.audio-graph").click();
  await expect(page.getByTestId("acanvas.root")).toBeVisible();
  const audioCanvas = page.getByTestId("acanvas.root");
  await expect(audioCanvas.locator('[data-testid^="gcanvas.node."]')).toHaveCount(3);
  // Bug-fix note (deflake, see graph-canvas-test-helpers.ts's own doc
  // comment): this canvas shares `GraphView`/`op-node.tsx` with the
  // behavior graph, so it shares the same node-click/resize race
  // e2e/graph-canvas.spec.ts's own `waitForNodesSettled` guards against
  // (task #33) — not previously applied in this file. Repeated after every
  // palette-add below, same as that file's own convention.
  await waitForNodesSettled(page, AUDIO_HOOK_KEY);
}

async function getAudioGraphJson(page: Page): Promise<RawAudioGraph> {
  const json = await page.evaluate(() => window.__gltfStudioAudioGraphTest!.getDocumentJson());
  return (json as { extensions: { KHR_audio_graph: { graphs: RawAudioGraph[] } } }).extensions.KHR_audio_graph.graphs[0];
}

test.describe("audio-graph editing: palette, connect, param edit, undo (UX-608/610/611)", () => {
  test("adding an oscillator from the palette, editing its waveform enum and the gain node's number param, and rewiring the output are all undoable document edits", async ({
    page
  }) => {
    await importFixture(page);
    const audioCanvas = page.getByTestId("acanvas.root");

    // --- palette: search + add an oscillator (UX-608) ---
    await page.getByTestId("acanvas.palette.search").fill("oscillator");
    await expect(page.getByTestId("acanvas.palette.op.oscillator")).toBeVisible();
    await page.getByTestId("acanvas.palette.op.oscillator").click();

    // The new node is the second REAL graph.nodes[] entry (raw/mapped index 1
    // — gain is 0), selected automatically on add.
    await expect(audioCanvas.locator('[data-testid^="gcanvas.node."]')).toHaveCount(4);
    let graph = await getAudioGraphJson(page);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[1]!.kind).toBe("oscillator");

    // --- typed param edit: enum (oscillator waveform, UX-610) ---
    await expect(page.getByTestId("acanvas.param.oscillator.type")).toBeVisible();
    await page.getByTestId("acanvas.param.oscillator.type").selectOption("square");
    await expect.poll(async () => (await getAudioGraphJson(page)).nodes[1]!.params?.type).toBe("square");

    // --- typed param edit: number (the fixture's existing gain node, UX-610) ---
    // Bug-fix note (deflake, see graph-canvas-test-helpers.ts's own doc
    // comment): the oscillator add above re-lays-out every node's card via
    // `GraphView`'s `elkPositions` effect (packages/graph-canvas/src/graph-
    // view.tsx), not just the new node's — waiting AND clicking node 0's
    // header (not its own testid, whose geometric CENTER can land on this
    // audio node's own param row) rather than assuming node 0's box is
    // still where it was closes both halves of the node-click/resize race.
    await waitForNodesSettled(page, AUDIO_HOOK_KEY);
    await clickNodeHeader(audioCanvas, 0);
    await expect(audioCanvas.getByTestId("gcanvas.node.0")).toHaveClass(/gcanvas-op-node-selected/);
    const gainField = page.getByTestId("acanvas.param.gain.gain");
    await expect(gainField).toBeVisible();
    await gainField.fill("0.25");
    await gainField.blur();
    await expect.poll(async () => (await getAudioGraphJson(page)).nodes[0]!.params?.gain).toBe(0.25);

    // --- connect: rewire the emitter's producer from gain to the new oscillator (UX-611) ---
    // Mapped indices after the add above: 0 = gain, 1 = oscillator (both
    // real), 2 = source terminal, 3 = emitter terminal.
    await page.evaluate(() =>
      window.__gltfStudioAudioGraphCanvasTest!.simulateConnect({
        source: "1",
        sourceHandle: "value-out:out",
        target: "3",
        targetHandle: "value-in:in"
      })
    );
    await expect.poll(async () => (await getAudioGraphJson(page)).outputs).toEqual([{ node: 1, output: 0, emitter: 0 }]);

    // --- undo chain: connect, then both param edits, then the add, restores the original fixture graph exactly ---
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click(); // undoes the connect
    // Restores the fixture's EXACT original `outputs[]` entry (DOC-008's
    // exact-inverse guarantee) — the fixture never set an explicit
    // `output: 0` (optional field, schema-default 0), so the restored value
    // omits it too rather than round-tripping through a normalized `0`.
    await expect.poll(async () => (await getAudioGraphJson(page)).outputs).toEqual([{ node: 0, emitter: 0 }]);

    await page.getByTestId("topbar.undo").click(); // undoes the gain-param edit
    await expect.poll(async () => (await getAudioGraphJson(page)).nodes[0]!.params?.gain).toBe(0.6);

    await page.getByTestId("topbar.undo").click(); // undoes the oscillator-type edit
    await page.getByTestId("topbar.undo").click(); // undoes the add-node

    await expect(audioCanvas.locator('[data-testid^="gcanvas.node."]')).toHaveCount(3);
    graph = await getAudioGraphJson(page);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.label).toBe(FIXTURE_AUDIO_GRAPH_GAIN_NODE_LABEL);
    expect(graph.nodes[0]!.params?.gain).toBe(0.6);
  });
});

test.describe("audio-graph editing: lint-on-edit cycle policy (UX-609/612/614)", () => {
  test("creating a cycle through editing is allowed but flagged (banner + per-node badges) and disables audition; removing the cycle clears it", async ({
    page
  }) => {
    await importFixture(page);
    const audioCanvas = page.getByTestId("acanvas.root");

    await expect(page.getByTestId("acanvas.lint-banner")).toHaveCount(0);
    await expect(page.getByTestId("acanvas.audition")).toBeEnabled();

    // Add a lowpass filter (raw/mapped index 1) alongside the fixture's gain node (index 0).
    await page.getByTestId("acanvas.palette.search").fill("lowpass");
    await page.getByTestId("acanvas.palette.op.lowpass").click();
    await expect(audioCanvas.locator('[data-testid^="gcanvas.node."]')).toHaveCount(4);

    // Wire gain -> filter, then filter -> gain: the second connect closes a 2-node cycle.
    await page.evaluate(() =>
      window.__gltfStudioAudioGraphCanvasTest!.simulateConnect({
        source: "0",
        sourceHandle: "value-out:out",
        target: "1",
        targetHandle: "value-in:in"
      })
    );
    await expect(page.getByTestId("acanvas.lint-banner")).toHaveCount(0); // not a cycle yet — one-directional

    await page.evaluate(() =>
      window.__gltfStudioAudioGraphCanvasTest!.simulateConnect({
        source: "1",
        sourceHandle: "value-out:out",
        target: "0",
        targetHandle: "value-in:in"
      })
    );

    // UX-612: the edit itself is NOT rejected — both connections landed in the document.
    const graphWithCycle = await getAudioGraphJson(page);
    expect(graphWithCycle.connections).toEqual(
      expect.arrayContaining([
        { from: { node: 0, output: 0 }, to: { node: 1, input: 0 } },
        { from: { node: 1, output: 0 }, to: { node: 0, input: 0 } }
      ])
    );

    // UX-602/609: banner + per-node badges on BOTH cycle members.
    await expect(page.getByTestId("acanvas.lint-banner")).toBeVisible();
    await expect(page.getByTestId("acanvas.lint-banner")).toContainText(/cycle/i);
    await expect(audioCanvas.getByTestId("gcanvas.badge.0")).toBeVisible();
    await expect(audioCanvas.getByTestId("gcanvas.badge.0")).toHaveClass(/gcanvas-badge-error/);
    await expect(audioCanvas.getByTestId("gcanvas.badge.1")).toBeVisible();
    await expect(audioCanvas.getByTestId("gcanvas.badge.1")).toHaveClass(/gcanvas-badge-error/);

    // UX-603: the cycle's edges are dashed, not hidden.
    await expect(page.locator('.react-flow__edge path[style*="stroke-dasharray"]')).toHaveCount(2);

    // UX-614: audition is disabled while an error-severity violation exists.
    await expect(page.getByTestId("acanvas.audition")).toBeDisabled();

    // Remove the cycle by deleting the filter node (UX-613) — its fixup (DOC-057) drops both connections that touched it.
    // Bug-fix note (deflake — the "cycle badge" flake this test reproduced
    // offline under artificial CPU contention, same method as task #33):
    // node 1 just grew an error badge (the assertions above), resizing its
    // card — a stale geometric-center click here can silently miss
    // selecting it, so the Delete keypress has nothing to act on and the
    // cycle survives. Wait for the resize to settle and click the header
    // (content-independent, unlike the node's own testid) instead.
    await waitForNodesSettled(page, AUDIO_HOOK_KEY);
    await clickNodeHeader(audioCanvas, 1);
    await page.keyboard.press("Delete");

    await expect(page.getByTestId("acanvas.lint-banner")).toHaveCount(0);
    await expect(page.getByTestId("acanvas.audition")).toBeEnabled();
    const graphAfterRemoval = await getAudioGraphJson(page);
    expect(graphAfterRemoval.nodes).toHaveLength(1);
    expect(graphAfterRemoval.connections).toEqual([]);
  });
});
