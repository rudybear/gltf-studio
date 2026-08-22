import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { buildInspectorFixtureBytes, INSPECTOR_FIXTURE_NAME } from "./inspector-fixture.js";
import { sineBeepWavBytes } from "./wav-fixture.js";

/**
 * Clip management + source/emitter lifecycle (Track A audio task):
 * specs/document-model.md DOC-066, specs/ux-inspector.md UX-425..428,
 * specs/ux-scene-tree.md UX-218..222. Builds on `inspector-fixture.ts`'s
 * existing "Speaker" node (index 4, `KHR_audio_emitter.emitter: 0`, one
 * embedded clip `audio[0]`, one clip source `sources[0]`) rather than a new
 * fixture — every test here only ever APPENDS new clips/sources/emitters,
 * never disturbing the indices `audio-authoring.spec.ts`/`inspector.spec.ts`
 * already pin against this same fixture.
 */

async function importFixture(page: Page): Promise<void> {
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

type FixtureDocJson = {
  extensions: {
    KHR_audio_emitter: {
      audio: Array<{ uri?: string; bufferView?: number; mimeType?: string; name?: string }>;
      sources: Array<{ audio?: number }>;
      emitters: Array<{ sources?: number[] }>;
    };
  };
  nodes: Array<{ extensions?: { KHR_audio_emitter?: { emitter?: number; emitters?: number[] } } }>;
};

/**
 * Stubs `window.showDirectoryPicker` with an in-memory, flat, granted
 * directory handle backed by real `File` objects — the SAME pattern
 * `e2e/missing-files-dialog.spec.ts`'s own `stubDirectoryPicker` helper
 * establishes (a real native picker can't be automated headlessly; this
 * exercises the app's own resolution code for real).
 */
async function stubDirectoryPicker(page: Page, files: Record<string, string>): Promise<void> {
  await page.addInitScript((filesB64: Record<string, string>) => {
    const store = new Map<string, Uint8Array>();
    for (const [name, b64] of Object.entries(filesB64)) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      store.set(name, bytes);
    }
    const dirHandle = {
      kind: "directory",
      name: "audio-folder",
      async getFileHandle(name: string) {
        const bytes = store.get(name);
        if (!bytes) {
          const err = new Error(`"${name}" not found.`);
          (err as { name?: string }).name = "NotFoundError";
          throw err;
        }
        return {
          kind: "file",
          name,
          async getFile() {
            return new File([bytes], name);
          },
          async createWritable(): Promise<never> {
            throw new Error("not implemented in this fake");
          }
        };
      },
      async getDirectoryHandle(): Promise<never> {
        const err = new Error("no subdirectories in this fake");
        (err as { name?: string }).name = "NotFoundError";
        throw err;
      },
      async removeEntry() {},
      async *keys() {
        for (const name of store.keys()) yield name;
      },
      async queryPermission() {
        return "granted";
      },
      async requestPermission() {
        return "granted";
      }
    };
    (window as unknown as { showDirectoryPicker: () => Promise<typeof dirHandle> }).showDirectoryPicker = async () => dirHandle;
  }, files);
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

test.describe("Audio Clips tab: import (embedded) + assign + audition (UX-218/UX-220/UX-425)", () => {
  test("importing a real wav embeds it, assigning it to a source rebinds playback, and it survives export/reimport", async ({ page }) => {
    await importFixture(page);

    await page.getByTestId("asset-browser.tab.audio-clips").click();
    await expect(page.getByTestId("asset-browser.audio-clips.0")).toBeVisible(); // the fixture's own embedded clip.
    await expect(page.getByTestId("asset-browser.audio-clips.0.badge")).toHaveText("Embedded");

    const wav = sineBeepWavBytes();
    await page.setInputFiles('[data-testid="asset-browser.audio-clips.import-input"]', {
      name: "beep.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from(wav)
    });

    await expect(page.getByTestId("asset-browser.audio-clips.1")).toBeVisible();
    await expect(page.getByTestId("asset-browser.audio-clips.1.badge")).toHaveText("Embedded");

    let json = (await documentJson(page)) as FixtureDocJson;
    expect(json.extensions.KHR_audio_emitter.audio).toHaveLength(2);
    expect(json.extensions.KHR_audio_emitter.audio[1].bufferView).not.toBeUndefined();

    // Reassign the "Speaker" node's source (sources[0]) to the newly-imported clip (audio[1]).
    await page.getByTestId("scene-tree.row.4").click(); // "Speaker"
    await page.getByTestId("inspector.audio.source.0.clip").selectOption("1");
    json = (await documentJson(page)) as FixtureDocJson;
    expect(json.extensions.KHR_audio_emitter.sources[0].audio).toBe(1);

    // Audition fires against the reassigned clip.
    await expect.poll(() => audioDiagnostics(page)).toBe("audio idle");
    await page.getByTestId("inspector.audio.audition").click();
    await expect.poll(() => audioDiagnostics(page)).toContain("running");

    // Export + reimport: the newly-embedded clip round-trips (byte-preserving save, DOC-034-style).
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("topbar.export").click()]);
    const downloadPath = await download.path();
    await page.setInputFiles('[data-testid="topbar.import-input"]', {
      name: download.suggestedFilename(),
      mimeType: "model/gltf-binary",
      buffer: readFileSync(downloadPath!)
    });
    await expect(page.getByTestId("topbar.project-name")).toHaveText("inspector-fixture");

    json = (await documentJson(page)) as FixtureDocJson;
    expect(json.extensions.KHR_audio_emitter.audio).toHaveLength(2);
    expect(json.extensions.KHR_audio_emitter.sources[0].audio).toBe(1);
  });
});

