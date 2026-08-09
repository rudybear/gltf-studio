import { describe, expect, it } from "vitest";
import { RequestSequencer } from "./request-sequencer.js";

describe("RequestSequencer (UX-709 monotonic-id / staleness-cancellation protocol)", () => {
  it("mints strictly increasing ids starting at 1", () => {
    const seq = new RequestSequencer();
    expect(seq.next()).toBe(1);
    expect(seq.next()).toBe(2);
    expect(seq.next()).toBe(3);
  });

  it("only the most recently minted id is \"latest\"", () => {
    const seq = new RequestSequencer();
    const first = seq.next();
    const second = seq.next();
    expect(seq.isLatest(first)).toBe(false);
    expect(seq.isLatest(second)).toBe(true);
  });

  it("an older request's response is stale once a newer request has been sent, even if it resolves first (out-of-order arrival)", () => {
    const seq = new RequestSequencer();
    const stale = seq.next();
    const fresh = seq.next();
    // Simulates the fresh request's response arriving BEFORE the stale one.
    expect(seq.isLatest(fresh)).toBe(true);
    expect(seq.isLatest(stale)).toBe(false);
  });

  it("before any request has been sent, nothing is latest", () => {
    const seq = new RequestSequencer();
    expect(seq.isLatest(0)).toBe(false);
    expect(seq.isLatest(1)).toBe(false);
  });
});
