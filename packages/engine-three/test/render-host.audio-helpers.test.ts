// Audio viewport helpers (specs/render-host.md RH-035, the audio follow-up
// to RH-032..034's shared editor-overlay seam): engine-three-specific
// coverage mirroring render-host.light-helpers.test.ts's own shape — the
// generic contract suite (packages/contract-tests/src/render-host.ts) only
// proves setEditorHelpers never throws for an "audio-emitter"/"audio-zone"
// descriptor; the REAL per-kind geometry, multi-emitter grouping, and
// snapshot/leak discipline are this implementation's own coverage.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createThreeRenderHost } from "../src/index.js";
import {
  buildFixtureGlb,
  FIXTURE_AUDIO_EMITTER_CONE_NODE_INDEX,
  FIXTURE_AUDIO_EMITTER_GLOBAL_NODE_INDEX,
  FIXTURE_AUDIO_EMITTER_MULTI_NODE_INDEX,
  FIXTURE_AUDIO_ZONE_NODE_INDEX,
  FIXTURE_HIT_NODE_INDEX
} from "./fixture.js";

function createContainer(): HTMLElement {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "320px";
  container.style.height = "240px";
  document.body.appendChild(container);
  return container;
}

type Introspectable = {
  editorHelperGroup: THREE.Group | null;
  editorHelperObjects: Map<string, THREE.Object3D>;
};

function internals(host: ReturnType<typeof createThreeRenderHost>): Introspectable {
  return host as unknown as Introspectable;
}

describe("engine-three ThreeRenderHost audio-emitter helpers (RH-035)", () => {
  it("a positional cone emitter grows a range sphere + outer/inner cone wedge, all children of one tracked helper", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    host.setEditorHelpers([{ kind: "audio-emitter", nodeIndex: FIXTURE_AUDIO_EMITTER_CONE_NODE_INDEX }]);
    const { editorHelperGroup, editorHelperObjects } = internals(host);
    expect(editorHelperGroup!.children.length).toBe(1);
    expect(editorHelperObjects.size).toBe(1);
    // One emitter shape group (range sphere + outer cone + inner cone) nested under the per-node tracked wrapper.
    const helper = editorHelperGroup!.children[0];
    const meshes: THREE.Object3D[] = [];
    helper.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child);
    });
    expect(meshes.length).toBe(3); // range sphere, outer cone wedge, inner cone wedge.

    host.dispose();
    container.remove();
  });

  it("a global (non-positional) emitter grows a speaker glyph, not a range sphere", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    host.setEditorHelpers([{ kind: "audio-emitter", nodeIndex: FIXTURE_AUDIO_EMITTER_GLOBAL_NODE_INDEX }]);
    const helper = internals(host).editorHelperGroup!.children[0];
    const meshes: THREE.Mesh[] = [];
    helper.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    expect(meshes.length).toBe(1);
    expect(meshes[0].geometry).toBeInstanceOf(THREE.OctahedronGeometry);

    host.dispose();
    container.remove();
  });

  it("a multi-emitter node (PR #59's .emitters array) grows one shape per bound emitter — a range sphere/cone AND a speaker glyph", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    host.setEditorHelpers([{ kind: "audio-emitter", nodeIndex: FIXTURE_AUDIO_EMITTER_MULTI_NODE_INDEX }]);
    const { editorHelperGroup, editorHelperObjects } = internals(host);
    expect(editorHelperGroup!.children.length).toBe(1); // still one map entry — multi-emitter grouping happens INSIDE the one helper.
    expect(editorHelperObjects.size).toBe(1);
    const meshes: THREE.Mesh[] = [];
    editorHelperGroup!.children[0].traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    // The cone emitter's 3 shapes (sphere + 2 cone wedges) plus the global emitter's 1 speaker glyph.
    expect(meshes.length).toBe(4);

    host.dispose();
    container.remove();
  });

  it("positions the helper at the referencing node's world position (tracks a live gizmo-style transform, not just the node's authored translation)", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    host.setEditorHelpers([{ kind: "audio-emitter", nodeIndex: FIXTURE_AUDIO_EMITTER_CONE_NODE_INDEX }]);
    const helper = internals(host).editorHelperGroup!.children[0];
    expect(helper.position.x).toBeCloseTo(0);
    expect(helper.position.y).toBeCloseTo(0);
    expect(helper.position.z).toBeCloseTo(-2); // fixture's ConeEmitter node translation.

    host.dispose();
    container.remove();
  });

  it("does not add a helper for a real node with no emitter binding, or for an unresolvable node index (skip, never throw)", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    expect(() => host.setEditorHelpers([{ kind: "audio-emitter", nodeIndex: FIXTURE_HIT_NODE_INDEX }])).not.toThrow();
    expect(internals(host).editorHelperGroup!.children.length).toBe(0);

    expect(() => host.setEditorHelpers([{ kind: "audio-emitter", nodeIndex: 999 }])).not.toThrow();
    expect(internals(host).editorHelperGroup!.children.length).toBe(0);

    host.dispose();
    container.remove();
  });
});

