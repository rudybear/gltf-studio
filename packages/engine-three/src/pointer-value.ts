// RH-020/RH-021's applyPointer, and patchScene's non-structural fast path,
// both bottom out in the three-adapter's own applyPointer(tables, pointer,
// value, diagnostics) — RESOLVED(RH-pointer-value-tbd) (see
// specs/render-host.md's "Open questions"): engine-three accepts exactly the
// adapter's own PointerValue union at runtime.
import type { PointerValue } from "@gltfi/three-adapter";

/**
 * True iff `value` is one of the shapes the three-adapter's live pointer
 * table actually accepts. `patch-classify.ts`'s `isStructuralPatch` uses
 * this (rather than a try/catch around `coercePointerValue`) to route a
 * patch whose value ISN'T one of these shapes — e.g. a string enum like
 * `KHR_audio_emitter.distanceModel` — to the full-reload path up front,
 * instead of reaching `applyNonStructuralPatch` and throwing mid-batch
 * (which used to propagate out of `RenderHost.patchScene` into
 * `HistoryStack.push`'s synchronous `onApply` notification, aborting
 * whatever the caller — e.g. the app store's `dispatchCommand` — was doing
 * after `push()`, well past the point of no return).
 */
export function isPointerValue(value: unknown): value is PointerValue {
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === "number") || value.every((entry) => typeof entry === "boolean");
  }
  return false;
}

export function coercePointerValue(value: unknown, context: string): PointerValue {
  if (isPointerValue(value)) {
    return value;
  }
  throw new TypeError(
    `${context}: unsupported pointer value ${JSON.stringify(value)} — expected a number, a boolean, ` +
      "or a homogeneous array of numbers/booleans"
  );
}