test.describe("Audio Clips tab: add-by-reference, unresolved honesty, and folder-grant resolution (UX-218/UX-219)", () => {
  test("a referenced clip starts Unresolved (no fake playback), then resolves once a matching folder is granted", async ({ page }) => {
    const wav = sineBeepWavBytes();
    await stubDirectoryPicker(page, { "tone.wav": base64(wav) });
    await importFixture(page);

    await page.getByTestId("asset-browser.tab.audio-clips").click();
    await page.getByTestId("asset-browser.audio-clips.add-reference").click();
    await page.getByTestId("asset-browser.audio-clips.reference-uri").fill("tone.wav");
    await page.getByTestId("asset-browser.audio-clips.reference-confirm").click();

    await expect(page.getByTestId("asset-browser.audio-clips.1.badge")).toHaveText("Referenced");
    await expect(page.getByTestId("asset-browser.audio-clips.1.unresolved")).toBeVisible();
    await expect(page.getByTestId("asset-browser.audio-clips.1.preview")).toBeDisabled();

    let json = (await documentJson(page)) as FixtureDocJson;
    expect(json.extensions.KHR_audio_emitter.audio[1].uri).toBe("tone.wav");

    // Grant folder access (stubbed picker resolves "tone.wav" for real).
    await page.getByTestId("asset-browser.audio-clips.grant-folder").click();
    await expect(page.getByTestId("asset-browser.audio-clips.1.unresolved")).toHaveCount(0);
    await expect(page.getByTestId("asset-browser.audio-clips.1.preview")).toBeEnabled();

    // Embed action turns it into a bufferView clip at the SAME index.
    await page.getByTestId("asset-browser.audio-clips.1.embed").click();
    await expect(page.getByTestId("asset-browser.audio-clips.1.badge")).toHaveText("Embedded");
    json = (await documentJson(page)) as FixtureDocJson;
    expect(json.extensions.KHR_audio_emitter.audio[1].uri).toBeUndefined();
    expect(json.extensions.KHR_audio_emitter.audio[1].bufferView).not.toBeUndefined();
  });
});

test.describe("Audio Clips tab: delete-blocked-when-used (UX-220, mirrors the Variables panel policy)", () => {
  test("a used clip's delete control is disabled with an exact usage count; an unused one deletes freely", async ({ page }) => {
    await importFixture(page);
    await page.getByTestId("asset-browser.tab.audio-clips").click();

    // audio[0] is used by sources[0] (the fixture's own "Speaker" binding) — blocked.
    await expect(page.getByTestId("asset-browser.audio-clips.0.delete")).toBeDisabled();
    const title = await page.getByTestId("asset-browser.audio-clips.0.delete").getAttribute("title");
    expect(title).toContain("Used by 1 source");

    // A freshly-imported, never-assigned clip is unused — deletable.
    const wav = sineBeepWavBytes();
    await page.setInputFiles('[data-testid="asset-browser.audio-clips.import-input"]', {
      name: "unused.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from(wav)
    });
    await expect(page.getByTestId("asset-browser.audio-clips.1")).toBeVisible();
    await expect(page.getByTestId("asset-browser.audio-clips.1.delete")).toBeEnabled();
    await page.getByTestId("asset-browser.audio-clips.1.delete").click();
    await expect(page.getByTestId("asset-browser.audio-clips.1")).toHaveCount(0);

    const json = (await documentJson(page)) as FixtureDocJson;
    expect(json.extensions.KHR_audio_emitter.audio).toHaveLength(1);
  });
});

