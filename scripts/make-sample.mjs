#!/usr/bin/env node
// Regenerates samples/playground.glb — the "checkpoint" sample asset every
// feature in the app (viewport/inspector/graph/script/play/audio/copilot)
// can be exercised against. Built entirely in-process via the vendored
// @gltfi/* packages (the same "no corpus copying" convention
// e2e/global-setup.ts and the e2e/*-fixture.ts files already use) — this
// script is the SOURCE OF TRUTH; samples/playground.glb is a committed,
// deterministic build artifact of running it (`pnpm sample`), not a
// hand-authored binary.
//
// Scene layout (nodes[], flat parenting under one Root):
//   0 Root
//   1 Ground        -- a wide flat box, GroundMaterial (grey)
//   2 SpinningCube   -- ROTATE_NODE_INDEX below; rotated every tick (onTick)
//   3 ButtonSphere   -- BUTTON_NODE_INDEX below; the "button" mesh (onSelect)
//   4 TogglePillar   -- TOGGLE_NODE_INDEX below; translation toggles on click
//   5 Speaker        -- KHR_audio_emitter (positional), no mesh
//   6 Lamp           -- KHR_lights_punctual point light
//   7 Cam            -- a camera
//
// KHR_interactivity graph (one graph, extensions.KHR_interactivity.graphs[0]):
//   - event/onStart sets a `ready` (bool) variable -> true.
//   - event/onTick advances a running `angle` (float) variable and writes a
//     new /nodes/2/rotation quaternion (math/quatFromAxisAngle) via
//     pointer/set every tick -- continuous rotation, driven purely by
//     pointer/set (no pointer/interpolate involved here).
//   - event/onSelect (scoped to node 3, ButtonSphere) flips a `toggled`
//     (bool) variable, picks one of two target Y positions with
//     math/select, animates /nodes/4/translation to it via
//     pointer/interpolate, and (chained off pointer/interpolate's
//     synchronous "out" flow, not its later "done") immediately re-fires
//     the embedded beep by writing `true` to the KHR_audio_emitter
//     nonstandard-but-supported "playing" trigger pointer
//     (/extensions/KHR_audio_emitter/sources/0/playing -- see
//     packages/audio-webaudio/src/web-audio-host.ts's applyPointer).
//
// Audio: node 5 ("Speaker") carries a positional KHR_audio_emitter whose
// one source plays an embedded, generated (never a binary asset committed
// separately) WAV beep; a document-level KHR_audio_graph chain routes that
// same source through one processing node (a gain) into the emitter --
// mirrors e2e/global-setup.ts's own bufferSource(=emitter source) -> gain
// -> emitter chain exactly (see that file's KHR_audio_graph block for why
// there is no separate "bufferSource" graph-node kind: the emitter's own
// `sources[]` entry already plays that role via `inputs: [{ source, node }]`).
//
// This script does not just write the .glb -- it verifies it, twice, before
// ever touching disk for real:
//   1. structural: @gltfi/verify's validateGraph() over the raw graph JSON.
//   2. behavioral: the vendored @gltfi/runtime interpreter, run headless
//      (no DOM/WebGL/WebAudio) via resolveGraph + InteractivityRuntime,
//      asserting onStart/onTick/onSelect all actually produce the pointer
//      writes described above.
// Either check failing aborts with a non-zero exit and a specific message
// (never a silently-broken committed asset).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeContainer, parseContainer } from "@gltfi/gltf";
import { validateGraph } from "@gltfi/verify";
import { resolveGraph, InteractivityRuntime } from "@gltfi/runtime";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const OUT_PATH = join(repoRoot, "samples", "playground.glb");

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const BUTTON_NODE_INDEX = 3;
export const TOGGLE_NODE_INDEX = 4;
export const ROTATE_NODE_INDEX = 2;
export const SPEAKER_NODE_INDEX = 5;

// ---------------------------------------------------------------------------
// Geometry helpers -- flat-shaded box (ground/cube/pillar) and a smooth-
// shaded icosahedron (button "sphere"). Both return {positions, normals,
// indices} as plain number[] (caller packs them into Float32Array/
// Uint16Array and a shared binary buffer, same as e2e/global-setup.ts).
// ---------------------------------------------------------------------------
function makeBox(hx, hy, hz) {
  // 6 faces * 4 verts, flat per-face normals -- standard "hard edges" box.
  const faces = [
    { n: [1, 0, 0], verts: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]] },
    { n: [-1, 0, 0], verts: [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]] },
    { n: [0, 1, 0], verts: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]] },
    { n: [0, -1, 0], verts: [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]] },
    { n: [0, 0, 1], verts: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], verts: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] }
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  for (const face of faces) {
    const base = positions.length / 3;
    for (const v of face.verts) {
      positions.push(...v);
      normals.push(...face.n);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, indices };
}

