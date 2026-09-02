#!/usr/bin/env node
// Regenerates samples/champagne.glb -- the THIRD starter-gallery card
// (specs/ux-shell.md UX-120's "Empty scene"/"R4 Racer" pair, now joined by
// "Champagne") and, unlike either of those two, a small showcase of the
// SOURCE->GRAPH transpiler pipeline in its own right: this script's
// interactivity graph is authored as real TypeScript ("GIscript" --
// packages/script-panel's own vocabulary for the subset @gltfi/parse-ts
// accepts, see docs/design/ir-and-transpiler.md's "GIscript subset" and the
// sibling gltf-interactivity-game repo's src/game.template.ts for the
// proven, hand-authored precedent this file's own graph source mirrors),
// compiled in-process via parseModule -> exportGraph -> validateGraph,
// exactly the same pipeline the Script tab's "Apply" button drives on a
// live document (packages/script-panel/src/equivalence.ts). This is the
// PREFERRED authoring path for a graph meant to be opened and read by
// curious users (the Script tab shows real, readable code, not a decompile
// of hand-poked JSON) -- scripts/make-sample.mjs authors its (much smaller)
// graph as direct JSON instead, since that script predates this convention
// and its graph is deliberately minimal scaffolding, not a showcase.
//
// Scene layout (nodes[], flat parenting under one Root):
//   0  Root
//   1  Ground        -- a wide flat disc, GroundMaterial (grey), scenery
//   2  Bottle        -- BOTTLE_NODE_INDEX below; 3 primitives (glass body,
//                        gold-foil neck, cream label quad), scenery
//                        (KHR_node_selectability selectable:false)
//   3  Cork          -- CORK_NODE_INDEX below; THE interactive node (no
//                        selectability override -- selectable/hoverable
//                        default true, the racer convention's mirror
//                        image), carries a positional KHR_audio_emitter
//   4..9 FoamBurst0..5 -- FOAM_NODE_INDICES below; 6 small spheres sharing
//                        one mesh, scenery, KHR_node_visibility
//                        visible:false initially (the "burst" pops into
//                        view, never rendered until popped)
//   10 Lamp          -- KHR_lights_punctual point light
//   11 Cam           -- a camera, framed on the bottle
//
// KHR_interactivity graph (one graph, extensions.KHR_interactivity.graphs[0]):
// event/onSelect scoped to Cork (node 3) is the ENTIRE graph -- see
// buildChampagneGiscript()'s doc comment below for the exact pop/reset
// behavior it encodes, and verifyBehavioral() below for the headless,
// two-click (pop then reset) proof that it actually does what its comments
// say before this script ever writes bytes to disk.
//
// Audio: Cork's own KHR_audio_emitter source plays an embedded, generated
// (never a binary asset committed separately) "cork pop" WAV -- a ~5ms
// noise transient (the crack) layered with a short low-frequency thump
// (the body knock) and a soft filtered-noise fizz tail, all synthesized
// in-process by popWavBytes() below (the sine-beep generator in
// e2e/global-setup.ts/make-sample.mjs is a single pure tone; this is a
// three-layer percussive/textural synth instead, deterministic via a
// seeded PRNG so the committed .glb is byte-reproducible run to run) --
// routed through a one-node KHR_audio_graph gain chain, same convention as
// make-sample.mjs's Speaker.
//
// This script does not just write the .glb -- it verifies it, three times,
// before ever touching disk for real:
//   1. GIscript compile: @gltfi/parse-ts's parseModule + @gltfi/ir's
//      exportGraph, asserting zero diagnostics from either stage.
//   2. structural: @gltfi/verify's validateGraph() over the exported graph.
//   3. behavioral: the vendored @gltfi/runtime interpreter, run headless,
//      firing onSelect on Cork twice (pop, then reset) and asserting every
//      pointer write / variable flip the header above promises.
// Any check failing aborts with a non-zero exit and a specific message
// (never a silently-broken committed asset).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeContainer, parseContainer } from "@gltfi/gltf";
import { parseModule } from "@gltfi/parse-ts";
import { exportGraph } from "@gltfi/ir";
import { validateGraph } from "@gltfi/verify";
import { resolveGraph, InteractivityRuntime } from "@gltfi/runtime";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const OUT_PATH = join(repoRoot, "samples", "champagne.glb");

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const CORK_NODE_INDEX = 3;
export const BOTTLE_NODE_INDEX = 2;
export const FOAM_NODE_INDICES = [4, 5, 6, 7, 8, 9];
export const AUDIO_PLAYING_POINTER = "/extensions/KHR_audio_emitter/sources/0/playing";

