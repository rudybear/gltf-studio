// specs/ux-inspector.md UX-416: decodes every `images[]` entry in the
// current document into a browser-renderable `<img>` src for the Texture
// Slots sub-section's thumbnails — `data:` URI images and, for a `kind:
// "glb"` container, bufferView-embedded images alike. Reuses the vendored
// `@gltfi/gltf`'s own `loadImageBitmaps` (its `GltfDocument` shape —
// `{json, binaryChunk}` — is a subset of a "glb"-kind `Container`, so it's
// directly constructible from an `EditorDocument`) rather than hand-rolling
// a second data-URI/bufferView-slice decoder; there is no existing decode
// helper elsewhere in this app to reuse instead (checked: nothing in
// packages/app/src or packages/editor-core/src turns an `images[]` entry
// into anything renderable today — this is the first feature that needs
// to).
//
// A `kind: "gltf"` (non-GLB) container has no `binaryChunk` at all — a
// bufferView-embedded image is then undecodable (an HONEST gap, not
// silently pretended-away: `loadImageBitmaps` itself just resolves that
// image to `null`, which this module surfaces as "no thumbnail" rather than
// a thrown error). A `data:` URI image decodes regardless of container kind.
import { loadImageBitmaps, type GltfDocument as GltfiDocument } from "@gltfi/gltf";
import type { EditorDocument } from "@gltf-studio/editor-core";

/** `imageIndex -> data: URL` (never a `blob:` object URL — no lifecycle/revocation to manage, and thumbnails are tiny). Images that fail to decode (an external non-`data:` URI, a bufferView image with no available `binaryChunk`, or a genuinely corrupt image) are simply absent from the returned map — callers render a "no thumbnail" placeholder for those, never an error. */
export async function decodeTextureThumbnails(editorDocument: EditorDocument): Promise<Map<number, string>> {
  const json = editorDocument.json as { images?: unknown[] } | undefined;
  const imageCount = json?.images?.length ?? 0;
  const result = new Map<number, string>();
  if (imageCount === 0) return result;

  const container = editorDocument.container;
  const gltfiDoc: GltfiDocument = {
    json: editorDocument.json as GltfiDocument["json"],
    binaryChunk: container.kind === "glb" ? container.binaryChunk : undefined
  };

  let bitmaps: Array<ImageBitmap | null>;
  try {
    bitmaps = await loadImageBitmaps(gltfiDoc);
  } catch {
    return result; // a malformed images[] entry anywhere shouldn't blank the WHOLE thumbnail set — best-effort, never throws into the caller.
  }

  bitmaps.forEach((bitmap, imageIndex) => {
    if (!bitmap) return;
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(bitmap, 0, 0);
    result.set(imageIndex, canvas.toDataURL("image/png"));
  });
  return result;
}
