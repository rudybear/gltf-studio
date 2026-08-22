// A dedicated e2e fixture for full punctual-light control's render-path
// coverage (e2e/lights.spec.ts): a single lit triangle ("Widget", the SAME
// front-facing-from-+Z shape `e2e/inspector-fixture.ts`'s own "Widget" uses,
// so the same front camera pose frames it) plus a spot light and a
// directional light, positioned/angled so each one's OWN contribution can be
// isolated by a deliberate starting pose:
//
//   - "Spot" light (position [0, 3, 0], IDENTITY rotation) points straight
//     down local -Z, i.e. world (0, 0, -1) — at 90° from the vector to
//     Widget's center ([0,-1,0], straight down), well outside its own
//     default cone, so it contributes ~nothing to Widget's rendered pixel
//     at import time. Rotating this node -90° about X turns its forward
//     direction into world (0, -1, 0) — dead-on at Widget — the exact
//     "spot direction follows node rotation" proof e2e/lights.spec.ts needs.
//   - "Sun" light (directional, IDENTITY rotation) points world (0, 0, -1)
//     by default — already illuminating Widget's +Z-facing surface from
//     the front, since a directional light's own EFFECT (unlike a spot's)
//     doesn't depend on its node's position, only orientation. A plain
//     intensity bump (mirroring `e2e/inspector.spec.ts`'s existing point-
//     light pixel test) is enough to pixel-confirm it renders.
//
// This is deliberately NOT the shared `e2e/inspector-fixture.ts` (which
// already carries its own point light, "Lamp", reused as-is by
// e2e/lights.spec.ts's type-conversion/helper-toggle/export-byte-diff
// coverage) — isolating spot/directional here keeps their geometry/pose
// reasoning self-contained rather than retrofitted onto a fixture several
// OTHER specs already pin indices against.
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const LIGHTS_FIXTURE_NAME = "lights-fixture.glb";
export const LIGHTS_FIXTURE_WIDGET_NODE_INDEX = 0;
export const LIGHTS_FIXTURE_SPOT_NODE_INDEX = 1;
export const LIGHTS_FIXTURE_SUN_NODE_INDEX = 2;
export const LIGHTS_FIXTURE_SPOT_LIGHT_INDEX = 0;
export const LIGHTS_FIXTURE_SUN_LIGHT_INDEX = 1;