// Cork's own authored rest pose -- the graph's "reset" branch below
// interpolates back to these EXACT literals so a post-reset document is
// pixel-identical to a freshly-loaded one, not just "close enough".
const CORK_REST_TRANSLATION = [0, 2.62, 0];
const CORK_REST_ROTATION = [0, 0, 0, 1];

// ---------------------------------------------------------------------------
// Small vector helper (generation-time only -- never emitted into the
// GIscript source itself, which always gets pre-normalized literal
// arrays: math/quatFromAxisAngle's axis input is spec'd as already-unit,
// and there's no reason to spend a graph node on m.normalize(...) for a
// value known exactly at generation time).
// ---------------------------------------------------------------------------
function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
const CORK_SPIN_AXIS = normalize3([0.3, 1, 0.15]).map((x) => Math.round(x * 1e4) / 1e4);

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * A solid of revolution around the Y axis, built from a `[radius, y]`
 * silhouette profile (bottom to top) -- ring-segment tessellation, `segments`
 * verts per ring, SHARED (not duplicated) around the full 360 degrees since
 * nothing here needs a UV seam. Per-vertex normals are the profile's own
 * analytic 2D outward normal (each edge's outward normal is
 * `normalize(dy, -dr)` -- rotate the edge tangent -90 degrees; averaged
 * between a profile point's two neighboring edges for a smooth band-to-band
 * blend), NOT a flat per-face normal: `packages/engine-three` never calls
 * `computeVertexNormals()` (see `editor-core/src/primitives.ts`'s own header
 * comment on exactly this), so a lathe with only flat per-face normals would
 * look faceted/wrong under the default lit material -- this is deliberately
 * smooth-shaded instead, the "reads as glass" look the bottle needs.
 * `capBottom`/`capTop` add a flat, single-normal triangle-fan disc at the
 * profile's first/last ring (winding chosen so each cap's face is front-
 * facing from the direction its flat normal points -- glTF's default
 * `doubleSided:false` means a flipped winding would render invisible, not
 * just mis-lit).
 */
function latheGeometry(profile, segments, { capBottom = false, capTop = false } = {}) {
  const ringCount = profile.length;
  const edgeNormals = [];
  for (let i = 0; i < ringCount - 1; i += 1) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    const dr = r1 - r0;
    const dy = y1 - y0;
    const len = Math.hypot(dy, dr) || 1;
    edgeNormals.push([dy / len, -dr / len]);
  }
  const pointNormals = profile.map((_, i) => {
    if (ringCount === 1) return [0, 1];
    if (i === 0) return edgeNormals[0];
    if (i === ringCount - 1) return edgeNormals[edgeNormals.length - 1];
    const [ax, ay] = edgeNormals[i - 1];
    const [bx, by] = edgeNormals[i];
    const len = Math.hypot(ax + bx, ay + by) || 1;
    return [(ax + bx) / len, (ay + by) / len];
  });

  const positions = [];
  const normals = [];
  const indices = [];

  for (let ri = 0; ri < ringCount; ri += 1) {
    const [r, y] = profile[ri];
    const [nr, ny] = pointNormals[ri];
    for (let s = 0; s < segments; s += 1) {
      const theta = (s / segments) * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      positions.push(r * ct, y, r * st);
      normals.push(nr * ct, ny, nr * st);
    }
  }
  for (let ri = 0; ri < ringCount - 1; ri += 1) {
    for (let s = 0; s < segments; s += 1) {
      const sNext = (s + 1) % segments;
      const a = ri * segments + s;
      const b = ri * segments + sNext;
      const c = (ri + 1) * segments + s;
      const d = (ri + 1) * segments + sNext;
      indices.push(a, c, b, b, c, d);
    }
  }

  function addCap(ringIndex, normalY) {
    const [r, y] = profile[ringIndex];
    const centerIndex = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, normalY, 0);
    const ringStart = centerIndex + 1;
    for (let s = 0; s < segments; s += 1) {
      const theta = (s / segments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      normals.push(0, normalY, 0);
    }
    for (let s = 0; s < segments; s += 1) {
      const sNext = (s + 1) % segments;
      if (normalY > 0) {
        indices.push(centerIndex, ringStart + s, ringStart + sNext);
      } else {
        indices.push(centerIndex, ringStart + sNext, ringStart + s);
      }
    }
  }
  if (capBottom) addCap(0, -1);
  if (capTop) addCap(ringCount - 1, 1);

  return { positions, normals, indices };
}

