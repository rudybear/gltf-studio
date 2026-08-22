// Copied verbatim from @gltf-studio/script-panel's request-sequencer.ts
// (~15 lines, zero deps — a shared package for one tiny pure class was
// judged not worth the cross-package coupling; see this package's own
// "shared vs copied" note in specs/ux-audio-script.md). A tiny pure helper
// so the monotonic-id / staleness-cancellation protocol (specs/ux-audio-
// script.md UX-1400) is unit testable without a real Worker or a DOM
// environment: `next()` mints a new id and remembers it as the latest
// OUTSTANDING request; `isLatest(id)` tells the caller whether a response
// with that id is still the one that matters (an older in-flight request's
// eventual response is stale once a newer one has been sent, even if it
// resolves first).
export class RequestSequencer {
  private counter = 0;
  private latestSent = -1;

  next(): number {
    this.counter += 1;
    this.latestSent = this.counter;
    return this.counter;
  }

  isLatest(id: number): boolean {
    return id === this.latestSent;
  }
}
