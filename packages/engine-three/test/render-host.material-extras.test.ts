// Richer inspector (specs/ux-inspector.md UX-415/UX-416): the TWO material
// patch shapes engine-three applies directly against live three.js
// materials rather than through the vendored @gltfi/three-adapter's own
// pointer-router (see material-extras.ts's header comment for why neither
// has a vendored row) — `doubleSided` and a texture-info slot CLEAR. Lives
// alongside render-host.extra.test.ts as engine-three-implementation-
// specific coverage (inspects three.js Material state directly, not a
// portable RenderHost-interface obligation).
import { describe, expect, it } from "vitest";
import { createThreeRenderHost } from "../src/index.js";
import { buildMaterialExtrasFixtureGlb, MATERIAL_EXTRAS_MATERIAL_INDEX } from "./material-extras-fixture.js";

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

/** Test-only introspection: reaches into the host's private tracked materials for the fixture's one material index — mirrors how render-host.ts's own applyNonStructuralPatch resolves the same fanout array. */
function materialsFor(host: ReturnType<typeof createThreeRenderHost>, materialIndex: number): Array<Record<string, unknown>> {
  const tables = (host as unknown as { tables: { materialsByIndex: Array<Record<string, unknown>[]> } }).tables;
  return tables.materialsByIndex[materialIndex] ?? [];
}

describe("engine-three ThreeRenderHost material-extras direct-apply (UX-415/UX-416)", () => {
  it("doubleSided:false patch flips Material.side from DoubleSide (the fixture's starting value) to FrontSide, live, without a reload", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildMaterialExtrasFixtureGlb());

    const [materialBefore] = materialsFor(host, MATERIAL_EXTRAS_MATERIAL_INDEX);
    expect(materialBefore?.side).toBe(2); // THREE.DoubleSide === 2 — the fixture's own doubleSided:true.

    const outcome = host.patchScene([{ op: "replace", path: `/materials/${MATERIAL_EXTRAS_MATERIAL_INDEX}/doubleSided`, value: false }]);
    expect(outcome).toBe("applied"); // live, no reload needed for a boolean pointer-value.

    const [materialAfter] = materialsFor(host, MATERIAL_EXTRAS_MATERIAL_INDEX);
    expect(materialAfter?.side).toBe(0); // THREE.FrontSide === 0.
    // NOTE: `Material.needsUpdate` is a WRITE-ONLY three.js property (a
    // setter with no getter — reading it back is always `undefined`, by
    // three.js's own design, not a bug here) — nothing to assert past "the
    // write didn't throw," already covered by `patchScene` not throwing above.

    host.dispose();
    container.remove();
  });

  it("undoing a material's FIRST-EVER doubleSided write (a `remove` patch, not `replace`) reverts Material.side to FrontSide, live — regression coverage for a real bug this feature's own e2e caught", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildMaterialExtrasFixtureGlb());

    // The fixture's material already HAS doubleSided:true in its JSON, so
    // start from a material that does NOT (mirrors a real SceneEdit.setMaterialProperty
    // first-ever write to a material lacking the field entirely, which
    // `edit-fragments.ts`'s `setPathFragment` produces as an `add`, whose
    // OWN inverse — what undo replays — is a `remove`, never a `replace`).
    host.patchScene([{ op: "remove", path: `/materials/${MATERIAL_EXTRAS_MATERIAL_INDEX}/doubleSided` }]);
    expect(materialsFor(host, MATERIAL_EXTRAS_MATERIAL_INDEX)[0]?.side).toBe(0); // THREE.FrontSide.

    host.patchScene([{ op: "add", path: `/materials/${MATERIAL_EXTRAS_MATERIAL_INDEX}/doubleSided`, value: true }]);
    expect(materialsFor(host, MATERIAL_EXTRAS_MATERIAL_INDEX)[0]?.side).toBe(2); // THREE.DoubleSide.

    // Undo: replays the `add`'s own inverse, a `remove` — this is the
    // exact case `applyDoubleSidedPatch` was missing (it only handled
    // add/replace) until this regression was found.
    const outcome = host.patchScene([{ op: "remove", path: `/materials/${MATERIAL_EXTRAS_MATERIAL_INDEX}/doubleSided` }]);
    expect(outcome).toBe("applied");
    expect(materialsFor(host, MATERIAL_EXTRAS_MATERIAL_INDEX)[0]?.side).toBe(0); // back to FrontSide.

    host.dispose();
    container.remove();
  });

  it("clearing baseColorTexture (a remove patch) nulls Material.map, live, without a reload", async () => {
    const host = createThreeRenderHost();
    const container = createContainer();
    host.mount(container);
    await host.loadScene(buildMaterialExtrasFixtureGlb());

    const [materialBefore] = materialsFor(host, MATERIAL_EXTRAS_MATERIAL_INDEX);
    expect(materialBefore?.map).not.toBeNull();
    expect(materialBefore?.map).not.toBeUndefined();

    const outcome = host.patchScene([
      { op: "remove", path: `/materials/${MATERIAL_EXTRAS_MATERIAL_INDEX}/pbrMetallicRoughness/baseColorTexture` }
    ]);
    expect(outcome).toBe("applied"); // a remove op targeting an object property, not an array element — non-structural.

    const [materialAfter] = materialsFor(host, MATERIAL_EXTRAS_MATERIAL_INDEX);
    expect(materialAfter?.map).toBeNull(); // see the doubleSided test above for why `needsUpdate` itself isn't asserted.

    host.dispose();
    container.remove();
  });
});
