import type { HistoryStack } from "@gltf-studio/editor-core";
import { extractBinaryChunk } from "./audio-container.js";

/** The minimal shape this module needs from an `AudioHost` (`@gltf-studio/engine-api`) — `loadEmitters`/`dispose` only, so tests can pass a lightweight fake instead of constructing a real `WebAudioHost`/`AudioContext`. */
export interface AudioHostLike {
  loadEmitters(json: unknown): Promise<void>;
  dispose(): void;
}

/**
 * Wires `host` to `history` for the lifetime of that `HistoryStack`
 * instance: an initial `loadEmitters` from the current document, then one
 * more per `history.onApply` (DOC-040) — i.e. per real push/undo/redo, which
 * covers import/apply-script/accepted-proposal edits that touch
 * audio-relevant JSON — but NEVER per `history.freeze()`/`unfreeze()`
 * (DOC-045), which don't call `onApply` and don't change `history`'s own
 * identity. This is what lets a `WebAudioHost` (and any `AudioContext` a
 * pre-play Audition gesture already created on it, AH-001) survive
 * `HistoryStack.freeze()` (play-mode start) intact: entering/leaving play
 * mode is invisible to this function, by construction. Mirrors
 * `Viewport.tsx`'s `history`/`onApply`-keyed scene-load effect for
 * `RenderHost`.
 *
 * Returns a teardown callback that unsubscribes AND calls `host.dispose()` —
 * call it exactly once, when `history` itself changes (a brand-new project
 * loaded) or the owning component unmounts.
 */
export function attachAudioHost(history: HistoryStack, host: AudioHostLike): () => void {
  const reload = () => {
    const binary = extractBinaryChunk(history.document.container);
    void host.loadEmitters({ json: history.document.json, binary });
  };
  reload();
  const unsubscribe = history.onApply(reload);
  return () => {
    unsubscribe();
    host.dispose();
  };
}
