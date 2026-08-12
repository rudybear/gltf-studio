import { test, expect, type Page } from "@playwright/test";
import {
  multiFileFixtureGltfOnly,
  MULTI_FILE_BIN_NAME,
  MULTI_FILE_GLTF_NAME,
  MULTI_FILE_WAV_NAME
} from "./multi-file-fixture.js";

/**
 * Regression coverage for the reported "when I load drumkit — it doesn't see
 * the files in the same folder" bug (specs/ux-shell.md UX-117/UX-118): a
 * plain `<input type="file">`/`showOpenFilePicker` pick genuinely cannot
 * read a picked file's siblings for security reasons, so a lone `.gltf`
 * (UX-116's existing failure) now also opens a recovery dialog
 * (`missing-files.dialog`) instead of being a dead end.
 *
 * `window.showDirectoryPicker`/`window.showOpenFilePicker` ARE real,
 * feature-detectable functions in Playwright's bundled Chromium serving this
 * app over http://localhost (confirmed by hand: `typeof
 * window.showDirectoryPicker === "function"` on the built app, `"undefined"`
 * only on an opaque-origin page like `about:blank`) — but actually invoking
 * the real `showDirectoryPicker()` in headless mode immediately rejects with
 * `AbortError` (no real OS picker to drive, confirmed by hand), which is
 * indistinguishable from a user cancelling. So:
 *   - "the button is present" is asserted directly (real feature detection,
 *     no stubbing needed).
 *   - "granting access resolves the files" stubs `window.showDirectoryPicker`
 *     via `addInitScript` with an in-memory fake backed by real `File`
 *     objects, standing in for the native picker exactly the way this app's
 *     own `DirectoryHandleLike` (packages/storage/src/fs-handle-types.ts)
 *     is documented to accept either a real handle or a structurally
 *     compatible double — this exercises the app's OWN resolution code for
 *     real, only the native OS dialog itself is unautomatable headlessly.
 *   - "unsupported browser" (Firefox/Safari, as of this writing) is
 *     exercised by deleting `window.showDirectoryPicker` via `addInitScript`
 *     before load — this doesn't run an actual Firefox/Safari (this repo's
 *     e2e suite is Chromium-only, see playwright.config.ts), it only proves
 *     THIS app's own feature-detection/fallback-copy branch is correct when
 *     the API is absent, which is the part under this app's control.
 */

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Stubs `window.showDirectoryPicker` with an in-memory, flat, granted
 * directory handle backed by real `File` objects reconstructed in-page from
 * base64 -- structurally satisfies `DirectoryHandleLike`
 * (fs-handle-types.ts: `keys()`, `getFileHandle()`, `getDirectoryHandle()`)
 * without needing a real native picker. Must run via `addInitScript` BEFORE
 * `page.goto` so the app's own module-load-time nothing (this app reads
 * `window.showDirectoryPicker` at CALL time, not import time, but
 * `addInitScript` before navigation is the simplest way to guarantee it's
 * present before React ever renders the dialog's feature-detection).
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
      name: "drum-kit",
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

async function deleteDirectoryPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });
}

