// Generates the e2e fixture .glb once per Playwright run — a tiny synthetic
// 4-node scene, built in-process via vendored @gltfi/gltf's real
// `writeContainer` (never a corpus asset copied into this repo, per this
// program's "no corpus copying" rule). Node 0 (root, a group) has children
// 1 (a mesh node) and 2 (a light node); node 1 has child 3 (a nested mesh
// node) — enough hierarchy depth to exercise the scene tree's indent/twisty
// behavior (UX-200/UX-201) without needing real geometry/accessors, since
// the app only reads `nodes`/`meshes`/`materials`/`animations` JSON, never
// renders the mesh data itself at M2 (the viewport is still a placeholder).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const FIXTURE_GLB_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "simple-scene.glb");

function buildFixtureJson(): Record<string, unknown> {
  return {
    asset: { version: "2.0", generator: "gltf-studio e2e fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "Root", children: [1, 2] },
      { name: "Widget", mesh: 0, children: [3] },
      { name: "KeyLight", extensions: { KHR_lights_punctual: { light: 0 } } },
      { name: "Widget_Detail", mesh: 0 }
    ],
    meshes: [{ name: "WidgetMesh", primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: "WidgetMaterial", pbrMetallicRoughness: { baseColorFactor: [0.8, 0.2, 0.2, 1] } }],
    animations: [{ name: "Idle", channels: [{ target: { node: 1, path: "rotation" } }], samplers: [] }],
    extensions: { KHR_lights_punctual: { lights: [{ type: "point" }] } },
    extensionsUsed: ["KHR_lights_punctual"]
  };
}

export default function globalSetup(): void {
  const json = buildFixtureJson();
  const jsonText = JSON.stringify(json);
  const container: Container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  const bytes = writeContainer(container) as Uint8Array;

  mkdirSync(dirname(FIXTURE_GLB_PATH), { recursive: true });
  writeFileSync(FIXTURE_GLB_PATH, bytes);
}
