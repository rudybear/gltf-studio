// A tiny pure helper factored out of parse-client.ts so the monotonic-id /
// staleness-cancellation protocol (specs/ux-script.md UX-709) is unit
// testable without a real Worker or a DOM environment: `next()` mints a new
// id and remembers it as the latest OUTSTANDING request; `isLatest(id)`
// tells the caller whether a response with that id is still the one that
// matters (an older in-flight request's eventual response is stale once a
// newer one has been sent, even if it resolves first).
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