/** A flat, single-sided, top-facing (+Y) disc -- the ground plane. */
function discGeometry(radius, segments) {
  const positions = [0, 0, 0];
  const normals = [0, 1, 0];
  for (let s = 0; s < segments; s += 1) {
    const theta = (s / segments) * Math.PI * 2;
    positions.push(radius * Math.cos(theta), 0, radius * Math.sin(theta));
    normals.push(0, 1, 0);
  }
  const indices = [];
  for (let s = 0; s < segments; s += 1) {
    const sNext = (s + 1) % segments;
    indices.push(0, 1 + s, 1 + sNext);
  }
  return { positions, normals, indices };
}

/** A single-sided quad facing +Z, centered at (0, centerY, z) -- the label. */
function quadGeometry(width, height, centerY, z) {
  const hw = width / 2;
  const hh = height / 2;
  const positions = [-hw, centerY - hh, z, hw, centerY - hh, z, hw, centerY + hh, z, -hw, centerY + hh, z];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const indices = [0, 1, 2, 0, 2, 3];
  return { positions, normals, indices };
}

/** Smooth-shaded icosahedron (foam spheres) -- verbatim from scripts/make-sample.mjs. */
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

// ---------------------------------------------------------------------------
// Audio: a synthesized "cork pop" WAV -- deterministic (seeded PRNG, no
// Math.random()) so this committed asset is byte-reproducible run to run.
// Three layered components over ~0.55s: a ~5ms white-noise transient (the
// crack) with a fast exponential decay, a short low-frequency (85Hz) sine
// "thump" (the body knock), and a soft one-pole-lowpassed noise "fizz" tail
// at low gain that outlasts both.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function popWavBytes({ sampleRate = 22050, durationSeconds = 0.55 } = {}) {
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

  const rand = mulberry32(0xc0ffee);
  let fizzLpState = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    let s = 0;

    // Crack: ~5ms of energy (fast exponential decay, effectively silent by ~15ms).
    const crackEnv = Math.exp(-t / 0.0035);
    s += (rand() * 2 - 1) * crackEnv * 0.9;

    // Thump: low body knock, decaying over ~90ms.
    const thumpEnv = Math.exp(-t / 0.09);
    s += Math.sin(2 * Math.PI * 85 * t) * thumpEnv * 0.55;

    // Fizz tail: soft (one-pole-lowpassed) noise, low gain, slow decay,
    // starting just after the crack and lasting the rest of the clip.
    if (t > 0.008) {
      const raw = rand() * 2 - 1;
      fizzLpState = fizzLpState * 0.72 + raw * 0.28;
      const fizzEnv = Math.exp(-(t - 0.008) / 0.32) * 0.14;
      s += fizzLpState * fizzEnv;
    }

    const clamped = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// GIscript source (compiled via @gltfi/parse-ts -> @gltfi/ir, NOT hand-
