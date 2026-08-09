// Frees GPU-side resources (geometries, materials, and every texture slot a
// material might reference) for everything under `root`, recursively.
// Necessary because ThreeRenderHost.loadScene() reloads into the SAME
// renderer/scene repeatedly (RH-008) — three.js does not garbage-collect
// GPU buffers/textures just because a JS object is no longer reachable;
// each one needs an explicit .dispose() call or it leaks on every reload
// (see the contract test asserting renderer.info's geometry/texture counts
// return to baseline after a second loadScene call).
//
// Copy-lifted, behavior-preserving, from the gltf-interactivity-three demo
// app's apps/demo/src/scene-utils.ts (the "reuse sources" this package's
// spec — specs/render-host.md's implementation notes — calls out by name).
import * as THREE from "three";

export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if ((mesh as unknown as { isMesh?: boolean }).isMesh) {
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        disposeMaterial(material);
      }
    }
  });
}

function disposeMaterial(material: THREE.Material | undefined): void {
  if (!material) {
    return;
  }
  const withTextures = material as unknown as Record<string, unknown>;
  for (const key of Object.keys(withTextures)) {
    const value = withTextures[key];
    if (value instanceof THREE.Texture) {
      value.dispose();
    }
  }
  material.dispose();
}
