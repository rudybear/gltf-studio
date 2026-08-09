/**
 * FrameScheduler: the tick-loop's only environment dependency. Injectable so
 * PlayController works identically in a browser (real `requestAnimationFrame`)
 * and in a plain Node vitest run (contract tests, no DOM) — and so a later
 * contract-test suite can inject a fully-manual fake (one whose
 * `requestFrame` never calls back until the test explicitly triggers it) to
 * test `pause`/`resume`/`tickOnce` deterministically without real timers.
 */
export interface FrameScheduler {
  /** Monotonic-ish clock, in milliseconds. Only ever used for delta-time math, never wall-clock display. */
  now(): number;
  /** Schedules `callback` for "the next frame"; returns a handle `cancelFrame` can later cancel. */
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(handle: number): void;
}

const hasDom =
  typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

// Node fallback target frame interval — no real vsync to hook into outside a
// browser, so ~60fps via setTimeout is the closest approximation (see the
// milestone brief: "playing" state must still auto-tick somewhere to run
// against in a plain Node vitest run too).
const FALLBACK_FRAME_MS = 1000 / 60;

/**
 * Detects `requestAnimationFrame` (browser) and uses it directly when
 * present; otherwise falls back to a `setTimeout`-driven ~60fps loop (Node).
 * This is only the production fallback path — a future contract-test suite
 * is expected to inject its own fully-manual `FrameScheduler` instead of
 * relying on either branch here.
 */
export function createDefaultScheduler(): FrameScheduler {
  if (hasDom) {
    return {
      now,
      requestFrame(callback) {
        return requestAnimationFrame(callback);
      },
      cancelFrame(handle) {
        cancelAnimationFrame(handle);
      }
    };
  }
  return {
    now,
    requestFrame(callback) {
      // Node's @types/node types setTimeout's return as NodeJS.Timeout (not
      // number, unlike lib.dom.d.ts) whenever it's visible to this package's
      // type-check — cast through unknown so this file's FrameScheduler
      // contract (a plain `number` handle) stays environment-agnostic; the
      // runtime value round-trips through cancelFrame unchanged either way.
      return setTimeout(() => callback(now()), FALLBACK_FRAME_MS) as unknown as number;
    },
    cancelFrame(handle) {
      clearTimeout(handle as unknown as Parameters<typeof clearTimeout>[0]);
    }
  };
}
