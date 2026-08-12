// specs/ux-shell.md UX-126/UX-127: shareable links. No backend exists (or is
// planned for v1 — see specs/storage-provider.md's `remote` capability), so
// a "share link" can only ever be one thing: the asset's own bytes, gzip-
// compressed and embedded in the URL fragment (never sent to any server,
// unlike a query parameter — moot for a static host today, but keeps the
// mechanism honest as one). That only stays practical up to a size limit;
// past it, the dialog falls back to "download the .glb and share the file"
// (UX-126's own `share.too-large-note`).
const SHARE_HASH_PREFIX = "share=";

/**
 * UX-126: the size limit is on the GZIPPED bytes (what actually lands in the
 * URL, after base64url's own ~33% expansion) — "a few hundred KB", chosen so
 * the resulting URL (a few hundred KB * 4/3 for base64) stays well inside
 * every mainstream browser's real-world URL length tolerance (~2MB+) with
 * comfortable headroom, not the much lower ~2000-character limits some IE-era
 * folklore cites (long dead in every browser this app targets).
 */
export const SHARE_LINK_MAX_GZIPPED_BYTES = 300_000;

async function readAllChunks(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  void writer.write(bytes as BufferSource).then(() => writer.close());
  return readAllChunks(stream.readable);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  void writer.write(bytes as BufferSource).then(() => writer.close());
  return readAllChunks(stream.readable);
}

/** btoa/atob operate on binary strings, not raw bytes — chunked to avoid blowing the call stack on `String.fromCharCode(...bigArray)` for a large asset. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type ShareLinkResult =
  | { ok: true; url: string; gzippedBytes: number }
  | { ok: false; gzippedBytes: number };

/**
 * UX-126: gzip-compresses `bytes` (the exact same bytes `topbar.export`
 * already produces) and, when the result fits under
 * `SHARE_LINK_MAX_GZIPPED_BYTES`, returns a full URL (current location +
 * `#share=<base64url>`) that `loadShareFromLocation` below can reconstruct
 * the asset from. Over the limit, `ok: false` still reports the size so the
 * caller can show an honest "N KB, over the M KB link limit" message rather
 * than a bare failure.
 */
export async function buildShareLink(bytes: Uint8Array, currentUrl: string): Promise<ShareLinkResult> {
  const compressed = await gzip(bytes);
  if (compressed.byteLength > SHARE_LINK_MAX_GZIPPED_BYTES) {
    return { ok: false, gzippedBytes: compressed.byteLength };
  }
  const url = new URL(currentUrl);
  url.hash = `${SHARE_HASH_PREFIX}${bytesToBase64Url(compressed)}`;
  return { ok: true, url: url.toString(), gzippedBytes: compressed.byteLength };
}

/** UX-127: extracts the `share=`-prefixed payload from a URL hash (e.g. `location.hash`), or `null` when the hash carries no share link. */
export function readShareHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return raw.startsWith(SHARE_HASH_PREFIX) ? raw.slice(SHARE_HASH_PREFIX.length) : null;
}

/** UX-127: the inverse of `buildShareLink` — base64url-decodes then gunzips back to the original asset bytes. Throws on a corrupted/truncated payload; callers surface that as a toast rather than crashing. */
export async function decodeShareLink(encoded: string): Promise<Uint8Array> {
  return gunzip(base64UrlToBytes(encoded));
}
