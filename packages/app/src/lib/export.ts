// M3 export (specs/ux-shell.md's top-bar Export control; no dedicated spec
// ID of its own yet — governed by packages/app/**'s catch-all ownership):
// turns editor-core's byte-preserving `save()` output into bytes the user
// actually gets. Two delivery paths:
//   1. A File-System-Access `showSaveFilePicker` handle, when available AND
//      the app's current `StorageProvider` reports `capabilities.fileHandles`
//      (SP-013) — gated on the LIVE provider, not just browser feature
//      detection, so this path only ever engages once the app actually wires
//      up a File-System-Access-backed StorageProvider (not yet: the app only
//      ever constructs `IndexedDBStorage`, `capabilities.fileHandles: false`
//      — see app-store.ts's header comment. Feature-detecting the browser
//      API alone, ignoring the provider, would pop a real native OS picker
//      under a headless e2e run with no way to script through it).
//   2. A plain `<a download>` blob-URL click — always available, and what
//      Playwright's `page.waitForEvent("download")` intercepts in e2e.
//
// `window.showSaveFilePicker` isn't declared in TypeScript's bundled `dom`
// lib (same reason packages/storage/src/fs-handle-types.ts defines its own
// minimal structural types rather than importing real FS Access DOM types)
// — a small local shape covers exactly what this file calls.
interface SaveFilePickerHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
type ShowSaveFilePicker = (options: { suggestedName: string }) => Promise<SaveFilePickerHandle>;

function getShowSaveFilePicker(): ShowSaveFilePicker | undefined {
  return (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
}

/** Always-available fallback: a synthetic `<a download>` click on a blob URL. */
export async function triggerBrowserDownload(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on a delay, not synchronously — revoking immediately after
  // `click()` has cancelled the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Attempts the native File-System-Access save dialog. Returns `"saved"` on a
 * successful write, `"cancelled"` when the user backs out of the picker
 * (`AbortError` — not a failure, caller should not fall back to a download
 * on top of it), or `"unsupported"` when the API isn't present (caller
 * should fall back to `triggerBrowserDownload`).
 */
export async function trySaveFilePicker(blob: Blob, suggestedName: string): Promise<"saved" | "cancelled" | "unsupported"> {
  const showSaveFilePicker = getShowSaveFilePicker();
  if (!showSaveFilePicker) return "unsupported";
  try {
    const handle = await showSaveFilePicker({ suggestedName });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "saved";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    throw error;
  }
}