test.describe("Multi-emitter-per-node + source lifecycle (UX-426/UX-425, DOC-066)", () => {
  test("adding a second emitter to a node, then removing one, is undoable and never collapses back to the singular field prematurely", async ({
    page
  }) => {
    await importFixture(page);
    await page.getByTestId("scene-tree.row.4").click(); // "Speaker" — starts with exactly ONE emitter.
    await expect(page.getByTestId("inspector.audio.0.remove-emitter")).toBeVisible();
    await expect(page.getByTestId("inspector.audio.1.remove-emitter")).toHaveCount(0);

    await page.getByTestId("inspector.audio.add-emitter").click();
    await expect(page.getByTestId("inspector.audio.1.remove-emitter")).toBeVisible();

    let json = (await documentJson(page)) as FixtureDocJson;
    expect(json.nodes[4].extensions?.KHR_audio_emitter?.emitters).toEqual([0, 1]);
    expect(json.nodes[4].extensions?.KHR_audio_emitter?.emitter).toBeUndefined();

    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    json = (await documentJson(page)) as FixtureDocJson;
    expect(json.nodes[4].extensions?.KHR_audio_emitter?.emitter).toBe(0);
    await page.getByTestId("topbar.redo").click();

    // Remove emitter 0, leaving emitter 1 as the sole (still array-valued) binding.
    await page.getByTestId("inspector.audio.0.remove-emitter").click();
    json = (await documentJson(page)) as FixtureDocJson;
    expect(json.nodes[4].extensions?.KHR_audio_emitter?.emitters).toEqual([1]);
  });

  test("adding and removing a source on an emitter is undoable and leaves the clip registry untouched", async ({ page }) => {
    await importFixture(page);
    await page.getByTestId("scene-tree.row.4").click(); // "Speaker"

    await page.getByTestId("inspector.audio.sources.add-oscillator").click();
    await expect(page.getByTestId("inspector.audio.source.1")).toBeVisible();
    let json = (await documentJson(page)) as FixtureDocJson;
    expect(json.extensions.KHR_audio_emitter.sources).toHaveLength(2);
    expect(json.extensions.KHR_audio_emitter.emitters[0].sources).toEqual([0, 1]);

    await page.getByTestId("inspector.audio.source.1.remove").click();
    await expect(page.getByTestId("inspector.audio.source.1")).toHaveCount(0);
    json = (await documentJson(page)) as FixtureDocJson;
    // Membership-only removal (DOC-050 orphan policy): the source registry entry survives.
    expect(json.extensions.KHR_audio_emitter.sources).toHaveLength(2);
    expect(json.extensions.KHR_audio_emitter.emitters[0].sources).toEqual([0]);

    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    json = (await documentJson(page)) as FixtureDocJson;
    expect(json.extensions.KHR_audio_emitter.emitters[0].sources).toEqual([0, 1]);
  });
});

test.describe("Add menu: Audio Emitter submenu wires an existing clip (UX-222, DOC-062's opts.audioIndex at last)", () => {
  test("choosing an existing clip from the submenu binds the new emitter to it instead of a fresh placeholder", async ({ page }) => {
    await importFixture(page);
    await page.getByTestId("scene-tree.add").click();
    await page.getByTestId("scene-tree.add-menu.audio-emitter").click();
    await expect(page.getByTestId("scene-tree.add-menu.audio-emitter.clip.0")).toBeVisible();
    await page.getByTestId("scene-tree.add-menu.audio-emitter.clip.0").click();

    const json = (await documentJson(page)) as FixtureDocJson;
    const newNode = json.nodes[json.nodes.length - 1];
    const newEmitterIndex = newNode.extensions?.KHR_audio_emitter?.emitter;
    expect(newEmitterIndex).not.toBeUndefined();
    const newEmitter = json.extensions.KHR_audio_emitter.emitters[newEmitterIndex!];
    const newSourceIndex = newEmitter.sources![0];
    expect(json.extensions.KHR_audio_emitter.sources[newSourceIndex].audio).toBe(0); // bound to the EXISTING clip, not a fresh one.
    expect(json.extensions.KHR_audio_emitter.audio).toHaveLength(1); // no new clip generated.
  });
});
