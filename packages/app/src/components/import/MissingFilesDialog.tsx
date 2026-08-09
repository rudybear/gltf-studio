import { useEffect, useState } from "react";
import { useAppStore } from "../../store/app-store";
import type { DirectoryHandleLike } from "@gltf-studio/storage";

// `window.showDirectoryPicker` isn't declared in TypeScript's bundled `dom`
// lib (same reason `packages/storage/src/fs-handle-types.ts` defines its own
// minimal structural types, and `packages/app/src/lib/export.ts`'s own
// `ShowSaveFilePicker`, rather than importing real File System Access DOM
// types) — a small local shape covers exactly what this dialog calls. A real
// `window.showDirectoryPicker()` handle is structurally compatible with
// `DirectoryHandleLike` per `fs-handle-types.ts`'s own header comment, so it
// can be handed straight to `grantFolderAndRetryImport` with no adapting.
type ShowDirectoryPicker = (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandleLike>;

function getShowDirectoryPicker(): ShowDirectoryPicker | undefined {
  return (window as unknown as { showDirectoryPicker?: ShowDirectoryPicker }).showDirectoryPicker;
}

/**
 * specs/ux-shell.md UX-117: the dialog `importFiles`/`grantFolderAndRetryImport`
 * (app-store.ts) drive whenever a picked/dropped `.gltf`'s external
 * references can't all be resolved from what was selected. Mounted once at
 * `App.tsx`'s top level, like `PointerPickerDialog`/`ToastLayer`/
 * `TestIdOverlay` — driven entirely by the store's `missingFilesDialog`
 * (`null` = closed).
 *
 * Feature-detects `window.showDirectoryPicker` (Chrome/Edge; not Firefox/
 * Safari as of this writing) to decide which of UX-117's two bodies to show:
 * a primary "Grant folder access…" action when supported, or copy pointing
 * back at multi-select/drag-and-drop (already covered by UX-115) when not —
 * the button itself is omitted entirely rather than shown-and-erroring in
 * that case.
 */
export function MissingFilesDialog(): JSX.Element | null {
  const dialog = useAppStore((s) => s.missingFilesDialog);
  const closeMissingFilesDialog = useAppStore((s) => s.closeMissingFilesDialog);
  const grantFolderAndRetryImport = useAppStore((s) => s.grantFolderAndRetryImport);
  const pushToast = useAppStore((s) => s.pushToast);
  const [granting, setGranting] = useState(false);

  // UX-908-style: Escape closes, equivalently to Cancel/close-x/backdrop-click
  // (same convention as PointerPickerDialog's own Escape handling).
  useEffect(() => {
    if (!dialog) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") closeMissingFilesDialog();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialog, closeMissingFilesDialog]);

  if (!dialog) return null;

  const showDirectoryPicker = getShowDirectoryPicker();

  async function onGrantFolder(): Promise<void> {
    if (!showDirectoryPicker) return;
    setGranting(true);
    try {
      const handle = await showDirectoryPicker({ mode: "read" });
      await grantFolderAndRetryImport(handle);
    } catch (err) {
      // AbortError: the user dismissed the native picker without choosing a
      // folder -- not a failure, leave the dialog exactly as it was.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        pushToast(`Folder access failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setGranting(false);
    }
  }

  const busy = granting || dialog.resolving;
  const missingList = dialog.missing.join(", ");
  const plural = dialog.missing.length === 1;

  return (
    <div
      className="modal-overlay open"
      data-testid="missing-files.dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeMissingFilesDialog();
      }}
    >
      <div className="mf-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Missing files</h3>
          <button className="close-x" data-testid="missing-files.close-x" onClick={closeMissingFilesDialog}>
            ✕
          </button>
        </div>
        <div className="modal-body mf-body">
          <p>
            &ldquo;{dialog.gltfFile.name}&rdquo; references {plural ? "a file that wasn't" : "files that weren't"} selected:
          </p>
          <ul className="mf-missing-list" data-testid="missing-files.list">
            {dialog.missing.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          {showDirectoryPicker ? (
            <p className="mf-hint" data-testid="missing-files.hint-folder">
              Click &ldquo;Grant folder access…&rdquo; and choose the folder &ldquo;{dialog.gltfFile.name}&rdquo; lives in — {missingList} will be found
              automatically.
            </p>
          ) : (
            <p className="mf-hint" data-testid="missing-files.hint-multiselect">
              Click Import again and select &ldquo;{dialog.gltfFile.name}&rdquo; together with {missingList} (or drag all of them onto Import at once).
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" data-testid="missing-files.cancel" onClick={closeMissingFilesDialog}>
            Cancel
          </button>
          <div className="topbar-spacer" />
          {showDirectoryPicker ? (
            <button
              className="btn primary"
              data-testid="missing-files.grant-folder"
              disabled={busy}
              onClick={() => {
                void onGrantFolder();
              }}
            >
              {busy ? "Checking folder…" : "Grant folder access…"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
