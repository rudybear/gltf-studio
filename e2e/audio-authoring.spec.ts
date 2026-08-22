import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";
import { buildInspectorFixtureBytes, INSPECTOR_FIXTURE_NAME } from "./inspector-fixture.js";

/**
 * Emitter/environment/listener authoring, audio pass 3/3
 * (specs/ux-inspector.md UX-419..423, specs/document-model.md DOC-062,
 * specs/engine-api.md's extended AH-pointer-value-tbd note). NEW spec file
 * per the audio-authoring-pass convention (audio.spec.ts stays scoped to
 * M7's original Audition + audio-graph-dock coverage). Uses
 * `e2e/inspector-fixture.ts`'s own richer fixture — extended by this pass
 * with an explicit `positional` block (fixing UX-419's own distanceModel
 * write-only bug) and a `KHR_audio_environment` environment/listener/zone
 * (a NEW node, index 5, appended so it never disturbs the 0..4 indices
 * `inspector.spec.ts`/`export.spec.ts` already pin).
 */

async function importInspectorFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', {
    name: INSPECTOR_FIXTURE_NAME,
    mimeType: "model/gltf-binary",
    buffer: buildInspectorFixtureBytes()
  });
  await expect(page.getByTestId("topbar.project-name")).toHaveText("inspector-fixture");
}

function documentJson(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__gltfStudioDocumentTest?.getJson());
}

function audioDiagnostics(page: Page): Promise<string> {
  return page.evaluate(() => window.__gltfStudioAudioTest?.diagnostics() ?? "no hook");
}

function emitterPosition(page: Page, emitterIndex: number): Promise<[number, number, number] | null | undefined> {
  return page.evaluate((index) => window.__gltfStudioAudioTest?.emitterPosition(index), emitterIndex);
}

type EmitterDoc = {
  extensions: {
    KHR_audio_emitter: {
      emitters: Array<{
        gain?: number;
        positional?: { distanceModel?: string; refDistance?: number; coneInnerAngle?: number; coneOuterAngle?: number; coneOuterGain?: number };
        sources: number[];
      }>;
      sources: Array<{ gain?: number; playbackRate?: number; loop?: boolean; autoplay?: boolean }>;
    };
    KHR_audio_environment?: {
      environments?: Array<{ reverb?: { preset?: string; mix?: number } }>;
      listeners?: Array<{ gain?: number; spatializationModel?: string }>;
    };
  };
  nodes: Array<{ extensions?: { KHR_audio_environment?: { environment?: number; shape?: { radius?: number }; blendDistance?: number; priority?: number } } }>;
  scenes: Array<{ extensions?: { KHR_audio_environment?: { environment?: number; activeListener?: number } } }>;
};

