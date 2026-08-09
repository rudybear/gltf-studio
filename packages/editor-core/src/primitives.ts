// Minimal hardcoded cube primitive geometry (DOC-046) for the procedural
// "add a cube" asset-generation path (`SceneEdit.addMesh`/`addAccessor`/
// `addBufferView`/`addBuffer`, consumed by `@gltf-studio/agent-mock`'s
// add-cube template, AG-014). Deliberately tiny: 24 vertices (4 per face, so
// each face gets its own un-shared flat normal — `packages/engine-three`
// does not call `computeVertexNormals()`, so POSITION-only geometry would
// shade black under the default lit `MeshStandardMaterial`), no UVs/
// tangents/skinning.
//
// `encodeCubeBuffer` packs POSITION+NORMAL+indices into one small
// ArrayBuffer, base64-encodes it into a self-contained `data:` URI (so the
// generated asset never requires a binary-blob file mutation — AG-014:
// asset generation expresses its entire output as ordinary document
// patches), and returns the three byte ranges its caller
// (`SceneEdit.addBuffer`/`addBufferView`/`addAccessor`) needs to describe
// each bufferView within that one buffer.

export interface CubeGeometry {
  /** 24 vertices * 3 floats (VEC3). */
  positions: Float32Array;
  /** 24 vertices * 3 floats (VEC3), one un-shared normal per face-vertex. */
  normals: Float32Array;
  /** 36 indices (6 faces * 2 triangles * 3), fits comfortably in UNSIGNED_SHORT. */
  indices: Uint16Array;
  min: [number, number, number];
  max: [number, number, number];
}

/** A unit cube (default half-extent 0.5, i.e. 1x1x1) centered at the origin. */
export function cubeGeometry(halfExtent = 0.5): CubeGeometry {
  const h = halfExtent;
  // Each face: outward normal + 4 corners in CCW winding as seen from
  // outside the cube (three.js/glTF convention: front-facing = CCW).
  const faces: Array<{ normal: [number, number, number]; corners: Array<[number, number, number]> }> = [
    { normal: [1, 0, 0], corners: [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]] }, // +X
    { normal: [-1, 0, 0], corners: [[-h, -h, h], [-h, h, h], [-h, h, -h], [-h, -h, -h]] }, // -X
    { normal: [0, 1, 0], corners: [[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]] }, // +Y
    { normal: [0, -1, 0], corners: [[-h, -h, h], [-h, -h, -h], [h, -h, -h], [h, -h, h]] }, // -Y
    { normal: [0, 0, 1], corners: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] }, // +Z
    { normal: [0, 0, -1], corners: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] } // -Z
  ];

  const positions = new Float32Array(24 * 3);
  const normals = new Float32Array(24 * 3);
  const indices = new Uint16Array(36);

  faces.forEach((face, faceIndex) => {
    const base = faceIndex * 4;
    face.corners.forEach((corner, i) => {
      positions.set(corner, (base + i) * 3);
      normals.set(face.normal, (base + i) * 3);
    });
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], faceIndex * 6);
  });

  return { positions, normals, indices, min: [-h, -h, -h], max: [h, h, h] };
}

export interface EncodedCubeBuffer {
  /** Self-contained `data:application/octet-stream;base64,...` buffer URI. */
  uri: string;
  byteLength: number;
  positions: { byteOffset: number; byteLength: number };
  normals: { byteOffset: number; byteLength: number };
  indices: { byteOffset: number; byteLength: number };
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Hand-rolled base64 encoder rather than `btoa`/`Buffer.from` — this module
 * runs both under Node (vitest) and bundled into a browser app, and a
 * dependency-free implementation avoids caring which globals either
 * environment happens to provide.
 */
function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? "=" : BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? "=" : BASE64_CHARS[b2 & 0x3f];
  }
  return out;
}

/** Packs a `CubeGeometry`'s three arrays into one buffer + byte ranges + `data:` URI. */
export function encodeCubeBuffer(geometry: CubeGeometry): EncodedCubeBuffer {
  const positionsBytes = new Uint8Array(geometry.positions.buffer, geometry.positions.byteOffset, geometry.positions.byteLength);
  const normalsBytes = new Uint8Array(geometry.normals.buffer, geometry.normals.byteOffset, geometry.normals.byteLength);
  const indicesBytes = new Uint8Array(geometry.indices.buffer, geometry.indices.byteOffset, geometry.indices.byteLength);

  const positionsOffset = 0;
  const normalsOffset = positionsOffset + positionsBytes.byteLength; // 288, 4-byte aligned
  const indicesOffset = normalsOffset + normalsBytes.byteLength; // 576, 4-byte aligned
  const totalLength = indicesOffset + indicesBytes.byteLength; // 648

  const combined = new Uint8Array(totalLength);
  combined.set(positionsBytes, positionsOffset);
  combined.set(normalsBytes, normalsOffset);
  combined.set(indicesBytes, indicesOffset);

  return {
    uri: `data:application/octet-stream;base64,${encodeBase64(combined)}`,
    byteLength: totalLength,
    positions: { byteOffset: positionsOffset, byteLength: positionsBytes.byteLength },
    normals: { byteOffset: normalsOffset, byteLength: normalsBytes.byteLength },
    indices: { byteOffset: indicesOffset, byteLength: indicesBytes.byteLength }
  };
}