describe("engine-three ThreeRenderHost audio-zone helpers (RH-035)", () => {
  it("a KHR_audio_environment sphere zone grows one translucent volume (fill mesh + wireframe edges)", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    host.setEditorHelpers([{ kind: "audio-zone", nodeIndex: FIXTURE_AUDIO_ZONE_NODE_INDEX }]);
    const { editorHelperGroup, editorHelperObjects } = internals(host);
    expect(editorHelperGroup!.children.length).toBe(1);
    expect(editorHelperObjects.size).toBe(1);
    const helper = editorHelperGroup!.children[0];
    let meshCount = 0;
    let lineCount = 0;
    helper.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshCount++;
      if ((child as THREE.LineSegments).isLineSegments) lineCount++;
    });
    expect(meshCount).toBe(1);
    expect(lineCount).toBe(1);

    host.dispose();
    container.remove();
  });

  it("does not add a helper for a real node with no zone shape, or for an unresolvable node index (skip, never throw)", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    expect(() => host.setEditorHelpers([{ kind: "audio-zone", nodeIndex: FIXTURE_HIT_NODE_INDEX }])).not.toThrow();
    expect(internals(host).editorHelperGroup!.children.length).toBe(0);

    expect(() => host.setEditorHelpers([{ kind: "audio-zone", nodeIndex: 999 }])).not.toThrow();
    expect(internals(host).editorHelperGroup!.children.length).toBe(0);

    host.dispose();
    container.remove();
  });
});

describe("engine-three ThreeRenderHost audio helpers — lifecycle shared with light helpers (RH-033/RH-034)", () => {
  it("setEditorHelpers([]) clears the overlay group and disposes every tracked audio helper (leak discipline)", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    host.setEditorHelpers([
      { kind: "audio-emitter", nodeIndex: FIXTURE_AUDIO_EMITTER_MULTI_NODE_INDEX },
      { kind: "audio-zone", nodeIndex: FIXTURE_AUDIO_ZONE_NODE_INDEX }
    ]);
    expect(internals(host).editorHelperGroup!.children.length).toBe(2);

    host.setEditorHelpers([]);
    expect(internals(host).editorHelperGroup!.children.length).toBe(0);
    expect(internals(host).editorHelperObjects.size).toBe(0);

    host.dispose();
    container.remove();
  });

  it("repeated setEditorHelpers calls (light + audio-emitter + audio-zone together) do not leak renderer.info geometry/texture counts", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    const descriptors = [
      { kind: "audio-emitter" as const, nodeIndex: FIXTURE_AUDIO_EMITTER_MULTI_NODE_INDEX },
      { kind: "audio-zone" as const, nodeIndex: FIXTURE_AUDIO_ZONE_NODE_INDEX }
    ];
    host.setEditorHelpers(descriptors);
    const afterFirst = host.getRendererStats();

    host.setEditorHelpers(descriptors);
    const afterSecond = host.getRendererStats();
    expect(afterSecond).toEqual(afterFirst);

    host.setEditorHelpers([]);
    host.dispose();
    container.remove();
  });

  it("a reload (loadScene called again) clears every previously-set audio helper — the caller re-applies via its own reloadSeq-style effect", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());
    host.setEditorHelpers([{ kind: "audio-zone", nodeIndex: FIXTURE_AUDIO_ZONE_NODE_INDEX }]);
    expect(internals(host).editorHelperGroup!.children.length).toBe(1);

    await host.loadScene(buildFixtureGlb());
    expect(internals(host).editorHelperGroup!.children.length).toBe(0);
    expect(internals(host).editorHelperObjects.size).toBe(0);

    host.dispose();
    container.remove();
  });

  it("snapshot() hides audio helpers too, same as light helpers (RH-034 — one shared editorHelperGroup)", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());
    host.setEditorHelpers([{ kind: "audio-zone", nodeIndex: FIXTURE_AUDIO_ZONE_NODE_INDEX }]);

    const renderer = (host as unknown as { renderer: THREE.WebGLRenderer }).renderer;
    let helperGroupVisibleDuringRender: boolean | undefined;
    const originalRender = renderer.render.bind(renderer);
    renderer.render = ((...args: Parameters<typeof originalRender>) => {
      if (helperGroupVisibleDuringRender === undefined) {
        helperGroupVisibleDuringRender = internals(host).editorHelperGroup!.visible;
      }
      return originalRender(...args);
    }) as typeof originalRender;

    const blob = await host.snapshot();
    expect(blob).toBeInstanceOf(Blob);
    expect(helperGroupVisibleDuringRender).toBe(false);
    expect(internals(host).editorHelperGroup!.visible).toBe(true);

    host.dispose();
    container.remove();
  });
});
