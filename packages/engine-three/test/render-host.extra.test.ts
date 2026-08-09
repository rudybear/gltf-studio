// engine-three-specific coverage beyond the portable RenderHost contract
// suite (contract.test.ts): things that are true of *this* implementation
// (three.js GPU resource discipline, the concrete loadScene input shapes
// engine-three itself resolved RH-loadscene-shape-tbd to) rather than
// obligations a hypothetical future RenderHost implementation would also
// need to satisfy the same way.
import { describe, expect, it } from "vitest";
import { createThreeRenderHost } from "../src/index.js";
import { buildFixtureGlb, FIXTURE_HIT_NODE_INDEX } from "./fixture.js";

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

describe("engine-three ThreeRenderHost (implementation-specific)", () => {
  /**
   * @spec RH-008
   * RH-008 requires the previous scene to be torn down before the new one
   * mounts; this asserts the THREE-specific consequence of that discipline —
   * repeated loadScene calls do not leak GPU-side geometries/textures.
   * Portable RenderHost implementations may not all expose a `renderer.info`
   * equivalent, so this lives here rather than in the shared contract suite.
   */
  it("loadScene twice does not leak renderer.info geometry/texture counts (RH-008)", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);

    await host.loadScene(buildFixtureGlb());
    const afterFirst = host.getRendererStats();
    expect(afterFirst).not.toBeNull();

    await host.loadScene(buildFixtureGlb());
    const afterSecond = host.getRendererStats();

    expect(afterSecond).toEqual(afterFirst);

    host.dispose();
    container.remove();
  });

  it("loadScene accepts a { json, binary } parsed-container shape, not just a raw GLB ArrayBuffer", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);

    // Re-derive { json, binary } from the same fixture bytes rather than
    // hand-rolling a second fixture: parseGlb is the adapter's own GLB
    // reader, so this exercises engine-three's OTHER accepted loadScene
    // shape (see specs/render-host.md's RESOLVED(RH-loadscene-shape-tbd))
    // against the exact same content the raw-ArrayBuffer path uses.
    const { parseGlb } = await import("@gltfi/three-adapter");
    const glb = buildFixtureGlb();
    const parsed = parseGlb(glb);

    await expect(host.loadScene({ json: parsed.json, binary: parsed.bin ?? undefined })).resolves.toBeUndefined();
    host.setCameraPose({ position: [0, 0, 3], rotation: [0, 0, 0, 1], target: [0, 0, 0] });
    expect(host.pick(0, 0)?.nodeIndex).toBe(FIXTURE_HIT_NODE_INDEX);

    host.dispose();
    container.remove();
  });

  it("loadScene parses a KHR_interactivity graph (event/onSelect) without throwing", async () => {
    // engine-three never runs the interactivity interpreter itself in v1
    // (only registerInteractivity's index-table-building side — see
    // render-host.ts's header comment) — this just confirms the extension's
    // presence doesn't break GLTFLoader.parse/registerInteractivity's own
    // plugin registration, i.e. a real KHR_interactivity-bearing asset
    // loads cleanly through this RenderHost.
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);

    await expect(host.loadScene(buildFixtureGlb())).resolves.toBeUndefined();

    host.dispose();
    container.remove();
  });
});
