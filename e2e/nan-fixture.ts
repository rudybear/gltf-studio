// e2e fixture for the NaN UX audit (e2e/nan-literals.spec.ts): a graph whose
// literals/variable defaults are OMITTED `value`s (spec: float defaults are
// NaN). Mirrors what the glTF-Test-Assets-Interactivity corpus ships (e.g.
// math/isNaN `a: {type: float}`, pointer/interpolate `p2: {type: float2}`).
//
//   var 0 "f"  float  (no value)       var 1 "v3" float3 (no value)
//   node 0 onStart -> 1 pointer/set(/materials/0/pbrMetallicRoughness/baseColorFactor, float4 value OMITTED)
//   node 1 -> 2 pointer/set(/nodes/0/scale, float3 value OMITTED)
//   node 2 -> 3 variable/set(f <- math/add(a OMITTED float, b = 1))
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;
export const NAN_FIXTURE_NAME = "nan-fixture.glb";

export function buildNanFixtureJson(): Record<string, unknown> {
  return {
    asset: { version: "2.0", generator: "gltf-studio e2e nan fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Widget" }],
    materials: [{ name: "Mat", pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.8, 1] } }],
    extensionsUsed: ["KHR_interactivity"],
    extensions: {
      KHR_interactivity: {
        graph: 0,
        graphs: [
          {
            types: [{ signature: "float" }, { signature: "float3" }, { signature: "float4" }],
            variables: [
              { id: "f", type: 0 },
              { id: "v3", type: 1 }
            ],
            events: [],
            declarations: [{ op: "event/onStart" }, { op: "pointer/set" }, { op: "variable/set" }, { op: "math/add" }],
            nodes: [
              { declaration: 0, flows: { out: { node: 1, socket: "in" } } },
              {
                declaration: 1,
                configuration: { pointer: { value: ["/materials/0/pbrMetallicRoughness/baseColorFactor"] }, type: { value: [2] } },
                values: { value: { type: 2 } },
                flows: { out: { node: 4, socket: "in" } }
              },
              { declaration: 2, configuration: { variables: { value: [0] } }, values: { "0": { node: 3, socket: "value" } } },
              { declaration: 3, values: { a: { type: 0 }, b: { type: 0, value: [1] } } },
              {
                declaration: 1,
                configuration: { pointer: { value: ["/nodes/0/scale"] }, type: { value: [1] } },
                values: { value: { type: 1 } },
                flows: { out: { node: 2, socket: "in" } }
              }
            ]
          }
        ]
      }
    }
  };
}

export function buildNanFixtureBytes(): Buffer {
  const json = buildNanFixtureJson();
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
