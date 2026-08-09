import { describe, expect, it } from "vitest";
import { cubeGeometry, encodeCubeBuffer } from "./primitives.js";

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