test.describe("audio authoring: emitter positional physics + sources (specs/ux-inspector.md UX-419/UX-420)", () => {
  test.beforeEach(async ({ page }) => {
    await importInspectorFixture(page);
    await page.getByTestId("scene-tree.row.4").click(); // "Speaker"
  });

  test("distanceModel/refDistance/rolloff/cone fields edit extensions.KHR_audio_emitter.emitters[0].positional and are undoable", async ({ page }) => {
    await expect(page.getByTestId("inspector.audio.distance-model")).toHaveValue("inverse");
    await expect(page.getByTestId("inspector.audio.ref-distance")).toHaveValue("1");
    await expect(page.getByTestId("inspector.audio.cone-inner-angle")).toHaveCount(0); // shape starts omnidirectional -- cone fields hidden.

    await page.getByTestId("inspector.audio.distance-model").selectOption("linear");
    await page.getByTestId("inspector.audio.ref-distance").fill("3");
    await page.getByTestId("inspector.audio.shape-type").selectOption("cone");
    await expect(page.getByTestId("inspector.audio.cone-inner-angle")).toBeVisible();
    await page.getByTestId("inspector.audio.cone-inner-angle").fill("0.5");
    await page.getByTestId("inspector.audio.cone-outer-angle").fill("1.2");
    await page.getByTestId("inspector.audio.cone-outer-gain").fill("0.2");

    const json = (await documentJson(page)) as EmitterDoc;
    const positional = json.extensions.KHR_audio_emitter.emitters[0].positional!;
    expect(positional.distanceModel).toBe("linear");
    expect(positional.refDistance).toBe(3);
    expect(positional.coneInnerAngle).toBeCloseTo(0.5, 5);
    expect(positional.coneOuterAngle).toBeCloseTo(1.2, 5);
    expect(positional.coneOuterGain).toBeCloseTo(0.2, 5);

    // Undo unwinds the LAST edit (coneOuterGain) — DOC-015-style per-field coalescing keeps each field's own edits separate.
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("inspector.audio.cone-outer-gain")).toHaveValue("0");
  });

  test("Sources sub-list: gain/playback-rate/loop/autoplay edit extensions.KHR_audio_emitter.sources[0], independent of the emitter's own gain (UX-420)", async ({
    page
  }) => {
    await expect(page.getByTestId("inspector.audio.sources")).toBeVisible();
    await expect(page.getByTestId("inspector.audio.source.0.clip")).not.toHaveText("no clip");

    await page.getByTestId("inspector.audio.source.0.playback-rate").fill("1.5");
    await page.getByTestId("inspector.audio.source.0.loop").check();
    await page.getByTestId("inspector.audio.source.0.autoplay").check();

    const json = (await documentJson(page)) as EmitterDoc;
    const source = json.extensions.KHR_audio_emitter.sources[0];
    expect(source.playbackRate).toBeCloseTo(1.5, 5);
    expect(source.loop).toBe(true);
    expect(source.autoplay).toBe(true);
    expect(json.extensions.KHR_audio_emitter.emitters[0].gain).toBe(0.8); // emitter's own gain untouched -- separate root array.
  });

  test("Sources sub-list: Source Type toggle switches source 0 between Clip and Oscillator, authoring/clearing extensions.KHR_audio_graph.oscillator (r2, specs/ux-inspector.md UX-424)", async ({
    page
  }) => {
    await expect(page.getByTestId("inspector.audio.source.0.type-select")).toHaveValue("clip");
    await expect(page.getByTestId("inspector.audio.source.0.clip")).toBeVisible();
    await expect(page.getByTestId("inspector.audio.source.0.playback-rate")).toBeVisible();
    await expect(page.getByTestId("inspector.audio.source.0.oscillator.frequency")).toHaveCount(0);

    await page.getByTestId("inspector.audio.source.0.type-select").selectOption("oscillator");

    // r2: switching to Oscillator drops `audio`, hides Playback Rate/Loop (declared-ignored for an
    // oscillator source), and reveals the oscillator payload fields, schema-valid immediately (a
    // sensible default waveform/frequency, no forced-in `periodicWave`).
    await expect(page.getByTestId("inspector.audio.source.0.clip")).toHaveCount(0);
    await expect(page.getByTestId("inspector.audio.source.0.playback-rate")).toHaveCount(0);
    await expect(page.getByTestId("inspector.audio.source.0.loop")).toHaveCount(0);
    await expect(page.getByTestId("inspector.audio.source.0.oscillator.type")).toHaveValue("sine");
    await expect(page.getByTestId("inspector.audio.source.0.oscillator.frequency")).toHaveValue("440");
    await expect(page.getByTestId("inspector.audio.source.0.oscillator.periodicWave.real")).toHaveCount(0); // hidden until type is "custom"

    type OscillatorSourceDoc = {
      extensions: { KHR_audio_emitter: { sources: Array<{ audio?: number; extensions?: { KHR_audio_graph?: { oscillator?: { type?: string; frequency?: number; periodicWave?: unknown } } } }> } };
    };
    let json = (await documentJson(page)) as OscillatorSourceDoc;
    let oscillator = json.extensions.KHR_audio_emitter.sources[0].extensions?.KHR_audio_graph?.oscillator;
    expect(json.extensions.KHR_audio_emitter.sources[0].audio).toBeUndefined();
    expect(oscillator).toEqual({ type: "sine", frequency: 440, detune: 0, pulseWidth: 0.5 });

    // Editing frequency and switching the waveform to "custom" reveals the periodicWave real/imag textareas.
    await page.getByTestId("inspector.audio.source.0.oscillator.frequency").fill("880");
    await page.getByTestId("inspector.audio.source.0.oscillator.type").selectOption("custom");
    await expect(page.getByTestId("inspector.audio.source.0.oscillator.periodicWave.real")).toBeVisible();
    await page.getByTestId("inspector.audio.source.0.oscillator.periodicWave.real").fill("0, 1");
    await page.getByTestId("inspector.audio.source.0.oscillator.periodicWave.imag").fill("0, 0");
    await page.getByTestId("inspector.audio.source.0.oscillator.periodicWave.imag").blur();

    json = (await documentJson(page)) as OscillatorSourceDoc;
    oscillator = json.extensions.KHR_audio_emitter.sources[0].extensions?.KHR_audio_graph?.oscillator;
    expect(oscillator?.frequency).toBe(880);
    expect(oscillator?.type).toBe("custom");
    expect(oscillator?.periodicWave).toEqual({ real: [0, 1], imag: [0, 0] });

    // Switching back to Clip restores the clip-shaped fields and drops the oscillator extension entirely.
    await page.getByTestId("inspector.audio.source.0.type-select").selectOption("clip");
    await expect(page.getByTestId("inspector.audio.source.0.clip")).toBeVisible();
    json = (await documentJson(page)) as OscillatorSourceDoc;
    const clipSource = json.extensions.KHR_audio_emitter.sources[0];
    expect(clipSource.audio).toBe(0);
    expect(clipSource.extensions?.KHR_audio_graph?.oscillator).toBeUndefined();
  });

  test("Audition stays real (gesture-gates AudioHost.init(), reports an active emitter) after editing positional physics", async ({ page }) => {
    await page.getByTestId("inspector.audio.distance-model").selectOption("linear");
    await page.getByTestId("inspector.audio.gain").fill("0.3");

    await expect(page.getByTestId("inspector.audio.audition")).toBeEnabled();
    await page.getByTestId("inspector.audio.audition").click(); // AH-001 gesture.
    await expect.poll(() => audioDiagnostics(page)).toContain("running");
    expect(await audioDiagnostics(page)).toContain("1 emitter");
  });
});

