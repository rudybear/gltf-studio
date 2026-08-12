import { test, expect, type Page } from "@playwright/test";
import { multiFileFixtureComplete, MULTI_FILE_BIN_NAME, MULTI_FILE_GLTF_NAME, MULTI_FILE_WAV_NAME } from "./multi-file-fixture.js";

/**
 * Regression coverage for specs/ux-shell.md UX-118: the "it just sees the
 * files" flow -- dropping an entire FOLDER (not a flat multi-file
 * selection) resolves every file in it via `DataTransferItem
 * .webkitGetAsEntry()`'s directory-entry traversal (`file-drop.ts`), with NO
 * follow-up dialog needed when everything the `.gltf` references is found
 * inside the dropped folder.
 *
 * A real OS drag-and-drop of a folder can't be scripted by Playwright (no
 * CDP hook for it, unlike `<input type="file">`'s `setInputFiles`), so this
 * dispatches a synthetic `drop` `Event` with a hand-built `DataTransfer`-like
 * object whose `items` return fake `FileSystemEntry`s backed by real `File`
 * objects (constructed in-page from base64) -- the same file-and-directory
 * -entries API shape a real browser drag supplies, and exactly what
 * `file-drop.ts`'s `filesFromDataTransfer` consumes; only the native OS
 * drag gesture itself is what's unautomatable, not this app's own traversal
 * code, which runs for real here.
 */

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

interface DropFile {
  name: string;
  base64: string;
}

/**
 * Dispatches a synthetic `dragover` + `drop` at `selector`, carrying a
 * single dropped folder (`folderName`) containing `files` flat inside it
 * (matches the real drum-kit asset's own shape: one `.gltf` + siblings, no
 * further nesting) -- `Object.defineProperty` overrides the dispatched
 * (plain, non-`DragEvent`) `Event`'s `dataTransfer` getter, the standard
 * technique for simulating a file/folder drop with a browser that won't let
 * script construct a real populated `DataTransfer`.
 */
async function dropFolderOnto(page: Page, selector: string, folderName: string, files: DropFile[]): Promise<void> {
  await page.evaluate(
    ({ selector, folderName, files }) => {
      function bytesFromBase64(b64: string): Uint8Array {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      function makeFileEntry(name: string, bytes: Uint8Array) {
        return {
          isFile: true,
          isDirectory: false,
          name,
          file(success: (f: File) => void) {
            success(new File([bytes], name));
          }
        };
      }
      function makeDirEntry(name: string, children: unknown[]) {
        let read = false;
        return {
          isFile: false,
          isDirectory: true,
          name,
          createReader() {
            return {
              readEntries(success: (entries: unknown[]) => void) {
                if (read) {
                  success([]);
                  return;
                }
                read = true;
                success(children);
              }
            };
          }
        };
      }
      const childEntries = files.map((f) => makeFileEntry(f.name, bytesFromBase64(f.base64)));
      const rootEntry = makeDirEntry(folderName, childEntries);
      const fakeDataTransfer = {
        types: ["Files"],
        files: [] as File[],
        items: [{ kind: "file", webkitGetAsEntry: () => rootEntry }]
      };
      const target = document.querySelector(selector);
      if (!target) throw new Error(`drop target "${selector}" not found`);
      const dragOverEvt = new Event("dragover", { bubbles: true, cancelable: true });
      Object.defineProperty(dragOverEvt, "dataTransfer", { value: fakeDataTransfer });
      target.dispatchEvent(dragOverEvt);
      const dropEvt = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvt, "dataTransfer", { value: fakeDataTransfer });
      target.dispatchEvent(dropEvt);
    },
    { selector, folderName, files }
  );
}

function dropFilesFromFixture(): DropFile[] {
  return multiFileFixtureComplete().map((f) => ({ name: f.name, base64: base64(f.buffer) }));
}

