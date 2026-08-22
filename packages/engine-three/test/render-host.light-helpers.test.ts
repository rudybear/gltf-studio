// Full punctual-light control (specs/render-host.md RH-032..RH-034,
// specs/ux-viewport.md's studio-lighting section): engine-three-specific
// coverage for the shared editor-overlay seam's ONE v1 consumer (light
// helpers) plus the neutral studio-rig AUTO policy — both implementation
// details no portable RenderHost contract test can assert (the generic
// suite, packages/contract-tests/src/render-host.ts, only proves
// setEditorHelpers never throws; it has no light node in its fixture at
// all and no notion of "studio rig" — that concept belongs to this
// implementation, not the interface).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createThreeRenderHost } from "../src/index.js";
import { buildFixtureGlb, FIXTURE_HIT_NODE_INDEX, FIXTURE_LIGHT_NODE_INDEX } from "./fixture.js";

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
  studioHemisphereLight: THREE.HemisphereLight | null;
  studioDirectionalLight: THREE.DirectionalLight | null;
  editorHelperGroup: THREE.Group | null;
  editorHelperObjects: Map<string, THREE.Object3D>;
  renderer: THREE.WebGLRenderer;
};

function internals(host: ReturnType<typeof createThreeRenderHost>): Introspectable {
  return host as unknown as Introspectable;
}

/** A minimal glTF JSON document with NO KHR_lights_punctual lights at all — the studio-rig AUTO policy's "no authored lights" branch. */
function noLightsGltfJson(): unknown {
  return {
    asset: { version: "2.0", generator: "gltf-studio engine-three light-helpers test fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Empty" }]
  };
}

describe("engine-three ThreeRenderHost light helpers (RH-032/RH-033)", () => {
  it("setEditorHelpers({kind:'light'}) on a real light node adds exactly one SpotLightHelper/PointLightHelper/DirectionalLightHelper to the dedicated overlay group", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    host.setEditorHelpers([{ kind: "light", nodeIndex: FIXTURE_LIGHT_NODE_INDEX }]);
    const { editorHelperGroup, editorHelperObjects } = internals(host);
    expect(editorHelperGroup!.children.length).toBe(1);
    expect(editorHelperObjects.size).toBe(1);
    expect(editorHelperGroup!.children[0]).toBeInstanceOf(THREE.PointLightHelper); // the fixture's "Lampy" is a point light.

    host.dispose();
    container.remove();
  });

  it("setEditorHelpers([]) clears the overlay group and disposes every tracked helper", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    host.setEditorHelpers([{ kind: "light", nodeIndex: FIXTURE_LIGHT_NODE_INDEX }]);
    expect(internals(host).editorHelperGroup!.children.length).toBe(1);

    host.setEditorHelpers([]);
    expect(internals(host).editorHelperGroup!.children.length).toBe(0);
    expect(internals(host).editorHelperObjects.size).toBe(0);

    host.dispose();
    container.remove();
  });

  it("does not add a helper for a real node that isn't a light, or for an unresolvable node index (skip, never throw)", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    expect(() => host.setEditorHelpers([{ kind: "light", nodeIndex: FIXTURE_HIT_NODE_INDEX }])).not.toThrow();
    expect(internals(host).editorHelperGroup!.children.length).toBe(0);

    expect(() => host.setEditorHelpers([{ kind: "light", nodeIndex: 999 }])).not.toThrow();
    expect(internals(host).editorHelperGroup!.children.length).toBe(0);

    host.dispose();
    container.remove();
  });

  it("repeated setEditorHelpers calls do not leak renderer.info geometry/texture counts (mirrors RH-008's own loadScene leak-discipline test)", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());

    host.setEditorHelpers([{ kind: "light", nodeIndex: FIXTURE_LIGHT_NODE_INDEX }]);
    const afterFirst = host.getRendererStats();

    host.setEditorHelpers([{ kind: "light", nodeIndex: FIXTURE_LIGHT_NODE_INDEX }]);
    const afterSecond = host.getRendererStats();
    expect(afterSecond).toEqual(afterFirst);

    host.setEditorHelpers([]);
    host.dispose();
    container.remove();
  });

  it("a reload (loadScene called again) clears every previously-set helper — the caller re-applies via its own reloadSeq-style effect", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());
    host.setEditorHelpers([{ kind: "light", nodeIndex: FIXTURE_LIGHT_NODE_INDEX }]);
    expect(internals(host).editorHelperGroup!.children.length).toBe(1);

    await host.loadScene(buildFixtureGlb());
    expect(internals(host).editorHelperGroup!.children.length).toBe(0);
    expect(internals(host).editorHelperObjects.size).toBe(0);

    host.dispose();
    container.remove();
  });
});

