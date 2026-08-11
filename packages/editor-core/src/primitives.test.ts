import { describe, expect, it } from "vitest";
import { cubeGeometry, sphereGeometry, planeGeometry, encodeCubeBuffer, silentWavBuffer } from "./primitives.js";

// DOC-046: sanity-checks the procedural cube primitive used by
// SceneEdit.addMesh/addAccessor/addBufferView/addBuffer's caller
// (@gltf-studio/agent-mock's add-cube template).
describe("cubeGeometry / encodeCubeBuffer (DOC-046)", () => {
  it("produces 24 vertices (4 per face x 6 faces) and 36 indices (2 tris per face)", () => {
    const geometry = cubeGeometry();
    expect(geometry.positions.length).toBe(24 * 3);
    expect(geometry.normals.length).toBe(24 * 3);
    expect(geometry.indices.length).toBe(36);
    expect(Math.max(...geometry.indices)).toBeLessThan(24);
  });

  it("every index triangle references vertices sharing the same face normal (flat shading is internally consistent)", () => {
    const geometry = cubeGeometry();
    for (let tri = 0; tri < geometry.indices.length; tri += 3) {
      const [a, b, c] = [geometry.indices[tri], geometry.indices[tri + 1], geometry.indices[tri + 2]];
      const faceOf = (i: number) => Math.floor(i / 4);
      expect(faceOf(a)).toBe(faceOf(b));
      expect(faceOf(b)).toBe(faceOf(c));
    }
  });

  it("encodeCubeBuffer round-trips: decoding the base64 data URI reproduces the exact source bytes", () => {
    const geometry = cubeGeometry();
    const encoded = encodeCubeBuffer(geometry);
    expect(encoded.uri.startsWith("data:application/octet-stream;base64,")).toBe(true);

    const base64 = encoded.uri.slice(encoded.uri.indexOf(",") + 1);
    const decoded = Buffer.from(base64, "base64");
    expect(decoded.byteLength).toBe(encoded.byteLength);

    const positions = new Float32Array(decoded.buffer, decoded.byteOffset + encoded.positions.byteOffset, geometry.positions.length);
    expect(Array.from(positions)).toEqual(Array.from(geometry.positions));

    const indices = new Uint16Array(decoded.buffer, decoded.byteOffset + encoded.indices.byteOffset, geometry.indices.length);
    expect(Array.from(indices)).toEqual(Array.from(geometry.indices));
  });

  it("byte ranges are non-overlapping and 4-byte aligned", () => {
    const encoded = encodeCubeBuffer(cubeGeometry());
    expect(encoded.positions.byteOffset % 4).toBe(0);
    expect(encoded.normals.byteOffset % 4).toBe(0);
    expect(encoded.indices.byteOffset % 4).toBe(0);
    expect(encoded.normals.byteOffset).toBe(encoded.positions.byteOffset + encoded.positions.byteLength);
    expect(encoded.indices.byteOffset).toBe(encoded.normals.byteOffset + encoded.normals.byteLength);
    expect(encoded.byteLength).toBe(encoded.indices.byteOffset + encoded.indices.byteLength);
  });
});