test.describe("missing-files dialog (UX-117)", () => {
  test("a single .gltf pick with unresolved references opens the dialog, naming every missing file, with the folder-grant button present", async ({
    page
  }) => {
    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', multiFileFixtureGltfOnly());

    const dialog = page.getByTestId("missing-files.dialog");
    await expect(dialog).toBeVisible();
    const listText = await page.getByTestId("missing-files.list").textContent();
    expect(listText).toContain(MULTI_FILE_BIN_NAME);
    expect(listText).toContain(MULTI_FILE_WAV_NAME);

    // Real feature detection (not stubbed) -- Playwright's bundled Chromium
    // serving this app over http genuinely has `showDirectoryPicker`.
    await expect(page.getByTestId("missing-files.grant-folder")).toBeVisible();
    await expect(page.getByTestId("missing-files.hint-folder")).toContainText(MULTI_FILE_GLTF_NAME);

    // The UX-116 toast still fires too -- UX-117 is additive, not a replacement.
    await expect(page.getByTestId("toast")).toBeVisible();
  });

  test("Cancel closes the dialog without importing anything, leaving the previously-open document untouched", async ({ page }) => {
    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', multiFileFixtureGltfOnly());
    await expect(page.getByTestId("missing-files.dialog")).toBeVisible();

    await page.getByTestId("missing-files.cancel").click();
    await expect(page.getByTestId("missing-files.dialog")).toBeHidden();
    // No document was ever open in this test -- the import genuinely never happened.
    await expect(page.getByTestId("topbar.project-name")).toHaveText("Untitled Project");
  });

  test("granting folder access resolves every missing file and completes the import, closing the dialog", async ({ page }) => {
    const files = multiFileFixtureGltfOnly(); // just the .gltf -- both external refs unresolved.
    const complete = (await import("./multi-file-fixture.js")).multiFileFixtureComplete();
    const binPayload = complete.find((f) => f.name === MULTI_FILE_BIN_NAME)!;
    const wavPayload = complete.find((f) => f.name === MULTI_FILE_WAV_NAME)!;

    await stubDirectoryPicker(page, {
      [MULTI_FILE_BIN_NAME]: base64(binPayload.buffer),
      [MULTI_FILE_WAV_NAME]: base64(wavPayload.buffer),
      "unrelated-readme.txt": base64(Buffer.from("not part of the asset"))
    });

    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', files);
    await expect(page.getByTestId("missing-files.dialog")).toBeVisible();

    await page.getByTestId("missing-files.grant-folder").click();

    await expect(page.getByTestId("missing-files.dialog")).toBeHidden();
    await expect(page.getByTestId("topbar.project-name")).toHaveText("multi-file-scene");
    await expect(page.getByTestId("scene-tree.list").locator(".tree-row")).toHaveCount(2);
  });

  test("granting a folder that still doesn't have every file updates the missing list in place and keeps the dialog open", async ({ page }) => {
    const files = multiFileFixtureGltfOnly();
    const complete = (await import("./multi-file-fixture.js")).multiFileFixtureComplete();
    const binPayload = complete.find((f) => f.name === MULTI_FILE_BIN_NAME)!;

    // Only ONE of the two missing files lives in the granted folder.
    await stubDirectoryPicker(page, { [MULTI_FILE_BIN_NAME]: base64(binPayload.buffer) });

    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', files);
    await expect(page.getByTestId("missing-files.dialog")).toBeVisible();

    await page.getByTestId("missing-files.grant-folder").click();

    // Still open -- not closed/discarded on partial failure -- and the list
    // narrows to just what's still actually missing.
    await expect(page.getByTestId("missing-files.dialog")).toBeVisible();
    const listText = await page.getByTestId("missing-files.list").textContent();
    expect(listText).not.toContain(MULTI_FILE_BIN_NAME);
    expect(listText).toContain(MULTI_FILE_WAV_NAME);
  });

  test("when window.showDirectoryPicker is unsupported, the dialog explains multi-select instead and hides the grant-folder button", async ({
    page
  }) => {
    await deleteDirectoryPicker(page);
    await page.goto("./");
    await expect(page.evaluate(() => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker)).resolves.toBe(
      "undefined"
    );

    await page.setInputFiles('[data-testid="topbar.import-input"]', multiFileFixtureGltfOnly());
    await expect(page.getByTestId("missing-files.dialog")).toBeVisible();
    await expect(page.getByTestId("missing-files.grant-folder")).toHaveCount(0);
    const hint = await page.getByTestId("missing-files.hint-multiselect").textContent();
    expect(hint).toContain(MULTI_FILE_BIN_NAME);
    expect(hint).toContain(MULTI_FILE_WAV_NAME);
  });
});