describe("engine-three ThreeRenderHost neutral studio-lighting rig AUTO policy", () => {
  it("dims (never fully hides) the studio rig automatically when the loaded document carries a real KHR_lights_punctual light", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    expect(host.getStudioLightingEnabled()).toBe(true); // default-full before any scene has loaded.

    await host.loadScene(buildFixtureGlb()); // this fixture DOES carry a light (FIXTURE_LIGHT_NODE_INDEX).
    expect(host.getStudioLightingEnabled()).toBe(false);
    const { studioHemisphereLight, studioDirectionalLight } = internals(host);
    // Dimmed, not hidden: both lights are still on (nonzero intensity), just
    // weaker than their full-strength default — see this file's own header
    // comment on why a hard `.visible = false` was the wrong call.
    expect(studioHemisphereLight!.intensity).toBeGreaterThan(0);
    expect(studioHemisphereLight!.intensity).toBeLessThan(1.1);
    expect(studioDirectionalLight!.intensity).toBeGreaterThan(0);
    expect(studioDirectionalLight!.intensity).toBeLessThan(2.2);

    host.dispose();
    container.remove();
  });

  it("keeps the studio rig on for a document with no authored lights at all", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);

    await host.loadScene(noLightsGltfJson());
    expect(host.getStudioLightingEnabled()).toBe(true);

    host.dispose();
    container.remove();
  });

  it("setStudioLightingEnabled manually overrides the current scene's rig visibility, but a subsequent loadScene resets to the AUTO policy", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);

    await host.loadScene(noLightsGltfJson());
    expect(host.getStudioLightingEnabled()).toBe(true);

    host.setStudioLightingEnabled(false); // manual override for THIS scene.
    expect(host.getStudioLightingEnabled()).toBe(false);

    await host.loadScene(buildFixtureGlb()); // a reload — AUTO recomputes fresh (this fixture has a light, so: off).
    expect(host.getStudioLightingEnabled()).toBe(false);

    await host.loadScene(noLightsGltfJson()); // another reload, no lights this time — AUTO turns it back on regardless of the earlier manual override.
    expect(host.getStudioLightingEnabled()).toBe(true);

    host.dispose();
    container.remove();
  });
});

describe("engine-three ThreeRenderHost snapshot() excludes editor helpers (RH-034)", () => {
  it("hides the editor-helper overlay group for the render call snapshot() makes, then restores its prior visibility", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildFixtureGlb());
    host.setEditorHelpers([{ kind: "light", nodeIndex: FIXTURE_LIGHT_NODE_INDEX }]);
    expect(internals(host).editorHelperGroup!.visible).toBe(true); // showing, pre-snapshot.

    // The rAF tick loop (render-host.ts's own `tick`) ALSO calls
    // renderer.render() continuously in the background — capture only the
    // FIRST render call after this override installs (snapshot()'s own
    // synchronous render(), issued before its `await`ed toBlob() callback
    // gives any later rAF frame a chance to run and restore visibility).
    const renderer = internals(host).renderer;
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
    expect(helperGroupVisibleDuringRender).toBe(false); // hidden for the actual render call...
    expect(internals(host).editorHelperGroup!.visible).toBe(true); // ...and restored immediately after.

    host.dispose();
    container.remove();
  });
});
