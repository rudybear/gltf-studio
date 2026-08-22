// A dedicated e2e fixture for audio viewport helpers (e2e/audio-helpers.spec.ts,
// specs/render-host.md RH-035, specs/ux-viewport.md UX-314): two nodes, both
// EXTENSION-ONLY (no mesh — an emitter/zone node has no rendered geometry of
// its own, so anything visible for either one MUST be its own editor
// helper), deliberately CO-LOCATED at the world origin so a single fixed
// camera pose frames both without needing to re-aim between tests (the two
// kinds never render at the same time anyway — visibility is fully gated by
// selection/the helpers toggle, RH-035/UX-314 — so co-location can't make
// one kind's pixels bleed into the other's assertion).
//
//   0 "ConeEmitter" — a positional, cone-shaped emitter (refDistance 0.3,
//     maxDistance 1.0 — the helper's own range-sphere radius, RH-035) with a
//     wide-ish cone (innerAngle 0.4 rad, outerAngle 1.3 rad) so its own cone
//     volume is unambiguously visible, not just a degenerate sliver.
//   1 "Zone"        — a KHR_audio_environment sphere zone, radius 0.9.
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const AUDIO_HELPERS_FIXTURE_NAME = "audio-helpers-fixture.glb";
export const AUDIO_HELPERS_EMITTER_NODE_INDEX = 0;
export const AUDIO_HELPERS_ZONE_NODE_INDEX = 1;

export function buildAudioHelpersFixtureBytes(): Buffer {
  const json = {
    asset: { version: "2.0", generator: "gltf-studio e2e audio-helpers fixture" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "ConeEmitter", extensions: { KHR_audio_emitter: { emitter: 0 } } },
      { name: "Zone", extensions: { KHR_audio_environment: { environment: 0, shape: { type: "sphere", radius: 0.9 } } } }
    ],
    extensionsUsed: ["KHR_audio_emitter", "KHR_audio_environment"],
    extensions: {
      KHR_audio_emitter: {
        emitters: [
          {
            name: "Cone",
            type: "positional",
            positional: { shapeType: "cone", refDistance: 0.3, maxDistance: 1.0, coneInnerAngle: 0.4, coneOuterAngle: 1.3 }
          }
        ]
      },
      KHR_audio_environment: { environments: [{ name: "Reverb" }] }
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
  const bytes = writeContainer(container) as Uint8Array;
  return Buffer.from(bytes);
}
