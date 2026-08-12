// Builds the "Empty scene" starter-gallery card's in-memory starter document
// (specs/ux-shell.md UX-120, supersedes UX-119's "Playground" card, Viewport.tsx):
// an asset header plus one default scene, ZERO nodes -- no fetch, no corpus
// asset. A real `.glb`, produced via `@gltfi/gltf`'s own `writeContainer` (the
// exact same container shape `e2e/global-setup.ts`'s own fixture-writing
// `writeGlb` helper builds), so it round-trips through `parseContainer` ->
// `createDocument` exactly like any other imported file -- no special-cased
// "blank document" branch anywhere in the store, and the resulting project is
// a real one (storage-persisted, undo-historied, exportable) from the first
// tick.
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export function buildEmptySceneGlb(): Uint8Array {
  const json = {
    asset: { version: "2.0", generator: "gltf-studio" },
    scene: 0,
    scenes: [{ name: "Scene" }]
  };
  const jsonText = JSON.stringify(json);
  const container: Container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  return writeContainer(container) as Uint8Array;
}