// DOC-047: sphere/plane primitives added for the scene tree's "+ Add" >
// Mesh submenu (specs/ux-scene-tree.md UX-206) — same flat-shaded house
// style as the cube, sanity-checked the same way.
describe("sphereGeometry (DOC-047)", () => {
  it("produces 60 vertices (3 per face x 20 icosahedron faces) and 60 indices", () => {
    const geometry = sphereGeometry();
    expect(geometry.positions.length).toBe(60 * 3);
    expect(geometry.normals.length).toBe(60 * 3);
    expect(geometry.indices.length).toBe(60);
    expect(Math.max(...geometry.indices)).toBeLessThan(60);
  });

  it("every triangle's 3 vertices share the same (unshared, per-face) normal", () => {
    const geometry = sphereGeometry();
    for (let tri = 0; tri < geometry.indices.length; tri += 3) {
      const [a, b, c] = [geometry.indices[tri], geometry.indices[tri + 1], geometry.indices[tri + 2]];
      const normalOf = (i: number) => Array.from(geometry.normals.subarray(i * 3, i * 3 + 3));
      expect(normalOf(a)).toEqual(normalOf(b));
      expect(normalOf(b)).toEqual(normalOf(c));
    }
  });

  it("every normal is a unit vector (regular icosahedron -> exact outward face normals)", () => {
    const geometry = sphereGeometry();
    for (let i = 0; i < geometry.normals.length; i += 3) {
      const [nx, ny, nz] = [geometry.normals[i], geometry.normals[i + 1], geometry.normals[i + 2]];
      expect(Math.sqrt(nx * nx + ny * ny + nz * nz)).toBeCloseTo(1, 5);
    }
  });

  it("reported min/max are the actual scanned bounds, not an assumed ±radius box", () => {
    const geometry = sphereGeometry(1);
    const expectedMin: [number, number, number] = [Infinity, Infinity, Infinity];
    const expectedMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < geometry.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        expectedMin[axis] = Math.min(expectedMin[axis], geometry.positions[i + axis]);
        expectedMax[axis] = Math.max(expectedMax[axis], geometry.positions[i + axis]);
      }
    }
    expect(geometry.min).toEqual(expectedMin);
    expect(geometry.max).toEqual(expectedMax);
  });

  it("encodeCubeBuffer (despite its name) works unchanged for sphere geometry", () => {
    const geometry = sphereGeometry();
    const encoded = encodeCubeBuffer(geometry);
    expect(encoded.uri.startsWith("data:application/octet-stream;base64,")).toBe(true);
    expect(encoded.byteLength).toBe(geometry.positions.byteLength + geometry.normals.byteLength + geometry.indices.byteLength);
  });
});

describe("planeGeometry (DOC-047)", () => {
  it("produces a single flat quad: 4 vertices, 2 triangles, one shared +Y normal", () => {
    const geometry = planeGeometry();
    expect(geometry.positions.length).toBe(4 * 3);
    expect(geometry.indices.length).toBe(6);
    for (let i = 0; i < geometry.normals.length; i += 3) {
      expect(Array.from(geometry.normals.subarray(i, i + 3))).toEqual([0, 1, 0]);
    }
  });

  it("both triangles wind CCW as seen from +Y (front-facing toward the normal)", () => {
    const geometry = planeGeometry(2);
    const at = (i: number) => Array.from(geometry.positions.subarray(i * 3, i * 3 + 3));
    for (let tri = 0; tri < geometry.indices.length; tri += 3) {
      const [a, b, c] = [at(geometry.indices[tri]), at(geometry.indices[tri + 1]), at(geometry.indices[tri + 2])];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normalY = e1[2] * e2[0] - e1[0] * e2[2];
      expect(normalY).toBeGreaterThan(0);
    }
  });

  it("size scales the quad's half-extent and min/max", () => {
    const geometry = planeGeometry(2);
    expect(geometry.min).toEqual([-1, 0, -1]);
    expect(geometry.max).toEqual([1, 0, 1]);
  });
});

describe("silentWavBuffer (DOC-047)", () => {
  it("produces a valid-looking RIFF/WAVE data: URI with all-zero (silent) samples", () => {
    const wav = silentWavBuffer();
    expect(wav.uri.startsWith("data:audio/wav;base64,")).toBe(true);
    const base64 = wav.uri.slice(wav.uri.indexOf(",") + 1);
    const decoded = Buffer.from(base64, "base64");
    expect(decoded.byteLength).toBe(wav.byteLength);
    expect(decoded.toString("ascii", 0, 4)).toBe("RIFF");
    expect(decoded.toString("ascii", 8, 12)).toBe("WAVE");
    expect(decoded.toString("ascii", 36, 40)).toBe("data");
    // Every sample byte (past the 44-byte header) is silent (zero).
    for (let i = 44; i < decoded.byteLength; i++) {
      expect(decoded[i]).toBe(0);
    }
  });

  it("respects custom sampleRate/durationSeconds", () => {
    const wav = silentWavBuffer({ sampleRate: 4000, durationSeconds: 0.1 });
    const base64 = wav.uri.slice(wav.uri.indexOf(",") + 1);
    const decoded = Buffer.from(base64, "base64");
    expect(decoded.readUInt32LE(24)).toBe(4000); // sampleRate field
    expect(decoded.byteLength).toBe(44 + 400 * 2); // 4000Hz * 0.1s * 2 bytes/sample
  });
});