function base64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function buildLightsFixtureBytes(): Buffer {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const combined = new Uint8Array(positionBytes.byteLength + indexBytes.byteLength);
  combined.set(positionBytes, 0);
  combined.set(indexBytes, positionBytes.byteLength);

  const json = {
    asset: { version: "2.0", generator: "gltf-studio e2e lights fixture" },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [
      { name: "Widget", mesh: 0 },
      { name: "Spot", translation: [0, 3, 0], extensions: { KHR_lights_punctual: { light: 0 } } },
      { name: "Sun", translation: [0, 0, 2], extensions: { KHR_lights_punctual: { light: 1 } } }
    ],
    meshes: [{ name: "WidgetMesh", primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      // A middling-gray, non-saturating base color (0.35, not 0.9) —
      // deliberately leaves headroom above whatever the neutral studio
      // rig's own DIMMED-but-nonzero baseline (specs/render-host.md's
      // implementation notes on `STUDIO_DIM_FACTOR`) already contributes,
      // so a real light's OWN additional contribution (Sun's intensity
      // bump, Spot's rotation-into-cone) still produces a clearly
      // measurable delta instead of both states already sitting near the
      // channel-clamp ceiling.
      { name: "Mat_Gray", pbrMetallicRoughness: { baseColorFactor: [0.35, 0.35, 0.35, 1], metallicFactor: 0, roughnessFactor: 0.8 } }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: indexBytes.byteLength }
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${base64FromBytes(combined)}`, byteLength: combined.byteLength }],
    extensions: {
      KHR_lights_punctual: {
        lights: [
          // 0 "Spot": a real, fairly bright spot — see this file's header
          // comment for why IDENTITY rotation contributes ~nothing to
          // Widget's pixel at import time.
          { name: "Spot", type: "spot", color: [1, 1, 1], intensity: 3000, spot: { innerConeAngle: 0, outerConeAngle: 0.6 } },
          // 1 "Sun": a low starting intensity specifically so a later bump
          // (mirroring the point-light intensity test's own convention)
          // produces a clearly measurable brightness delta.
          { name: "Sun", type: "directional", color: [1, 1, 1], intensity: 0.3 }
        ]
      },
      // An inert, unconnected KHR_interactivity graph (mirroring
      // e2e/global-setup.ts's own EXISTING_GRAPH) — this fixture's own
      // pointer-picker Lights-section coverage adds a real `pointer/set`
      // node via the graph canvas palette, which needs SOME existing graph
      // at index 0 to add into.
      KHR_interactivity: { declarations: [{ op: "event/onStart" }], nodes: [{ declaration: 0 }] }
    },
    extensionsUsed: ["KHR_lights_punctual", "KHR_interactivity"]
  };

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

export const LIGHTS_PLAY_FIXTURE_NAME = "lights-play-fixture.glb";
export const LIGHTS_PLAY_FIXTURE_LIGHT_INDEX = 0;

/**
 * A second, separate fixture (full punctual-light control's Play-mode
 * proof, e2e/lights.spec.ts): a lit "Widget" triangle plus one point light
 * ("Lamp", starting GREEN) and a real, runnable `KHR_interactivity` graph —
 * `event/onStart -> pointer/set(/extensions/KHR_lights_punctual/lights/0/
 * color <- [1,0,0] RED)`, mirroring `e2e/global-setup.ts`'s own `PLAY_GRAPH`
 * pattern (an `onStart`/`onSelect`-triggered `pointer/set`), just retargeted
 * at a light's color instead of a node's translation — proof that a graph
 * pointer/set on a light property applies live once Play starts, through
 * the SAME vendored pointer-router `specs/render-host.md`'s `RH-032`..
 * `RH-034` section documents as `engine-three`'s own light-family routing.
 */
export function buildLightsPlayFixtureBytes(): Buffer {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const combined = new Uint8Array(positionBytes.byteLength + indexBytes.byteLength);
  combined.set(positionBytes, 0);
  combined.set(indexBytes, positionBytes.byteLength);

  const json = {
    asset: { version: "2.0", generator: "gltf-studio e2e lights-play fixture" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: "Widget", mesh: 0 }, { name: "Lamp", translation: [0, 0, 2], extensions: { KHR_lights_punctual: { light: 0 } } }],
    meshes: [{ name: "WidgetMesh", primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      { name: "Mat_White", pbrMetallicRoughness: { baseColorFactor: [0.9, 0.9, 0.9, 1], metallicFactor: 0, roughnessFactor: 0.8 } }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: indexBytes.byteLength }
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${base64FromBytes(combined)}`, byteLength: combined.byteLength }],
    extensions: {
      KHR_lights_punctual: { lights: [{ name: "Lamp", type: "point", color: [0, 1, 0], intensity: 800 }] },
      KHR_interactivity: {
        graphs: [
          {
            types: [{ signature: "float3" }],
            variables: [],
            events: [],
            declarations: [{ op: "event/onStart" }, { op: "pointer/set" }],
            nodes: [
              { declaration: 0, flows: { out: { node: 1, socket: "in" } } },
              {
                declaration: 1,
                configuration: { pointer: { value: ["/extensions/KHR_lights_punctual/lights/0/color"] }, type: { value: [0] } },
                values: { value: { type: 0, value: [1, 0, 0] } }
              }
            ]
          }
        ]
      }
    },
    extensionsUsed: ["KHR_lights_punctual", "KHR_interactivity"]
  };

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
