/**
 * animation/start|stop|stopAt's `animation` input is a `ref`: per the spec (and `@gltfi/runtime`'s
 * `parseAnimationRef`, and the load-time validator's "valid JSON Pointer" rule) its literal is the
 * pointer string `"/animations/N"`, NOT the bare index N studio used to write (which the runtime could
 * not resolve: the node always took `err`). UX-1118 / UX-508.
 */
export function animationRefPointer(animationIndex: number): string {
  return `/animations/${animationIndex}`;
}

/** Reads an `animation` ref literal back to a clip index: accepts the pointer form and the legacy bare-index form. */
export function animationRefIndex(raw: unknown): number | undefined {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const m = /^\/animations\/(\d+)$/.exec(raw);
    if (m) return Number(m[1]);
  }
  return undefined;
}