function makeIcosahedron(radius) {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
  ];
  const indices = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
  ];
  const positions = [];
  const normals = [];
  for (const [x, y, z] of raw) {
    const len = Math.hypot(x, y, z);
    positions.push((x / len) * radius, (y / len) * radius, (z / len) * radius);
    normals.push(x / len, y / len, z / len);
  }
  return { positions, normals, indices };
}

/** A short, real, audible 16-bit PCM mono WAV sine "beep" -- generated in-process (mirrors e2e/wav-fixture.ts's identical helper; duplicated here since scripts/ runs as plain Node ESM outside e2e/'s ts-morph pipeline). */
function sineBeepWavBytes({ sampleRate = 22050, durationSeconds = 0.3, frequencyHz = 523.25 } = {}) {
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < sampleCount; i += 1) {
    const fade = 1 - i / sampleCount;
    const sample = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate) * 0.5 * fade;
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }
  return new Uint8Array(buffer);
}

function f32(arr) {
  return new Uint8Array(new Float32Array(arr).buffer);
}
function u16(arr) {
  return new Uint8Array(new Uint16Array(arr).buffer);
}
function base64FromBytes(bytes) {
  return Buffer.from(bytes).toString("base64");
}

// ---------------------------------------------------------------------------
// KHR_interactivity graph -- see file header for the behavior this encodes.
// ---------------------------------------------------------------------------
function buildInteractivityGraph() {
  const TYPE_FLOAT = 0;
  const TYPE_FLOAT3 = 1;
  const TYPE_FLOAT4 = 2;
  const TYPE_BOOL = 3;
  const TYPE_FLOAT2 = 4;

  const VAR_ANGLE = 0;
  const VAR_TOGGLED = 1;
  const VAR_READY = 2;

  const DECL_ON_START = 0;
  const DECL_ON_TICK = 1;
  const DECL_ON_SELECT = 2;
  const DECL_VAR_GET = 3;
  const DECL_VAR_SET = 4;
  const DECL_MATH_ADD = 5;
  const DECL_MATH_MUL = 6;
  const DECL_MATH_NOT = 7;
  const DECL_MATH_SELECT = 8;
  const DECL_QUAT_FROM_AXIS_ANGLE = 9;
  const DECL_POINTER_SET = 10;
  const DECL_POINTER_INTERPOLATE = 11;
  const DECL_MATH_ISNAN = 12;

  const ROTATE_SPEED_RAD_PER_SEC = 1.2;
  const AUDIO_PLAYING_POINTER = "/extensions/KHR_audio_emitter/sources/0/playing";

  return {
    types: [
      { signature: "float" },
      { signature: "float3" },
      { signature: "float4" },
      { signature: "bool" },
      { signature: "float2" }
    ],
    variables: [
      { id: "angle", type: TYPE_FLOAT, value: [0] },
      { id: "toggled", type: TYPE_BOOL, value: [false] },
      { id: "ready", type: TYPE_BOOL, value: [false] }
    ],
    declarations: [
      { op: "event/onStart" }, // 0
      { op: "event/onTick" }, // 1
      { op: "event/onSelect" }, // 2
      { op: "variable/get" }, // 3
      { op: "variable/set" }, // 4
      { op: "math/add" }, // 5
      { op: "math/mul" }, // 6
      { op: "math/not" }, // 7
      { op: "math/select" }, // 8
      { op: "math/quatFromAxisAngle" }, // 9
      { op: "pointer/set" }, // 10
      { op: "pointer/interpolate" }, // 11
      { op: "math/isNaN" } // 12
    ],
    // @gltfi/verify enforces backward-only "values" (pure) edges -- every
    // node a `values` entry points at by node index must appear EARLIER in
    // this array than the node referencing it. `flows` edges have no such
    // constraint (they may jump forward, e.g. node 0 -> node 1 below).
    nodes: [
      // -- onStart: node 0 -> node 1 (set `ready` <- true) --------------
      /* 0 */ { declaration: DECL_ON_START, flows: { out: { node: 1, socket: "in" } } },
      /* 1 */ {
        declaration: DECL_VAR_SET,
        // variable/set's `values` map is keyed by the VARIABLE's own index
        // (String(VAR_READY) === "2" here), not by position within
        // `configuration.variables.value` -- see @gltfi/runtime's
        // interpreter.ts "variable/set" case: `key = String(resolvedIndex)`.
        configuration: { variables: { value: [VAR_READY] } },
        values: { [String(VAR_READY)]: { type: TYPE_BOOL, value: [true] } }
      },

      // -- onTick: node 2 -> node 8 (set `angle`) -> node 10 (pointer/set rotation) --
      /* 2 */ { declaration: DECL_ON_TICK, flows: { out: { node: 8, socket: "in" } } },
      // Nodes 3/4 guard event/onTick's `timeSinceLastTick`, which the
      // vendored @gltfi/runtime interpreter deliberately reports as NaN on
      // the very first tick (no "last" tick exists yet -- see
      // @gltfi/kernel's scheduler.ts: `lastTickDelta = tickCount === 0 ?
      // NaN : delta`); without this clamp, `angle` would become NaN on
      // tick 1 and stay NaN forever (NaN propagates through every
      // arithmetic op downstream), freezing the rotation permanently.
      /* 3 */ { declaration: DECL_MATH_ISNAN, values: { a: { node: 2, socket: "timeSinceLastTick" } } },
      /* 4 */ {
        declaration: DECL_MATH_SELECT,
        values: {
          condition: { node: 3, socket: "value" },
          a: { type: TYPE_FLOAT, value: [0] },
          b: { node: 2, socket: "timeSinceLastTick" }
        }
      },
      /* 5 */ { declaration: DECL_VAR_GET, configuration: { variable: { value: [VAR_ANGLE] } } },
      /* 6 */ {
        declaration: DECL_MATH_MUL,
        values: { a: { node: 4, socket: "value" }, b: { type: TYPE_FLOAT, value: [ROTATE_SPEED_RAD_PER_SEC] } }
      },
      /* 7 */ { declaration: DECL_MATH_ADD, values: { a: { node: 5, socket: "value" }, b: { node: 6, socket: "value" } } },
      /* 8 */ {
        declaration: DECL_VAR_SET,
        // keyed by VAR_ANGLE's own index ("0") -- happens to equal position too.
        configuration: { variables: { value: [VAR_ANGLE] } },
        values: { [String(VAR_ANGLE)]: { node: 7, socket: "value" } },
        flows: { out: { node: 10, socket: "in" } }
      },
      /* 9 */ {
        declaration: DECL_QUAT_FROM_AXIS_ANGLE,
        values: { axis: { type: TYPE_FLOAT3, value: [0, 1, 0] }, angle: { node: 7, socket: "value" } }
      },
      /* 10 */ {
        declaration: DECL_POINTER_SET,
        configuration: { pointer: { value: [`/nodes/${ROTATE_NODE_INDEX}/rotation`] }, type: { value: [TYPE_FLOAT4] } },
        values: { value: { node: 9, socket: "value" } }
      },

      // -- onSelect(ButtonSphere): node 11 -> node 14 (flip `toggled`) -> node 17 (pointer/interpolate translation) -> node 18 (trigger audio) --
      /* 11 */ {
        declaration: DECL_ON_SELECT,
        configuration: { nodeIndex: { value: [BUTTON_NODE_INDEX] }, stopPropagation: { value: [false] } },
        flows: { out: { node: 14, socket: "in" } }
      },
      /* 12 */ { declaration: DECL_VAR_GET, configuration: { variable: { value: [VAR_TOGGLED] } } },
      /* 13 */ { declaration: DECL_MATH_NOT, values: { a: { node: 12, socket: "value" } } },
      /* 14 */ {
        declaration: DECL_VAR_SET,
        // keyed by VAR_TOGGLED's own index ("1"), same caveat as node 1 above.
        configuration: { variables: { value: [VAR_TOGGLED] } },
        values: { [String(VAR_TOGGLED)]: { node: 13, socket: "value" } },
        flows: { out: { node: 17, socket: "in" } }
      },
      // Node 15 -- a SECOND, separate variable/get(toggled) -- deliberately
      // does not reuse node 12/13's already-computed "flipped" value: pure
      // nodes are re-evaluated live (lazily, uncached) every time something
      // pulls them, so a select/pointer-interpolate node placed AFTER node
      // 14's flow re-reads variable state live too. Reusing node 13 here
      // instead would re-invoke `math/not` a second time against the
      // ALREADY-WRITTEN new value (node 14 runs before this is ever pulled)
      // and flip it right back -- this fixture's own generation run caught
      // exactly that bug (the toggle silently no-op'd) before this comment
      // was added.
      /* 15 */ { declaration: DECL_VAR_GET, configuration: { variable: { value: [VAR_TOGGLED] } } },
      /* 16 */ {
        declaration: DECL_MATH_SELECT,
        values: {
          condition: { node: 15, socket: "value" },
          a: { type: TYPE_FLOAT3, value: [0, 1.6, 0] },
          b: { type: TYPE_FLOAT3, value: [0, 0.2, 0] }
        }
      },
      /* 17 */ {
        declaration: DECL_POINTER_INTERPOLATE,
        configuration: { pointer: { value: [`/nodes/${TOGGLE_NODE_INDEX}/translation`] }, type: { value: [TYPE_FLOAT3] } },
        values: {
          value: { node: 16, socket: "value" },
          duration: { type: TYPE_FLOAT, value: [0.4] },
          p1: { type: TYPE_FLOAT2, value: [0.42, 0] },
          p2: { type: TYPE_FLOAT2, value: [0.58, 1] }
        },
        flows: { out: { node: 18, socket: "in" } }
      },
      /* 18 */ {
        declaration: DECL_POINTER_SET,
        configuration: { pointer: { value: [AUDIO_PLAYING_POINTER] }, type: { value: [TYPE_BOOL] } },
        values: { value: { type: TYPE_BOOL, value: [true] } }
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// Full document JSON.
// ---------------------------------------------------------------------------
function buildSceneJson() {
  const ground = makeBox(4, 0.1, 4);
  const cube = makeBox(0.5, 0.5, 0.5);
  const sphere = makeIcosahedron(0.5);
  const pillar = makeBox(0.35, 0.35, 0.35);
  const wavBytes = sineBeepWavBytes();

  const meshDefs = [
    { name: "GroundMesh", geo: ground },
    { name: "CubeMesh", geo: cube },
    { name: "SphereMesh", geo: sphere },
    { name: "PillarMesh", geo: pillar }
  ];

  // Pack every mesh's position/normal/index arrays + the WAV, back-to-back,
  // into one binary buffer -- same "no padding, byteOffset arithmetic done
  // by hand" convention e2e/global-setup.ts and e2e/inspector-fixture.ts
  // both already use for these vendored @gltfi/gltf-built fixtures.
  const chunks = [];
  const accessors = [];
  const bufferViews = [];
  const meshes = [];
  let offset = 0;
  function pushChunk(bytes) {
    const byteOffset = offset;
    chunks.push(bytes);
    offset += bytes.byteLength;
    return byteOffset;
  }

  for (const { name, geo } of meshDefs) {
    const posBytes = f32(geo.positions);
    const normBytes = f32(geo.normals);
    const idxBytes = u16(geo.indices);
    const posOffset = pushChunk(posBytes);
    const normOffset = pushChunk(normBytes);
    const idxOffset = pushChunk(idxBytes);

    const posAccessorIndex = accessors.length;
    const xs = geo.positions.filter((_, i) => i % 3 === 0);
    const ys = geo.positions.filter((_, i) => i % 3 === 1);
    const zs = geo.positions.filter((_, i) => i % 3 === 2);
    accessors.push({
      bufferView: bufferViews.length,
      componentType: 5126,
      count: geo.positions.length / 3,
      type: "VEC3",
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)]
    });
    bufferViews.push({ buffer: 0, byteOffset: posOffset, byteLength: posBytes.byteLength });

    const normAccessorIndex = accessors.length;
    accessors.push({ bufferView: bufferViews.length, componentType: 5126, count: geo.normals.length / 3, type: "VEC3" });
    bufferViews.push({ buffer: 0, byteOffset: normOffset, byteLength: normBytes.byteLength });

    const idxAccessorIndex = accessors.length;
    accessors.push({ bufferView: bufferViews.length, componentType: 5123, count: geo.indices.length, type: "SCALAR" });
    bufferViews.push({ buffer: 0, byteOffset: idxOffset, byteLength: idxBytes.byteLength });

    meshes.push({
      name,
      primitives: [
        {
          attributes: { POSITION: posAccessorIndex, NORMAL: normAccessorIndex },
          indices: idxAccessorIndex,
          material: meshes.length
        }
      ]
    });
  }

  const wavByteOffset = pushChunk(wavBytes);
  const wavBufferViewIndex = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: wavByteOffset, byteLength: wavBytes.byteLength });

  const combined = new Uint8Array(offset);
  let writeOffset = 0;
  for (const bytes of chunks) {
    combined.set(bytes, writeOffset);
    writeOffset += bytes.byteLength;
  }

  const materials = [
    { name: "GroundMaterial", pbrMetallicRoughness: { baseColorFactor: [0.55, 0.55, 0.58, 1], metallicFactor: 0.05, roughnessFactor: 0.9 } },
    { name: "CubeMaterial", pbrMetallicRoughness: { baseColorFactor: [0.82, 0.18, 0.18, 1], metallicFactor: 0.2, roughnessFactor: 0.5 } },
    { name: "SphereMaterial", pbrMetallicRoughness: { baseColorFactor: [0.2, 0.75, 0.35, 1], metallicFactor: 0.1, roughnessFactor: 0.35 }, emissiveFactor: [0.05, 0.2, 0.08] },
    { name: "PillarMaterial", pbrMetallicRoughness: { baseColorFactor: [0.2, 0.35, 0.85, 1], metallicFactor: 0.3, roughnessFactor: 0.4 } }
  ];

  const nodes = [
    { name: "Root", children: [1, 2, 3, 4, 5, 6, 7] },
    { name: "Ground", mesh: 0, translation: [0, -0.1, 0] },
    { name: "SpinningCube", mesh: 1, translation: [-1.6, 0.5, 0] },
    { name: "ButtonSphere", mesh: 2, translation: [0, 0.5, 0] },
    { name: "TogglePillar", mesh: 3, translation: [1.6, 0.2, 0] },
    { name: "Speaker", translation: [0, 0.6, 0.6], extensions: { KHR_audio_emitter: { emitter: 0 } } },
    { name: "Lamp", translation: [1, 3.5, 2.5], extensions: { KHR_lights_punctual: { light: 0 } } },
    { name: "Cam", translation: [0, 2.6, 6.5], camera: 0 }
  ];

  return {
    asset: { version: "2.0", generator: "gltf-studio samples/make-sample.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials,
    cameras: [{ type: "perspective", perspective: { yfov: 0.7, znear: 0.1 } }],
    accessors,
    bufferViews,
    buffers: [{ uri: `data:application/octet-stream;base64,${base64FromBytes(combined)}`, byteLength: combined.byteLength }],
    extensions: {
      KHR_lights_punctual: { lights: [{ type: "point", intensity: 900, color: [1, 0.96, 0.88] }] },
      KHR_interactivity: { graphs: [buildInteractivityGraph()] },
      KHR_audio_emitter: {
        audio: [{ bufferView: wavBufferViewIndex, mimeType: "audio/wav" }],
        sources: [{ audio: 0, gain: 1, loop: false }],
        emitters: [{ type: "positional", gain: 0.9, distanceModel: "inverse", sources: [0] }]
      },
      KHR_audio_graph: {
        graphs: [
          {
            nodes: [{ kind: "gain", label: "beepGain", params: { gain: 0.7 } }],
            connections: [],
            inputs: [{ source: 0, node: 0 }],
            outputs: [{ node: 0, emitter: 0 }]
          }
        ]
      }
    },
    extensionsUsed: ["KHR_lights_punctual", "KHR_interactivity", "KHR_audio_emitter", "KHR_audio_graph"]
  };
}

function buildGlbBytes(json) {
  const jsonText = JSON.stringify(json);
  const container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  return Buffer.from(writeContainer(container));
}

// ---------------------------------------------------------------------------
// Verification -- fails loudly (throws / non-zero exit), never writes a
// broken asset to disk.
// ---------------------------------------------------------------------------
function assert(condition, message) {
  if (!condition) throw new Error(`[make-sample] FAILED: ${message}`);
}

function verifyStructural(json) {
  const graph = json.extensions.KHR_interactivity.graphs[0];
  const result = validateGraph(graph);
  if (!result.ok) {
    console.error("[make-sample] @gltfi/verify diagnostics:");
    for (const d of result.diagnostics) console.error(`  - ${JSON.stringify(d)}`);
  }
  assert(result.ok, "@gltfi/verify.validateGraph reported the sample's KHR_interactivity graph as invalid (see diagnostics above).");
  console.log(`[make-sample] structural: @gltfi/verify OK (${graph.nodes.length} nodes, 0 diagnostics)`);
}

function verifyBehavioral(json) {
  const graph = resolveGraph(json);
  const pointerLog = [];
  const runtime = new InteractivityRuntime(graph, json, null);
  runtime.bindAdapter({
    applyPointer(pointer, value) {
      pointerLog.push({ pointer, value });
    }
  });

  runtime.start();
  assert(runtime.getVariableByIndex(2)?.data?.[0] === true, "onStart did not set the `ready` variable to true.");

  // Drive several ticks to exercise onTick's continuous rotation.
  for (let i = 0; i < 5; i += 1) runtime.tick(0.1);
  const rotationWrites = pointerLog.filter((p) => p.pointer === `/nodes/${ROTATE_NODE_INDEX}/rotation`);
  assert(rotationWrites.length >= 5, `onTick should have written /nodes/${ROTATE_NODE_INDEX}/rotation at least once per tick (got ${rotationWrites.length} writes over 5 ticks).`);
  const firstQuat = rotationWrites[0].value;
  const lastQuat = rotationWrites[rotationWrites.length - 1].value;
  assert(JSON.stringify(firstQuat) !== JSON.stringify(lastQuat), "onTick's rotation quaternion did not change between ticks -- the cube would appear frozen.");

  // Fire onSelect on the button node, exercising the toggle + interpolate + audio-trigger chain.
  const engine = runtime.asEngineLike();
  pointerLog.length = 0;
  engine.fireSelect(BUTTON_NODE_INDEX, [0, 0.5, 0]);
  const audioTriggers = pointerLog.filter((p) => p.pointer === "/extensions/KHR_audio_emitter/sources/0/playing" && p.value === true);
  assert(audioTriggers.length === 1, `onSelect should synchronously trigger the audio-playing pointer exactly once (got ${audioTriggers.length}).`);

  for (let i = 0; i < 8; i += 1) runtime.tick(0.1);
  const translationWrites = pointerLog.filter((p) => p.pointer === `/nodes/${TOGGLE_NODE_INDEX}/translation`);
  assert(translationWrites.length >= 1, `onSelect's pointer/interpolate should have written /nodes/${TOGGLE_NODE_INDEX}/translation during playback (got ${translationWrites.length} writes).`);
  const finalY = translationWrites[translationWrites.length - 1].value[1];
  assert(Math.abs(finalY - 1.6) < 0.05, `TogglePillar's translation should have interpolated to y~1.6 after one click (got y=${finalY}).`);

  // A second click should toggle back toward the other target.
  pointerLog.length = 0;
  engine.fireSelect(BUTTON_NODE_INDEX, [0, 0.5, 0]);
  for (let i = 0; i < 8; i += 1) runtime.tick(0.1);
  const secondTranslationWrites = pointerLog.filter((p) => p.pointer === `/nodes/${TOGGLE_NODE_INDEX}/translation`);
  const secondFinalY = secondTranslationWrites[secondTranslationWrites.length - 1]?.value?.[1];
  assert(secondFinalY !== undefined && Math.abs(secondFinalY - 0.2) < 0.05, `A second click should toggle TogglePillar's translation back toward y~0.2 (got y=${secondFinalY}).`);

  console.log("[make-sample] behavioral: @gltfi/runtime headless run OK (onStart/onTick/onSelect all observed via pointer writes)");
}

function verifyRoundTrip(bytes) {
  const reparsed = parseContainer(new Uint8Array(bytes));
  assert(reparsed.kind === "glb", "round-trip: parseContainer did not recognize the written bytes as a .glb container.");
  const graph = reparsed.json.extensions?.KHR_interactivity?.graphs?.[0];
  assert(graph, "round-trip: the re-parsed document lost its KHR_interactivity graph.");
  const result = validateGraph(graph);
  assert(result.ok, "round-trip: the re-parsed document's graph failed @gltfi/verify.validateGraph.");
  console.log(`[make-sample] round-trip: parseContainer + re-validate OK (${bytes.byteLength} bytes)`);
}

function main() {
  const json = buildSceneJson();
  verifyStructural(json);
  verifyBehavioral(json);
  const bytes = buildGlbBytes(json);
  verifyRoundTrip(bytes);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, bytes);
  console.log(`[make-sample] wrote ${OUT_PATH} (${bytes.byteLength} bytes)`);
}

main();
