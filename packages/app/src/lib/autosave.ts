// specs/ux-shell.md UX-123/UX-124: the debounced full-checkpoint scheduler
// and best-effort thumbnail capture. Kept as small, framework-free helpers
// (no zustand/store import) so they're unit-testable without a store harness
// -- app-store.ts wires the actual `run` callback and `RenderHost` lookup.
import type { RenderHost } from "@gltf-studio/engine-api";

/** UX-123: 1.5s of no further edit before a full checkpoint save runs. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

export interface AutosaveScheduler {
  /** (Re)starts the debounce window -- called on every edit. */
  schedule(): void;
  /** Cancels a pending run without executing it (e.g. a fresh project replacing the current one). */
  cancel(): void;
}

export function createAutosaveScheduler(run: () => void, delayMs: number = AUTOSAVE_DEBOUNCE_MS): AutosaveScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, delayMs);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }
  };
}

/** UX-124: best-effort -- a missing RenderHost (no mounted viewport yet) or a rejected snapshot resolves to `undefined` rather than failing the save that called it. */
export async function tryCaptureThumbnail(renderHost: RenderHost | null | undefined): Promise<Blob | undefined> {
  if (!renderHost) return undefined;
  try {
    return await renderHost.snapshot();
  } catch {
    return undefined;
  }
}