// authored JSON -- see this file's header comment for why). Behavior:
//
// `V.popped`/`V.animating` gate a single event/onSelect on Cork (node 3):
//   - First click (!popped && !animating): sets popped, fires the audio
//     "playing" trigger pointer, reveals the 6 foam spheres via staggered
//     KHR_node_visibility pointer/set writes (0/40/80/120/160/200ms), and
//     launches Cork on a two-phase pointer/interpolate arc -- an ease-out
//     "up and sideways" phase chained (via its own `done` continuation,
//     NOT a separate setDelay -- pointer/interpolate already carries its
//     own completion flow) into an ease-in "down and further sideways"
//     phase, giving a gravity-arc feel from just two interpolates. Cork's
//     rotation gets its own two chained pointer/interpolate calls around
//     the SAME normalized axis, timed to the translation's two phases, for
//     a continuous ~309-degree tumble (2.8rad then on to 5.4rad -- each
//     hop under pi radians so slerp always continues forward, never flips
//     direction). Bottle gets a small, independent recoil tilt-and-back
//     (its own two chained interpolates) purely as a flourish -- it does
//     not gate `animating` at all.
//   - Second click (popped && !animating): hides the foam immediately and
//     interpolates Cork back to its exact authored rest pose, clearing
//     `popped` once that settles -- replayable indefinitely in the editor.
//   - Any click while `animating` (mid pop OR mid reset) is a no-op --
//     neither branch's condition matches.
// ---------------------------------------------------------------------------
function buildChampagneGiscript() {
  const CORK = CORK_NODE_INDEX;
  const BOTTLE = BOTTLE_NODE_INDEX;
  const [F0, F1, F2, F3, F4, F5] = FOAM_NODE_INDICES;
  const foamVis = (i) => `/nodes/${i}/extensions/KHR_node_visibility/visible`;
  const [ax, ay, az] = CORK_SPIN_AXIS;

  return `import { createEngine, m } from "@gltfi/runtime-lib";

// Champagne starter (specs/ux-shell.md UX-120's third gallery card): click
// the cork to pop it -- audio cue, a two-phase gravity-arc launch with a
// continuous tumble, a staggered foam burst, and a small bottle recoil.
// Click it again once settled to reset for another go.
export default createEngine((rt) => {
  const V = rt.vars({
    popped: rt.withId("popped", rt.bool(false)),
    animating: rt.withId("animating", rt.bool(false))
  });
  rt.events({});

  const foamDelay1 = rt.delayState();
  const foamDelay2 = rt.delayState();
  const foamDelay3 = rt.delayState();
  const foamDelay4 = rt.delayState();
  const foamDelay5 = rt.delayState();

  rt.onSelect(${CORK}, false, () => {
    if (!V.popped && !V.animating) {
      V.animating = true;
      V.popped = true;
      rt.ptrSet("${AUDIO_PLAYING_POINTER}", "bool", true);

      rt.ptrSet("${foamVis(F0)}", "bool", true);
      // Each nested continuation below must sit immediately before the one
      // async call it belongs to (parse-ts pairs a function declaration
      // with the very next statement in its own block, purely
      // positionally) -- hence one function-then-call pair per foam
      // sphere, not a block of five declarations followed by five calls.
      function revealFoam1() {
        rt.ptrSet("${foamVis(F1)}", "bool", true);
      }
      rt.setDelay(foamDelay1, 0.04, revealFoam1);
      function revealFoam2() {
        rt.ptrSet("${foamVis(F2)}", "bool", true);
      }
      rt.setDelay(foamDelay2, 0.08, revealFoam2);
      function revealFoam3() {
        rt.ptrSet("${foamVis(F3)}", "bool", true);
      }
      rt.setDelay(foamDelay3, 0.12, revealFoam3);
      function revealFoam4() {
        rt.ptrSet("${foamVis(F4)}", "bool", true);
      }
      rt.setDelay(foamDelay4, 0.16, revealFoam4);
      function revealFoam5() {
        rt.ptrSet("${foamVis(F5)}", "bool", true);
      }
      rt.setDelay(foamDelay5, 0.2, revealFoam5);

      // Cork's two-phase arc: phase 1 (ease-out, up-and-sideways) has no
      // continuation of its own for ROTATION (that call sits alone, right
      // above corkPopFall's declaration, so it is never mistaken for
      // corkPopFall's pairing); phase 1's TRANSLATION call chains into
      // corkPopFall, which fires phase 2 (ease-in, "falling" further
      // sideways) for both rotation and translation, the latter chaining
      // into corkPopLanded to clear the animating guard once the whole
      // arc has settled.
      rt.ptrInterp("/nodes/${CORK}/rotation", "float4", m.quatFromAxisAngle([${ax}, ${ay}, ${az}], 2.8), 0.22, [0, 0], [0.58, 1], undefined);
      function corkPopFall() {
        rt.ptrInterp("/nodes/${CORK}/rotation", "float4", m.quatFromAxisAngle([${ax}, ${ay}, ${az}], 5.4), 0.32, [0.42, 0], [1, 1], undefined);
        function corkPopLanded() {
          V.animating = false;
        }
        rt.ptrInterp("/nodes/${CORK}/translation", "float3", [0.2, 2.7, 0.09], 0.32, [0.42, 0], [1, 1], corkPopLanded);
      }
      rt.ptrInterp("/nodes/${CORK}/translation", "float3", [0.09, 2.86, 0.04], 0.22, [0, 0], [0.58, 1], corkPopFall);

      // Bottle recoil: a small, independent flourish -- tilt then back --
      // that never touches animating at all.
      function bottleRecoilBack() {
        rt.ptrInterp("/nodes/${BOTTLE}/rotation", "float4", [0, 0, 0, 1], 0.28, [0.42, 0], [0.58, 1], undefined);
      }
      rt.ptrInterp("/nodes/${BOTTLE}/rotation", "float4", m.quatFromAxisAngle([0, 0, 1], 0.12), 0.12, [0, 0], [0.58, 1], bottleRecoilBack);
    } else if (V.popped && !V.animating) {
      V.animating = true;

      rt.ptrSet("${foamVis(F0)}", "bool", false);
      rt.ptrSet("${foamVis(F1)}", "bool", false);
      rt.ptrSet("${foamVis(F2)}", "bool", false);
      rt.ptrSet("${foamVis(F3)}", "bool", false);
      rt.ptrSet("${foamVis(F4)}", "bool", false);
      rt.ptrSet("${foamVis(F5)}", "bool", false);

      // Rotation reset has no continuation (sits alone); translation reset
      // chains into resetSettled to clear popped/animating once Cork is
      // back at its exact authored rest pose.
      rt.ptrInterp("/nodes/${CORK}/rotation", "float4", [${CORK_REST_ROTATION.join(", ")}], 0.35, [0.42, 0], [0.58, 1], undefined);
      function resetSettled() {
        V.popped = false;
        V.animating = false;
      }
      rt.ptrInterp("/nodes/${CORK}/translation", "float3", [${CORK_REST_TRANSLATION.join(", ")}], 0.35, [0.42, 0], [0.58, 1], resetSettled);
    }
  });
});
`;
}

