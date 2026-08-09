// Auto-frames `camera` (and, if given, an OrbitControls-shaped target) on
// `root`'s world-space bounding sphere. Requires `root.updateMatrixWorld(true)`
// to have already run (or been implied by a recent render) so the Box3 walk
// sees correct world transforms — called right after a model is added to the
// scene, before the first render.
//
// Copy-lifted, behavior-preserving, from the gltf-interactivity-three demo
// app's apps/demo/src/scene-utils.ts.
import * as THREE from "three";

export type FrameResult = {
  center: THREE.Vector3;
  radius: number;
};

export function frameCameraOnObject(
  camera: THREE.PerspectiveCamera,
  controlsTarget: THREE.Vector3 | undefined,
  root: THREE.Object3D
): FrameResult {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const radius = Math.max(size.length() * 0.5, 0.05);

  const distance = radius * 2.6;
  camera.position.set(center.x + distance * 0.55, center.y + distance * 0.45, center.z + distance * 0.75);
  camera.near = Math.max(distance / 500, 0.01);
  camera.far = distance * 20;
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  controlsTarget?.copy(center);

  return { center, radius };
}