test.describe("whole-folder drag-and-drop (UX-118)", () => {
  test("dropping a folder onto the Import button imports every file it contains, with no follow-up dialog", async ({ page }) => {
    await page.goto("./");
    await dropFolderOnto(page, '[data-testid="topbar.import"]', "drum-kit", dropFilesFromFixture());

    await expect(page.getByTestId("topbar.project-name")).toHaveText("multi-file-scene");
    await expect(page.getByTestId("scene-tree.list").locator(".tree-row")).toHaveCount(2);
    await expect(page.getByTestId("missing-files.dialog")).toHaveCount(0);
  });

  test("dropping a folder anywhere else on the window (not just the Import button) also imports it", async ({ page }) => {
    await page.goto("./");
    // #app is the outermost mounted element -- nowhere near the Import
    // button -- proving this is a whole-window drop target (App.tsx), not
    // just TopBar's own button-level handler.
    await dropFolderOnto(page, "#app", "drum-kit", dropFilesFromFixture());

    await expect(page.getByTestId("topbar.project-name")).toHaveText("multi-file-scene");
    await expect(page.getByTestId("scene-tree.list").locator(".tree-row")).toHaveCount(2);
  });

  test("a folder missing one of the .gltf's referenced siblings still opens the missing-files dialog (UX-117), same as a flat selection would", async ({
    page
  }) => {
    await page.goto("./");
    const incomplete = dropFilesFromFixture().filter((f) => f.name !== MULTI_FILE_WAV_NAME);
    await dropFolderOnto(page, '[data-testid="topbar.import"]', "drum-kit", incomplete);

    await expect(page.getByTestId("missing-files.dialog")).toBeVisible();
    const listText = await page.getByTestId("missing-files.list").textContent();
    expect(listText).toContain(MULTI_FILE_WAV_NAME);
    expect(listText).not.toContain(MULTI_FILE_BIN_NAME);
    expect(listText).not.toContain(MULTI_FILE_GLTF_NAME);
  });

  test("a drop landing on the Import button does not ALSO get handled a second time by the window-level handler", async ({ page }) => {
    await page.goto("./");
    await dropFolderOnto(page, '[data-testid="topbar.import"]', "drum-kit", dropFilesFromFixture());
    await expect(page.getByTestId("topbar.project-name")).toHaveText("multi-file-scene");

    // A double-handled drop still resolves to the SAME final document
    // (import replaces state wholesale, so scene-tree row count alone can't
    // tell single from double) -- but `importGlb` logs one "Imported …" line
    // per actual call, so the Console tab's line count is the real tell.
    await page.getByTestId("dock.tab.console").click();
    const importedLines = page.locator('[data-testid^="console.line."]', { hasText: "Imported" });
    await expect(importedLines).toHaveCount(1);
  });
});

/**
 * Regression coverage for UX-118's other half: when `window.showOpenFilePicker`
 * is available, clicking Import uses it directly instead of the hidden
 * `topbar.import-input` -- one fewer step than click -> hidden `<input>` ->
 * OS dialog. Stubs the picker the same way `missing-files-dialog.spec.ts`
 * stubs `showDirectoryPicker` (a real native multi-select dialog can't be
 * scripted headlessly either): a fake `FileSystemFileHandle[]` whose
 * `getFile()` returns real `File` objects reconstructed from base64.
 */
test.describe("showOpenFilePicker Import button (UX-118)", () => {
  test("clicking Import uses showOpenFilePicker directly and imports the files it returns, with no <input> dialog involved", async ({
    page
  }) => {
    const files = dropFilesFromFixture();
    await page.addInitScript((filesArg: DropFile[]) => {
      function bytesFromBase64(b64: string): Uint8Array {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      const handles = filesArg.map((f) => ({
        async getFile() {
          return new File([bytesFromBase64(f.base64)], f.name);
        }
      }));
      (window as unknown as { showOpenFilePicker: () => Promise<typeof handles> }).showOpenFilePicker = async () => handles;
    }, files);

    await page.goto("./");
    await page.getByTestId("topbar.import").click();

    await expect(page.getByTestId("topbar.project-name")).toHaveText("multi-file-scene");
    await expect(page.getByTestId("scene-tree.list").locator(".tree-row")).toHaveCount(2);
  });

  test("a single .gltf picked via showOpenFilePicker with unresolved references still surfaces the UX-117 missing-files dialog", async ({
    page
  }) => {
    const gltfOnly = dropFilesFromFixture().filter((f) => f.name === MULTI_FILE_GLTF_NAME);
    await page.addInitScript((filesArg: DropFile[]) => {
      function bytesFromBase64(b64: string): Uint8Array {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      const handles = filesArg.map((f) => ({
        async getFile() {
          return new File([bytesFromBase64(f.base64)], f.name);
        }
      }));
      (window as unknown as { showOpenFilePicker: () => Promise<typeof handles> }).showOpenFilePicker = async () => handles;
    }, gltfOnly);

    await page.goto("./");
    await page.getByTestId("topbar.import").click();

    await expect(page.getByTestId("missing-files.dialog")).toBeVisible();
    const listText = await page.getByTestId("missing-files.list").textContent();
    expect(listText).toContain(MULTI_FILE_BIN_NAME);
    expect(listText).toContain(MULTI_FILE_WAV_NAME);
  });
});
