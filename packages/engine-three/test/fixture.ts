// A tiny, hand-built GLB fixture for engine-three's contract-test suite: two
// nodes with meshes + one material + a (structurally valid but inert —
// engine-three never runs the interactivity interpreter, only
// registerInteractivity's index-table-building side of the plugin, see
// render-host.ts's header comment) KHR_interactivity graph with one
// onSelect handler. Built via @gltfi/gltf's writeGlb rather than copying a
// corpus asset, per the M2 task brief ("no corpus copying").
//
// Layout (world space):
//   node 0 "Hit"   — a flat, double-sided triangle spanning roughly
//                    [-1,1]x[-1,1] at z=0, centered at the origin.
//   node 1 "Decoy" — the same geometry, translated far away to [10,10,10]
//                    so it never intersects a ray from the fixed camera
//                    pose the contract tests use (setCameraPose to
//                    position [0,0,3], identity rotation, looking straight
//                    down -Z at node 0).
import { writeGlb, type GltfDocument } from "@gltfi/gltf";

const FLOAT = 5126;
const VEC3 = "VEC3";

export const FIXTURE_HIT_NODE_INDEX = 0;
export const FIXTURE_DECOY_NODE_INDEX = 1;

export function buildFixtureGlb(): ArrayBuffer {
  // 3 vertices: (-1,-1,0), (1,-1,0), (0,1,0) — CCW as viewed from +Z (glTF's
  // front-facing winding), plus a matching +Z-facing normal per vertex.
  // doubleSided:true on the material below makes winding correctness a
  // non-issue for raycasting either way, but is kept correct anyway.
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);

  const positionBytes = new Uint8Array(positions.buffer);
  const normalBytes = new Uint8Array(normals.buffer);
  const binary = new Uint8Array(positionBytes.byteLength + normalBytes.byteLength);
  binary.set(positionBytes, 0);
  binary.set(normalBytes, positionBytes.byteLength);

  const json = {
    asset: { version: "2.0", generator: "gltf-studio engine-three contract-test fixture" },
    extensionsUsed: ["KHR_interactivity"],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "Hit", mesh: 0, translation: [0, 0, 0] },
      { name: "Decoy", mesh: 1, translation: [10, 10, 10] }
    ],
    meshes: [
      { name: "HitMesh", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] },
      { name: "DecoyMesh", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }
    ],
    materials: [
      {
        name: "FixtureRed",
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0, roughnessFactor: 1 }
      }
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: FLOAT,
        count: 3,
        type: VEC3,
        min: [-1, -1, 0],
        max: [1, 1, 0]
      },
      {
        bufferView: 1,
        componentType: FLOAT,
        count: 3,
        type: VEC3
      }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: normalBytes.byteLength }
    ],
    buffers: [{ byteLength: binary.byteLength }],
    extensions: {
      KHR_interactivity: {
        graphs: [
          {
            types: [{ signature: "bool" }],
            variables: [{ id: "selected", type: 0, value: [false] }],
            events: [],
            declarations: [{ op: "event/onSelect" }, { op: "variable/set" }],
            nodes: [
              {
                declaration: 0,
                configuration: { nodeIndex: { value: [0] } },
                flows: { out: { node: 1, socket: "in" } }
              },
              {
                declaration: 1,
                configuration: { variables: { value: [0] } },
                values: { "0": { type: 0, value: [true] } }
              }
            ]
          }
        ]
      }
    }
  };

  const doc: GltfDocument = { json: json as GltfDocument["json"], binaryChunk: binary.buffer as ArrayBuffer };
  return writeGlb(doc);
}