test.describe("audio authoring: node placement follows a positional emitter (specs/ux-inspector.md UX-423)", () => {
  test("an editor-driven Position edit (the same SceneEdit.setTransform a gizmo-commit dispatches) re-derives the emitter's world position via the reload path", async ({
    page
  }) => {
    await importInspectorFixture(page);
    await page.getByTestId("scene-tree.row.4").click(); // "Speaker" -- positional, no translation in the fixture.

    // AudioContext must exist before WebAudioHost builds any emitter instance/panner (AH-001) -- Audition is the gesture.
    await page.getByTestId("inspector.audio.audition").click();
    await expect.poll(() => audioDiagnostics(page)).toContain("running");
    await expect.poll(() => emitterPosition(page, 0)).toEqual([0, 0, 0]);

    // Editing the Transform section's Position field dispatches the exact
    // same SceneEdit.setTransform command a gizmo drag's "commit" phase
    // does (Viewport.tsx's own onGizmoChange handler) -- equally valid
    // confirmation of the attachAudioHost reload-on-edit mechanism without
    // simulating a flake-prone real 3D drag gesture.
    await page.getByTestId("inspector.transform.position-x").fill("7");
    await page.getByTestId("inspector.transform.position-y").fill("2");

    await expect.poll(() => emitterPosition(page, 0)).toEqual([7, 2, 0]);

    const json = (await documentJson(page)) as { nodes: Array<{ translation?: number[] }> };
    expect(json.nodes[4].translation).toEqual([7, 2, 0]);
  });
});

