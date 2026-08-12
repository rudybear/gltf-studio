// A tiny GLB fixture for render-host.material-extras.test.ts: one triangle
// node with ONE material carrying a real (decodable, not just
// structurally-present) baseColorTexture — a 2x2 PNG embedded as a `data:`
// URI image, the simplest valid-image shape GLTFLoader accepts with no
// bufferView/binary-chunk bookkeeping needed — plus `doubleSided: true` so
// UX-415's doubleSided-toggle test has a real starting value to flip.
import { writeGlb, type GltfDocument } from "@gltfi/gltf";

const FLOAT = 5126;
const VEC3 = "VEC3";

// 2x2 PNG (red/green/blue/yellow), generated once via pngjs (`PNG.sync.write`)
// and pasted here as a static base64 literal — never hand-edited byte-by-byte.
// e2e/inspector-fixture.ts's own textured-material addition uses the exact
// same generation approach (pngjs is already a repo devDependency) for its
// baseColorTexture image.
const CHECKER_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR4AQXBAQEAAAjDIG7/zhNE0k3CAz7tBf7utunjAAAAAElFTkSuQmCC";

export const MATERIAL_EXTRAS_MATERIAL_INDEX = 0;

export function buildMaterialExtrasFixtureGlb(): ArrayBuffer {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const positionBytes = new Uint8Array(positions.buffer);
  const normalBytes = new Uint8Array(normals.buffer);
  const binary = new Uint8Array(positionBytes.byteLength + normalBytes.byteLength);
  binary.set(positionBytes, 0);
  binary.set(normalBytes, positionBytes.byteLength);

  const json = {
    asset: { version: "2.0", generator: "gltf-studio engine-three material-extras test fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Widget", mesh: 0 }],
    meshes: [{ name: "WidgetMesh", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    materials: [
      {
        name: "Textured",
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } }
      }
    ],
    textures: [{ source: 0 }],
    images: [{ uri: CHECKER_PNG_DATA_URI }],
    accessors: [
      { bufferView: 0, componentType: FLOAT, count: 3, type: VEC3, min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: FLOAT, count: 3, type: VEC3 }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: normalBytes.byteLength }
    ],
    buffers: [{ byteLength: binary.byteLength }]
  };

  const doc: GltfDocument = { json: json as GltfDocument["json"], binaryChunk: binary.buffer as ArrayBuffer };
  return writeGlb(doc);
}
