// RH-020/RH-021's applyPointer, and patchScene's non-structural fast path,
// both bottom out in the three-adapter's own applyPointer(tables, pointer,
// value, diagnostics) — RESOLVED(RH-pointer-value-tbd) (see
// specs/render-host.md's "Open questions"): engine-three accepts exactly the
// adapter's own PointerValue union at runtime.
import type { PointerValue } from "@gltfi/three-adapter";

export function coercePointerValue(value: unknown, context: string): PointerValue {
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === "number")) {
      return value as number[];
    }
    if (value.every((entry) => typeof entry === "boolean")) {
      return value as boolean[];
    }
  }
  throw new TypeError(
    `${context}: unsupported pointer value ${JSON.stringify(value)} — expected a number, a boolean, ` +
      "or a homogeneous array of numbers/booleans"
  );
}
