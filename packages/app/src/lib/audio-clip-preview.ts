// Standalone clip preview playback for the Assets > Audio Clips tab — plays
// raw clip bytes directly (no emitter, no `AudioHost`/`WebAudioHost`
// involvement at all), since a clip preview happens OUTSIDE any scene
// context (before it's even assigned to a source). A lazily-created,
// module-level `AudioContext` is reused across previews (never one per
// click) — this module's own click handlers ARE the user gesture Web Audio's
// autoplay policy requires, same gating discipline `AudioSection.tsx`'s
// Audition button already established for `AudioHost.init()`.
let sharedContext: AudioContext | null = null;

function getContext(): AudioContext {
  if (!sharedContext) {
    sharedContext = new AudioContext();
  }
  return sharedContext;
}

/**
 * Decodes `bytes` and returns its duration in seconds, WITHOUT starting
 * playback — the Assets tab's per-row duration label. Rejects on a
 * corrupt/unsupported clip; callers show "unknown" rather than propagating.
 */
export async function decodeClipDuration(bytes: ArrayBuffer): Promise<number> {
  const buffer = await getContext().decodeAudioData(bytes.slice(0));
  return buffer.duration;
}

/** A currently-playing preview voice, stoppable before it finishes naturally. */
export interface ClipPreviewHandle {
  stop(): void;
}

/**
 * Decodes and plays `bytes` once, resuming the shared context first if a
 * prior suspend left it that way (this call IS the user gesture). Returns a
 * handle whose `stop()` is safe to call even after natural completion (a
 * second `AudioBufferSourceNode.stop()` throws `InvalidStateError` — caught
 * and ignored, matching `WebAudioHost.dispose()`'s own "never started"
 * tolerance for the identical case).
 */
export async function playClipPreview(bytes: ArrayBuffer): Promise<ClipPreviewHandle> {
  const context = getContext();
  if (context.state !== "running") {
    await context.resume().catch(() => undefined);
  }
  const buffer = await context.decodeAudioData(bytes.slice(0));
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return {
    stop(): void {
      try {
        source.stop();
      } catch {
        // already finished naturally — not an error.
      }
    }
  };
}
