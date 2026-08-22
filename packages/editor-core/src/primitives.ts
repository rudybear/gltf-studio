// Minimal hardcoded primitive geometries (DOC-046, extended DOC-047) for
// procedural mesh generation: `cubeGeometry` for `@gltf-studio/agent-mock`'s
// add-cube template (AG-014), plus `sphereGeometry`/`planeGeometry` added
// for the scene tree's "+ Add" > Mesh submenu (specs/ux-scene-tree.md
// UX-206). Deliberately tiny and flat-shaded: every geometry here gives each
// face its own un-shared vertices with a per-face normal — `packages/engine-three`
// does not call `computeVertexNormals()`, so POSITION-only or smoothed-normal
// geometry would shade incorrectly (black, or faceted shapes looking
// smoothed) under the default lit `MeshStandardMaterial`. No UVs/tangents/
// skinning on any of them.
//
// `encodeCubeBuffer` packs POSITION+NORMAL+indices into one small
// ArrayBuffer, base64-encodes it into a self-contained `data:` URI (so the
// generated asset never requires a binary-blob file mutation — AG-014:
// asset generation expresses its entire output as ordinary document
// patches), and returns the three byte ranges its caller
// (`SceneEdit.addBuffer`/`addBufferView`/`addAccessor`) needs to describe
// each bufferView within that one buffer. Despite the cube-specific name
// (kept for backward compatibility — `@gltf-studio/agent-mock`'s add-cube
// template already imports it), the implementation only ever reads
// `geometry.{positions,normals,indices}`, so it works unchanged for
// `sphereGeometry`/`planeGeometry` too (`SceneEdit.addPrimitiveMeshNode`,
// DOC-047, calls it for all three kinds).

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

/** Scans a positions array for its actual axis-aligned bounds — glTF accessor `min`/`max` must be exact, not an assumed bounding radius (a regular icosahedron's vertices don't all sit at the same distance from an axis, so `sphereGeometry` can't just report `±radius`). */
function computeBounds(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

// Regular icosahedron: 12 vertices, 20 triangular faces — the standard
// "low-poly sphere" primitive (same vertex/face table three.js's own
// IcosahedronGeometry(radius, 0) uses), picked over a UV-sphere because its
// faces are naturally near-equal-area/CCW-outward already, so flat-shading
// it needs no more than "don't share vertices across faces".
const ICOSAHEDRON_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
];

function icosahedronVertices(radius: number): Array<[number, number, number]> {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: Array<[number, number, number]> = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
  ];
  return raw.map(([x, y, z]) => {
    const length = Math.sqrt(x * x + y * y + z * z);
    return [(x / length) * radius, (y / length) * radius, (z / length) * radius];
  });
}

/**
 * A low-poly, flat-shaded icosphere — the "Sphere" primitive behind the
 * scene tree's "+ Add" > Mesh submenu (specs/ux-scene-tree.md UX-206).
 * 20 triangular faces, each with 3 un-shared vertices (60 verts/60 indices
 * total) so every face gets its own flat normal (this project's faceted
 * "flat-shaded" house style for procedural primitives, matching `cubeGeometry`
 * — see this module's header comment).
 */
export function sphereGeometry(radius = 0.5): CubeGeometry {
  const vertices = icosahedronVertices(radius);
  const faceCount = ICOSAHEDRON_FACES.length;
  const positions = new Float32Array(faceCount * 3 * 3);
  const normals = new Float32Array(faceCount * 3 * 3);
  const indices = new Uint16Array(faceCount * 3);

  ICOSAHEDRON_FACES.forEach((face, faceIndex) => {
    const [a, b, c] = face.map((i) => vertices[i]);
    const edge1: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const edge2: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = edge1[1] * edge2[2] - edge1[2] * edge2[1];
    const ny = edge1[2] * edge2[0] - edge1[0] * edge2[2];
    const nz = edge1[0] * edge2[1] - edge1[1] * edge2[0];
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const normal: [number, number, number] = [nx / length, ny / length, nz / length];

    const base = faceIndex * 3;
    [a, b, c].forEach((corner, i) => {
      positions.set(corner, (base + i) * 3);
      normals.set(normal, (base + i) * 3);
    });
    indices.set([base, base + 1, base + 2], faceIndex * 3);
  });

  const { min, max } = computeBounds(positions);
  return { positions, normals, indices, min, max };
}

/**
 * A single flat quad in the XZ plane, normal facing +Y (the conventional
 * "ground plane" orientation) — the "Plane" primitive behind the scene
 * tree's "+ Add" > Mesh submenu (specs/ux-scene-tree.md UX-206). Unlike
 * `cubeGeometry`/`sphereGeometry`, its 4 corners ARE shared between its 2
 * triangles: a single flat quad has exactly one normal everywhere on its
 * surface, so there is no cross-face seam for un-sharing to fix.
 */
export function planeGeometry(size = 1): CubeGeometry {
  const h = size / 2;
  // CCW as seen from +Y looking down (the normal's own side) so the face is front-facing per the cube's own +Y-face winding.
  const positions = new Float32Array([-h, 0, -h, -h, 0, h, h, 0, h, h, 0, -h]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const { min, max } = computeBounds(positions);
  return { positions, normals, indices, min, max };
}

/**
 * A minimal, silent 8kHz/16-bit mono WAV, base64-encoded into a
 * self-contained `data:` URI — the default clip the scene tree's "+ Add" >
 * Audio Emitter entry (specs/ux-scene-tree.md UX-206) gives its
 * `KHR_audio_emitter` source, so a freshly created emitter is immediately
 * auditionable (a source-less/clip-less emitter, while structurally valid
 * per the extension's Object Model, has nothing for the Inspector's Audio
 * section or `audio-webaudio`'s audition button to play). A silent clip
 * (zero-filled samples — `ArrayBuffer` is already zero-initialized, so
 * there's no sample-writing loop here, unlike `e2e/wav-fixture.ts`'s audible
 * sine-wave beep) rather than the tiniest-possible empty clip: some decoders
 * reject a zero-sample WAV outright. Deliberately NOT reusing
 * `e2e/wav-fixture.ts`'s `sineBeepWavBytes` — that helper lives in the e2e
 * package, which this runtime package must not depend on — but shares its
 * WAV-header layout and this module's own `encodeBase64`.
 */
export interface SilentWavBuffer {
  uri: string;
  byteLength: number;
}
export function silentWavBuffer(options: { sampleRate?: number; durationSeconds?: number } = {}): SilentWavBuffer {
  const sampleRate = options.sampleRate ?? 8000;
  const durationSeconds = options.durationSeconds ?? 0.05;
  const sampleCount = Math.max(1, Math.round(sampleRate * durationSeconds));
  const dataSize = sampleCount * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  // Sample bytes stay at their zero-initialized default — silence.
  const bytes = new Uint8Array(buffer);
  return { uri: `data:audio/wav;base64,${encodeBase64(bytes)}`, byteLength: bytes.byteLength };
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
export function encodeBase64(bytes: Uint8Array): string {
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