function findVarIndex(graph, id) {
  const index = graph.variables.findIndex((v) => v.id === id);
  if (index < 0) throw new Error(`[make-champagne] FAILED: no exported variable with id "${id}"`);
  return index;
}

// ---------------------------------------------------------------------------
// GIscript -> graph pipeline (parseModule -> exportGraph -> validateGraph).
// ---------------------------------------------------------------------------
function buildInteractivityGraph() {
  const source = buildChampagneGiscript();
  const { module, diagnostics: parseDiagnostics } = parseModule(source);
  if (parseDiagnostics.length > 0) {
    console.error("[make-champagne] @gltfi/parse-ts diagnostics:");
    for (const d of parseDiagnostics) console.error(`  - ${JSON.stringify(d)}`);
    throw new Error("[make-champagne] FAILED: GIscript source failed to parse (see diagnostics above).");
  }

  const { graph, diagnostics: exportDiagnostics } = exportGraph(module);
  if (exportDiagnostics.length > 0) {
    console.error("[make-champagne] @gltfi/ir exportGraph diagnostics:");
    for (const d of exportDiagnostics) console.error(`  - ${JSON.stringify(d)}`);
    throw new Error("[make-champagne] FAILED: exportGraph reported diagnostics (see above).");
  }
  console.log(`[make-champagne] GIscript compile: parseModule + exportGraph OK (${graph.nodes.length} graph nodes)`);
  return graph;
}

