// specs/ux-shell.md UX-125: crash recovery, plus the plain-localStorage
// "which project was open last" bookmark UX-125 itself describes as "a plain
// UI convenience distinct from any StorageProvider-governed state" -- it is
// NOT project data (never goes through StorageProvider), just a hint so a
// fresh app load knows which project to try reopening.
import type { JsonPatchOp, ProjectData, StorageProvider } from "@gltf-studio/engine-api";

export const LAST_PROJECT_STORAGE_KEY = "gltf-studio:last-project-id";

/** Best-effort -- localStorage can throw (private browsing, disabled storage); losing this convenience is not a correctness problem. */
export function rememberLastProjectId(id: string | null): void {
  try {
    if (id) globalThis.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, id);
    else globalThis.localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
  } catch {
    // ignored -- see doc comment above
  }
}

export function readLastProjectId(): string | null {
  try {
    return globalThis.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export interface ProjectCheckout {
  data: ProjectData;
  /** UX-125: non-empty only when the project's journal is ahead of its last save. */
  pendingPatches: JsonPatchOp[];
}

/** UX-125: loads a project's last-saved state and checks whether its journal has patches beyond it (SP-015). */
export async function checkoutProject(storage: StorageProvider, id: string): Promise<ProjectCheckout> {
  const [data, journal] = await Promise.all([storage.load(id), storage.loadJournal(id)]);
  return { data, pendingPatches: journal.patches };
}