test.describe("audio authoring: KHR_audio_environment zone/reverb + scene bindings (specs/ux-inspector.md UX-421)", () => {
  test.beforeEach(async ({ page }) => {
    await importInspectorFixture(page);
  });

  test("an existing zone's Environment/Reverb Preset/Mix/Shape/Blend Distance/Priority fields edit the document", async ({ page }) => {
    await page.getByTestId("scene-tree.row.5").click(); // "Zone"
    await expect(page.getByTestId("inspector.audio-environment.section")).toBeVisible();
    await expect(page.getByTestId("inspector.audio-environment.reverb-preset")).toHaveValue("concertHall");
    await expect(page.getByTestId("inspector.audio-environment.zone-radius")).toHaveValue("5");

    await page.getByTestId("inspector.audio-environment.reverb-preset").selectOption("cathedral");
    await page.getByTestId("inspector.audio-environment.zone-radius").fill("12");
    await page.getByTestId("inspector.audio-environment.blend-distance").fill("3");
    await page.getByTestId("inspector.audio-environment.priority").fill("2");

    const json = (await documentJson(page)) as EmitterDoc;
    expect(json.extensions.KHR_audio_environment!.environments![0].reverb!.preset).toBe("cathedral");
    expect(json.nodes[5].extensions!.KHR_audio_environment!.shape!.radius).toBe(12);
    expect(json.nodes[5].extensions!.KHR_audio_environment!.blendDistance).toBe(3);
    expect(json.nodes[5].extensions!.KHR_audio_environment!.priority).toBe(2);
  });

  test("scene default environment/active listener selects reflect and edit the scene's own bindings", async ({ page }) => {
    await page.getByTestId("scene-tree.row.5").click(); // "Zone" -- any node shows the scene-wide selects.
    await expect(page.getByTestId("inspector.audio-environment.scene-environment")).toHaveValue("0");
    await expect(page.getByTestId("inspector.audio-environment.scene-listener")).toHaveValue("0");

    await page.getByTestId("inspector.audio-environment.scene-environment").selectOption("");

    const json = (await documentJson(page)) as EmitterDoc;
    expect(json.scenes[0].extensions?.KHR_audio_environment?.environment).toBeUndefined();
    expect(json.scenes[0].extensions?.KHR_audio_environment?.activeListener).toBe(0); // untouched.
  });

  test("Cam's Listener row shows and edits gain/spatializationModel against the bound listener registry entry (UX-422)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.3").click(); // "Cam" -- bound as the listener in the fixture.
    await expect(page.getByTestId("inspector.camera.listener-gain")).toBeVisible();
    await expect(page.getByTestId("inspector.camera.bind-listener")).toHaveCount(0); // already bound -- no "bind" picker.

    await page.getByTestId("inspector.camera.listener-gain").evaluate((el, val) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, val);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, "0.4");
    await page.getByTestId("inspector.camera.listener-spatialization-model").selectOption("equalpower");

    const json = (await documentJson(page)) as EmitterDoc;
    const listener = json.extensions.KHR_audio_environment!.listeners![0];
    expect(listener.gain).toBeCloseTo(0.4, 5);
    expect(listener.spatializationModel).toBe("equalpower");
  });
});

test.describe("audio authoring: no-environment empty state offers Add environment (specs/ux-inspector.md UX-421)", () => {
  test("a document with no KHR_audio_environment shows the empty state; Add environment scaffolds the extension", async ({ page }) => {
    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");

    await page.getByTestId("scene-tree.row.1").click(); // "Widget" -- no audio content of its own at all.
    await expect(page.getByTestId("inspector.audio-environment.empty")).toBeVisible();
    await expect(page.getByTestId("inspector.audio-environment.section")).toContainText("No audio environment");

    await page.getByTestId("inspector.audio-environment.add-environment").click();
    await expect(page.getByTestId("inspector.audio-environment.empty")).toHaveCount(0);
    await expect(page.getByTestId("inspector.audio-environment.add-zone")).toBeVisible();

    const json = (await documentJson(page)) as { extensions: { KHR_audio_environment?: { environments?: unknown[] } }; extensionsUsed: string[] };
    expect(json.extensions.KHR_audio_environment?.environments?.length).toBe(1);
    expect(json.extensionsUsed).toContain("KHR_audio_environment");
  });
});
