// RenderHost.loadScene(json: unknown) — RESOLVED(RH-loadscene-shape-tbd) (see
// specs/render-host.md's "Open questions"): engine-three accepts any of
// three shapes: a raw GLB ArrayBuffer/Uint8Array; a { json, binary? }
// parsed-container shape (mirroring @gltfi/gltf's own GltfDocument); or a
// bare, self-contained glTF JSON document (detected by its required
// top-level `asset` field — glTF's own "embedded" convention, buffers
// inlined as base64 `data:` URIs, no separate binary blob at all). The third
// shape is what the portable RenderHost contract suite
// (packages/contract-tests/src/render-host.ts) uses, since it must stay
// implementation-agnostic and cannot assume any particular
// container/wrapper convention beyond plain glTF JSON itself. All three are
// normalized here into one GLB ArrayBuffer, so ThreeRenderHost.loadScene has
// exactly one GLTFLoader.parse call site regardless of which shape the
// caller handed in.
import { writeGlb, type GltfDocument } from "@gltfi/gltf";

export interface ThreeSceneSource {
  json: unknown;
  binary?: ArrayBuffer | Uint8Array | null;
}

function isThreeSceneSource(value: unknown): value is ThreeSceneSource {
  return typeof value === "object" && value !== null && "json" in value;
}

/** A bare glTF document always has a required top-level `asset` field (glTF 2.0 §5.16) — the one field a `{ json, binary? }` wrapper never has at its own top level. */
function isBareGltfJson(value: unknown): boolean {
  return typeof value === "object" && value !== null && "asset" in value;
}

function toArrayBuffer(view: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (view instanceof ArrayBuffer) {
    return view;
  }
  // Slice so a Uint8Array view over a larger/shared buffer doesn't leak
  // unrelated bytes into the GLB writeGlb() below produces.
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/**
 * Normalizes any of engine-three's accepted `loadScene` input shapes into one
 * GLB `ArrayBuffer` ready for `GLTFLoader.parse`/`parseAsync`.
 */
export function toGlbArrayBuffer(input: unknown): ArrayBuffer {
  if (input instanceof ArrayBuffer) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return toArrayBuffer(input as Uint8Array);
  }
  if (isBareGltfJson(input)) {
    return writeGlb({ json: input as GltfDocument["json"] });
  }
  if (isThreeSceneSource(input)) {
    const doc: GltfDocument = {
      json: input.json as GltfDocument["json"],
      binaryChunk: input.binary ? toArrayBuffer(input.binary) : undefined
    };
    return writeGlb(doc);
  }
  throw new TypeError(
    "RenderHost.loadScene: unsupported scene input — expected an ArrayBuffer/Uint8Array (raw GLB), " +
      "a bare glTF JSON document (with a top-level `asset` field), or a { json, binary? } object, got " +
      (input === null ? "null" : typeof input)
  );
}