// ---------------------------------------------------------------------------
// Full document JSON.
// ---------------------------------------------------------------------------
function buildSceneJson() {
  const graph = buildInteractivityGraph();

  const ground = discGeometry(3.2, 48);

  // Bottle: body (glass) profile bottom -> shoulder -> neck start, then a
  // SEPARATE neck (foil) profile sharing the junction point's exact (r, y)
  // so the two primitives meet with no visible gap (their normals are
  // computed independently per-primitive, so there is a faint shading seam
  // right at the join -- an honest, minor cosmetic gap, not a structural
  // one; see the PR description).
  const bodyProfile = [
    [0.4, 0],
    [0.4, 1.55],
    [0.34, 1.72],
    [0.24, 1.86],
    [0.16, 1.95]
  ];
  const neckProfile = [
    [0.16, 1.95],
    [0.16, 2.55],
    [0.19, 2.58],
    [0.16, 2.62]
  ];
  const bottleBody = latheGeometry(bodyProfile, 28, { capBottom: true });
  const bottleNeck = latheGeometry(neckProfile, 28, { capTop: true });
  const label = quadGeometry(0.5, 0.65, 0.85, 0.41);

  const corkProfile = [
    [0.135, 0],
    [0.135, 0.2],
    [0.21, 0.225],
    [0.21, 0.29],
    [0, 0.33]
  ];
  const cork = latheGeometry(corkProfile, 20, { capBottom: true });

  const foamSphere = makeIcosahedron(0.06);

  const materials = [
    { name: "GroundMaterial", pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.52, 1], metallicFactor: 0.05, roughnessFactor: 0.85 } },
    { name: "BottleGlassMaterial", pbrMetallicRoughness: { baseColorFactor: [0.04, 0.16, 0.08, 1], metallicFactor: 0.1, roughnessFactor: 0.15 } },
    { name: "GoldFoilMaterial", pbrMetallicRoughness: { baseColorFactor: [0.83, 0.68, 0.21, 1], metallicFactor: 1, roughnessFactor: 0.25 } },
    { name: "LabelMaterial", pbrMetallicRoughness: { baseColorFactor: [0.96, 0.94, 0.88, 1], metallicFactor: 0, roughnessFactor: 0.6 } },
    { name: "CorkMaterial", pbrMetallicRoughness: { baseColorFactor: [0.72, 0.55, 0.35, 1], metallicFactor: 0, roughnessFactor: 0.8 } },
    { name: "FoamMaterial", pbrMetallicRoughness: { baseColorFactor: [0.97, 0.96, 0.9, 1], metallicFactor: 0, roughnessFactor: 0.9 } }
  ];

  const chunks = [];
  const accessors = [];
  const bufferViews = [];
  let offset = 0;
  function pushChunk(bytes) {
    const byteOffset = offset;
    chunks.push(bytes);
    offset += bytes.byteLength;
    return byteOffset;
  }

  function pushGeometry(geo) {
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

    return { attributes: { POSITION: posAccessorIndex, NORMAL: normAccessorIndex }, indices: idxAccessorIndex };
  }

  const meshes = [
    { name: "GroundMesh", primitives: [{ ...pushGeometry(ground), material: 0 }] },
    {
      name: "BottleMesh",
      primitives: [
        { ...pushGeometry(bottleBody), material: 1 },
        { ...pushGeometry(bottleNeck), material: 2 },
        { ...pushGeometry(label), material: 3 }
      ]
    },
    { name: "CorkMesh", primitives: [{ ...pushGeometry(cork), material: 4 }] },
    { name: "FoamMesh", primitives: [{ ...pushGeometry(foamSphere), material: 5 }] }
  ];

  const wavBytes = popWavBytes();
  const wavByteOffset = pushChunk(wavBytes);
  const wavBufferViewIndex = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: wavByteOffset, byteLength: wavBytes.byteLength });

  const combined = new Uint8Array(offset);
  let writeOffset = 0;
  for (const bytes of chunks) {
    combined.set(bytes, writeOffset);
    writeOffset += bytes.byteLength;
  }

  // Foam burst positions: a loose ring around the neck mouth (y ~2.62), all
  // hidden (KHR_node_visibility visible:false) until the pop reveals them.
  const foamPositions = [
    [0.12, 2.78, 0.05],
    [-0.1, 2.85, 0.1],
    [0.03, 2.9, -0.12],
    [-0.13, 2.8, -0.08],
    [0.15, 2.95, -0.02],
    [-0.02, 2.72, 0.15]
  ];

  const nodes = [
    { name: "Root", children: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    { name: "Ground", mesh: 0, translation: [0, -0.05, 0], extensions: { KHR_node_selectability: { selectable: false } } },
    { name: "Bottle", mesh: 1, extensions: { KHR_node_selectability: { selectable: false } } },
    { name: "Cork", mesh: 2, translation: CORK_REST_TRANSLATION, rotation: CORK_REST_ROTATION, extensions: { KHR_audio_emitter: { emitter: 0 } } },
    ...foamPositions.map((translation, i) => ({
      name: `FoamBurst${i}`,
      mesh: 3,
      translation,
      extensions: {
        KHR_node_selectability: { selectable: false },
        KHR_node_visibility: { visible: false }
      }
    })),
    { name: "Lamp", translation: [1.2, 3.4, 2.2], extensions: { KHR_lights_punctual: { light: 0 } } },
    { name: "Cam", translation: [0, 1.7, 5.4], camera: 0 }
  ];

  return {
    asset: { version: "2.0", generator: "gltf-studio scripts/make-champagne.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials,
    cameras: [{ type: "perspective", perspective: { yfov: 0.65, znear: 0.1 } }],
    accessors,
    bufferViews,
    buffers: [{ uri: `data:application/octet-stream;base64,${base64FromBytes(combined)}`, byteLength: combined.byteLength }],
    extensions: {
      KHR_lights_punctual: { lights: [{ type: "point", intensity: 1100, color: [1, 0.97, 0.9] }] },
      KHR_interactivity: { graphs: [graph] },
      KHR_audio_emitter: {
        audio: [{ bufferView: wavBufferViewIndex, mimeType: "audio/wav" }],
        sources: [{ audio: 0, gain: 1, loop: false }],
        emitters: [{ type: "positional", gain: 1, distanceModel: "inverse", sources: [0] }]
      },
      KHR_audio_graph: {
        graphs: [
          {
            nodes: [{ kind: "gain", label: "popGain", params: { gain: 0.8 } }],
            connections: [],
            inputs: [{ source: 0, node: 0 }],
            outputs: [{ node: 0, emitter: 0 }]
          }
        ]
      }
    },
    extensionsUsed: [
      "KHR_lights_punctual",
      "KHR_interactivity",
      "KHR_audio_emitter",
      "KHR_audio_graph",
      "KHR_node_selectability",
      "KHR_node_visibility"
    ]
  };
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
  if (!condition) throw new Error(`[make-champagne] FAILED: ${message}`);
}

function verifyStructural(json) {
  const graph = json.extensions.KHR_interactivity.graphs[0];
  const result = validateGraph(graph);
  if (!result.ok) {
    console.error("[make-champagne] @gltfi/verify diagnostics:");
    for (const d of result.diagnostics) console.error(`  - ${JSON.stringify(d)}`);
  }
  assert(result.ok, "@gltfi/verify.validateGraph reported the champagne graph as invalid (see diagnostics above).");
  console.log(`[make-champagne] structural: @gltfi/verify OK (${graph.nodes.length} nodes, 0 diagnostics)`);
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function verifyBehavioral(json) {
  const graph = json.extensions.KHR_interactivity.graphs[0];
  const poppedIdx = findVarIndex(graph, "popped");
  const animatingIdx = findVarIndex(graph, "animating");

  const resolved = resolveGraph(json);
  const pointerLog = [];
  const runtime = new InteractivityRuntime(resolved, json, null);
  runtime.bindAdapter({
    applyPointer(pointer, value) {
      pointerLog.push({ pointer, value });
    }
  });
  runtime.start();

  const boolVar = (idx) => runtime.getVariableByIndex(idx)?.data?.[0];
  assert(boolVar(poppedIdx) === false, "popped should start false.");
  assert(boolVar(animatingIdx) === false, "animating should start false.");

  const engine = runtime.asEngineLike();
  const foamVisPointer = (i) => `/nodes/${i}/extensions/KHR_node_visibility/visible`;
  const cornerTranslationPointer = `/nodes/${CORK_NODE_INDEX}/translation`;
  const cornerRotationPointer = `/nodes/${CORK_NODE_INDEX}/rotation`;

  // --- First click: pop -----------------------------------------------
  engine.fireSelect(CORK_NODE_INDEX, [0, 2.7, 0]);
  assert(boolVar(poppedIdx) === true, "onSelect should set popped=true synchronously on the first click.");
  assert(boolVar(animatingIdx) === true, "onSelect should set animating=true synchronously on the first click.");
  const audioTriggers = pointerLog.filter((p) => p.pointer === AUDIO_PLAYING_POINTER && p.value === true);
  assert(audioTriggers.length === 1, `onSelect should synchronously trigger the audio-playing pointer exactly once (got ${audioTriggers.length}).`);
  const firstFoamWrite = pointerLog.filter((p) => p.pointer === foamVisPointer(FOAM_NODE_INDICES[0]) && p.value === true);
  assert(firstFoamWrite.length === 1, "onSelect should synchronously reveal the first foam sphere (no delay on that one).");

  // A same-tick re-click must be a no-op (the `animating` guard) -- prove
  // it BEFORE ticking forward, while animating is still true.
  const beforeGuardCheckLen = pointerLog.length;
  engine.fireSelect(CORK_NODE_INDEX, [0, 2.7, 0]);
  assert(pointerLog.length === beforeGuardCheckLen, "a re-click while animating must not produce any further pointer writes (animating guard).");
  assert(boolVar(poppedIdx) === true, "a re-click while animating must not change popped.");

  // Drive enough ticks to cover every staggered foam delay (<=0.2s) and the
  // full two-phase pop arc (0.22 + 0.32 = 0.54s).
  for (let i = 0; i < 24; i += 1) runtime.tick(0.03);

  for (const i of FOAM_NODE_INDICES) {
    const writes = pointerLog.filter((p) => p.pointer === foamVisPointer(i) && p.value === true);
    assert(writes.length >= 1, `foam sphere at node ${i} should have been revealed (visible:true) during the pop.`);
  }
  const translationWrites = pointerLog.filter((p) => p.pointer === cornerTranslationPointer);
  assert(translationWrites.length >= 2, `Cork's translation should have been written repeatedly during the pop arc (got ${translationWrites.length}).`);
  const finalTranslation = translationWrites[translationWrites.length - 1].value;
  assert(dist3(finalTranslation, [0.2, 2.7, 0.09]) < 0.05, `Cork should have landed near [0.2, 2.7, 0.09] after the pop arc (got ${JSON.stringify(finalTranslation)}).`);
  const rotationWrites = pointerLog.filter((p) => p.pointer === cornerRotationPointer);
  assert(rotationWrites.length >= 2, "Cork's rotation should have been written repeatedly during the pop tumble.");
  assert(JSON.stringify(rotationWrites[0].value) !== JSON.stringify(CORK_REST_ROTATION), "Cork's rotation should have changed from its rest pose during the pop tumble.");
  assert(boolVar(animatingIdx) === false, "animating should clear back to false once the pop arc settles.");
  assert(boolVar(poppedIdx) === true, "popped should remain true once the pop arc settles (only a second click resets it).");
  console.log(`[make-champagne] behavioral (pop): audio trigger, staggered foam reveal (${FOAM_NODE_INDICES.length} spheres), and two-phase cork arc all observed via pointer writes.`);

  // --- Second click: reset ---------------------------------------------
  pointerLog.length = 0;
  engine.fireSelect(CORK_NODE_INDEX, [0.2, 2.7, 0.09]);
  assert(boolVar(animatingIdx) === true, "the reset click should set animating=true synchronously.");
  for (const i of FOAM_NODE_INDICES) {
    const hideWrites = pointerLog.filter((p) => p.pointer === foamVisPointer(i) && p.value === false);
    assert(hideWrites.length === 1, `foam sphere at node ${i} should be hidden synchronously on the reset click.`);
  }
  const noAudioOnReset = pointerLog.filter((p) => p.pointer === AUDIO_PLAYING_POINTER);
  assert(noAudioOnReset.length === 0, "the reset click should not replay the pop sound.");

  for (let i = 0; i < 16; i += 1) runtime.tick(0.03);

  const resetTranslationWrites = pointerLog.filter((p) => p.pointer === cornerTranslationPointer);
  assert(resetTranslationWrites.length >= 1, "Cork's translation should have been written during the reset interpolation.");
  const restoredTranslation = resetTranslationWrites[resetTranslationWrites.length - 1].value;
  assert(dist3(restoredTranslation, CORK_REST_TRANSLATION) < 0.01, `Cork should be back at its exact rest translation after reset (got ${JSON.stringify(restoredTranslation)}).`);
  const resetRotationWrites = pointerLog.filter((p) => p.pointer === cornerRotationPointer);
  assert(resetRotationWrites.length >= 1, "Cork's rotation should have been written during the reset interpolation.");
  const restoredRotation = resetRotationWrites[resetRotationWrites.length - 1].value;
  assert(dist3(restoredRotation, CORK_REST_ROTATION) < 0.01, `Cork should be back at its exact rest rotation after reset (got ${JSON.stringify(restoredRotation)}).`);
  assert(boolVar(poppedIdx) === false, "popped should clear back to false once the reset settles.");
  assert(boolVar(animatingIdx) === false, "animating should clear back to false once the reset settles.");
  console.log("[make-champagne] behavioral (reset): foam hidden synchronously, cork interpolated back to its exact rest pose, popped/animating both cleared.");
}

function verifyRoundTrip(bytes) {
  const reparsed = parseContainer(new Uint8Array(bytes));
  assert(reparsed.kind === "glb", "round-trip: parseContainer did not recognize the written bytes as a .glb container.");
  const graph = reparsed.json.extensions?.KHR_interactivity?.graphs?.[0];
  assert(graph, "round-trip: the re-parsed document lost its KHR_interactivity graph.");
  const result = validateGraph(graph);
  assert(result.ok, "round-trip: the re-parsed document's graph failed @gltfi/verify.validateGraph.");
  console.log(`[make-champagne] round-trip: parseContainer + re-validate OK (${bytes.byteLength} bytes)`);
}

function main() {
  const json = buildSceneJson();
  verifyStructural(json);
  verifyBehavioral(json);
  const bytes = buildGlbBytes(json);
  verifyRoundTrip(bytes);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, bytes);
  console.log(`[make-champagne] wrote ${OUT_PATH} (${bytes.byteLength} bytes)`);
}

main();
