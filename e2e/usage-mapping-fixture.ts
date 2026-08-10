// A dedicated e2e fixture for usage-mapping coverage (e2e/usage-mapping.spec.ts)
// — deliberately NOT the shared global-setup.ts fixture (other specs pin
// exact node counts/indices against it, see e2e/inspector-fixture.ts's own
// header note for the same reasoning) and not e2e/inspector-fixture.ts
// either (that one carries no KHR_interactivity graph at all). Three flat
// scene nodes, a small real behavior graph with exactly two references:
//   0 "Prop_01" — targeted by graph node 1 (pointer/set -> /nodes/0/translation)
//   1 "Prop_02" — targeted by graph node 0 (event/onSelect, nodeIndex: 1),
//                 flow-connected into node 1's pointer/set (a real, if
//                 trivial, handler -> effect graph, not two disconnected nodes)
//   2 "Prop_03" — zero references (specs/ux-usage-mapping.md UX-1109's
//                 zero-ref/"Attach behavior…" stub state)
// Prop_01/Prop_02 each get a small real triangle mesh (same geometry as
// e2e/inspector-fixture.ts's, translated apart) so the viewport's
// selection/reference-highlight BoxHelper outlines (RH-022/RH-029) have
// real, non-degenerate geometry to wrap — an empty transform-only node has
// no bounding box for a BoxHelper to draw. Built in-process via the real
// `@gltfi/gltf` `writeContainer` (same approach as inspector-fixture.ts),
// handed to Playwright as an in-memory buffer.
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const USAGE_MAPPING_FIXTURE_NAME = "usage-mapping-fixture.glb";

export const USAGE_FIXTURE_NODE = { PROP_01: 0, PROP_02: 1, PROP_03: 2 } as const;
/** Graph-node indices within `extensions.KHR_interactivity.graphs[0].nodes[]`. */
export const USAGE_FIXTURE_GRAPH_NODE = { ON_SELECT: 0, POINTER_SET: 1 } as const;

function base64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function buildUsageMappingFixtureJson(): Record<string, unknown> {
  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const combined = new Uint8Array(positionBytes.byteLength + indexBytes.byteLength);
  combined.set(positionBytes, 0);
  combined.set(indexBytes, positionBytes.byteLength);

  return {
    asset: { version: "2.0", generator: "gltf-studio e2e usage-mapping fixture" },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [
      { name: "Prop_01", mesh: 0, translation: [-2, 0, 0] },
      { name: "Prop_02", mesh: 0, translation: [2, 0, 0] },
      { name: "Prop_03" }
    ],
    meshes: [
      {
        name: "TriMesh",
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }]
      }
    ],
    materials: [{ name: "Mat_Green", pbrMetallicRoughness: { baseColorFactor: [0.2, 0.8, 0.3, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: indexBytes.byteLength }
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${base64FromBytes(combined)}`, byteLength: combined.byteLength }],
    extensionsUsed: ["KHR_interactivity"],
    extensions: {
      KHR_interactivity: {
        graph: 0,
        graphs: [
          {
            types: [{ signature: "float3" }],
            declarations: [{ op: "event/onSelect" }, { op: "pointer/set" }],
            variables: [],
            events: [],
            nodes: [
              {
                declaration: 0,
                configuration: { nodeIndex: { value: [1] }, stopPropagation: { value: [false] } },
                flows: { out: { node: 1, socket: "in" } },
                extras: { gltfi: { x: 20, y: 20 } }
              },
              {
                declaration: 1,
                configuration: { pointer: { value: ["/nodes/0/translation"] }, type: { value: [0] } },
                values: { value: { type: 0, value: [0, 0, 0] } },
                flows: {},
                extras: { gltfi: { x: 320, y: 20 } }
              }
            ]
          }
        ]
      }
    }
  };
}

export function buildUsageMappingFixtureBytes(): Buffer {
  const json = buildUsageMappingFixtureJson();
  const jsonText = JSON.stringify(json);
  const container: Container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  const bytes = writeContainer(container) as Uint8Array;
  return Buffer.from(bytes);
}
