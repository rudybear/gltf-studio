// e2e fixture for PC-011 / RH-036 (e2e/active-camera.spec.ts): one lit
// triangle plus a runnable KHR_interactivity graph that, every tick, copies
// the activeCamera pointers into variables the play overlay displays:
//   camPos  (float3) <- pointer/get /extensions/KHR_interactivity/activeCamera/position
//   camYfov (float)  <- pointer/get /extensions/KHR_interactivity/activeCamera/perspective/yfov
// Both start NaN (float defaults), so any real number on screen proves the
// viewport camera reached the engine.
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;
export const ACTIVE_CAMERA_FIXTURE_NAME = "active-camera-fixture.glb";

export function buildActiveCameraFixtureBytes(): Buffer {
  const AC = "/extensions/KHR_interactivity/activeCamera";
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2, 0]); // padded to 4-byte alignment
  const posBytes = new Uint8Array(positions.buffer);
  const idxBytes = new Uint8Array(indices.buffer);
  const combined = new Uint8Array(posBytes.byteLength + idxBytes.byteLength);
  combined.set(posBytes, 0);
  combined.set(idxBytes, posBytes.byteLength);
  const json = {
    asset: { version: "2.0", generator: "gltf-studio e2e active-camera fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Widget", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength },
      { buffer: 0, byteOffset: posBytes.byteLength, byteLength: 6 }
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${Buffer.from(combined).toString("base64")}`, byteLength: combined.byteLength }],
    extensionsUsed: ["KHR_interactivity"],
    extensions: {
      KHR_interactivity: {
        graph: 0,
        graphs: [
          {
            types: [{ signature: "float" }, { signature: "float3" }],
            variables: [
              { id: "camPos", type: 1 },
              { id: "camYfov", type: 0 }
            ],
            events: [],
            declarations: [{ op: "event/onTick" }, { op: "pointer/get" }, { op: "variable/set" }],
            nodes: [
              { declaration: 0, configuration: {}, values: {}, flows: { out: { node: 3, socket: "in" } } },
              { declaration: 1, configuration: { pointer: { value: [`${AC}/position`] }, type: { value: [1] } }, values: {}, flows: {} },
              { declaration: 1, configuration: { pointer: { value: [`${AC}/perspective/yfov`] }, type: { value: [0] } }, values: {}, flows: {} },
              { declaration: 2, configuration: { variables: { value: [0] } }, values: { "0": { node: 1, socket: "value" } }, flows: { out: { node: 4, socket: "in" } } },
              { declaration: 2, configuration: { variables: { value: [1] } }, values: { "1": { node: 2, socket: "value" } }, flows: {} }
            ]
          }
        ]
      }
    }
  };
  const jsonText = JSON.stringify(json);
  const container: Container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  return Buffer.from(writeContainer(container) as Uint8Array);
}
