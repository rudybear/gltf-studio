// Whole-folder drag-and-drop (specs/ux-shell.md UX-118): the "it just sees
// the files" import path this feature set adds alongside UX-117's
// folder-grant dialog. A plain flat multi-file drop already worked via
// `DataTransfer.files` (UX-115); dropping a FOLDER instead needs the File
// and Directory Entries API's `DataTransferItem.webkitGetAsEntry()` (a
// de-facto-standard, Chromium/Firefox/Safari-supported extension —
// TypeScript's bundled `dom` lib DOES declare the full
// `FileSystemEntry`/`FileSystemDirectoryEntry`/`FileSystemFileEntry`/
// `FileSystemDirectoryReader` surface, unlike the newer File System ACCESS
// API `fs-handle-types.ts`'s header comment discusses — so this module uses
// those real DOM types directly, no local structural stand-ins needed) to
// walk the dropped directory's full tree and read every leaf file, since
// `DataTransfer.files` alone flattens a dropped folder into nothing usable
// (Chrome omits directory entries from `.files` entirely).
//
// `TopBar.tsx`'s `topbar.import` button drop target and `App.tsx`'s
// whole-window drop target both funnel through this one function so a
// folder dropped on either place resolves identically.

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** A directory's `readEntries()` only returns entries in batches (browser-defined cap) -- must be called repeatedly until it yields an empty array. */
async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

async function collectFilesFromEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    out.push(await entryToFile(entry as FileSystemFileEntry));
    return;
  }
  if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) await collectFilesFromEntry(child, out);
  }
}

/**
 * Extracts every file a drop event's `DataTransfer` carries, traversing
 * dropped folders' full contents via `webkitGetAsEntry` when the browser
 * supports it (every item resolves to a non-null entry); falls back to the
 * flat `dataTransfer.files` list (a plain multi-file drop, or a browser
 * without directory-entry support) otherwise.
 */
export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = dataTransfer.items;
  if (items && items.length > 0) {
    const entries = Array.from(items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => entry != null);
    if (entries.length === items.length) {
      const out: File[] = [];
      for (const entry of entries) await collectFilesFromEntry(entry, out);
      return out;
    }
  }
  return Array.from(dataTransfer.files);
}
