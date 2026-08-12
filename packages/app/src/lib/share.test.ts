// specs/ux-shell.md UX-126/UX-127: share-link round trip, size-limit
// fallback, and hash parsing.
import { describe, expect, it } from "vitest";
import { buildShareLink, decodeShareLink, readShareHash, SHARE_LINK_MAX_GZIPPED_BYTES } from "./share.js";

describe("buildShareLink / decodeShareLink round trip (UX-126/UX-127)", () => {
  it("round-trips a small asset through a #share= URL", async () => {
    const bytes = new TextEncoder().encode("a small fake glb payload".repeat(20));
    const result = await buildShareLink(bytes, "https://example.test/app/?x=1#old-hash");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.url).toContain("https://example.test/app/?x=1#share=");

    const hash = new URL(result.url).hash;
    const encoded = readShareHash(hash);
    expect(encoded).not.toBeNull();
    const decoded = await decodeShareLink(encoded!);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("falls back to ok:false with the measured size when the gzipped payload exceeds the limit (UX-126)", async () => {
    // Random bytes barely compress -- comfortably over the limit once gzipped.
    const bytes = new Uint8Array(SHARE_LINK_MAX_GZIPPED_BYTES + 50_000);
    crypto.getRandomValues(bytes.subarray(0, 65536));
    for (let i = 65536; i < bytes.length; i += 65536) {
      bytes.set(bytes.subarray(0, Math.min(65536, bytes.length - i)), i);
    }
    const result = await buildShareLink(bytes, "https://example.test/app/");
    expect(result.ok).toBe(false);
    expect(result.gzippedBytes).toBeGreaterThan(SHARE_LINK_MAX_GZIPPED_BYTES);
  });

  it("readShareHash returns null for a hash with no share= payload", () => {
    expect(readShareHash("")).toBeNull();
    expect(readShareHash("#")).toBeNull();
    expect(readShareHash("#foo=bar")).toBeNull();
  });

  it("readShareHash accepts both a leading-# and bare hash string", () => {
    expect(readShareHash("#share=abc")).toBe("abc");
    expect(readShareHash("share=abc")).toBe("abc");
  });

  it("decodeShareLink rejects a corrupted payload rather than silently returning garbage", async () => {
    await expect(decodeShareLink("not-valid-base64url-gzip!!!")).rejects.toBeTruthy();
  });
});
